import {EditorState, Compartment, StateEffect} from "@codemirror/state";
import {
  EditorView, keymap, highlightSpecialChars, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor,
  lineNumbers, highlightActiveLineGutter, highlightActiveLine
} from "@codemirror/view";
import {
  defaultHighlightStyle, syntaxHighlighting, indentOnInput,
  bracketMatching, foldGutter, foldKeymap
} from "@codemirror/language";
import {
  defaultKeymap, history, historyKeymap
} from "@codemirror/commands";
import {
  searchKeymap, highlightSelectionMatches
} from "@codemirror/search";
import {
  autocompletion, completionKeymap, closeBrackets,
  closeBracketsKeymap
} from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";

import {python} from "@codemirror/lang-python";

import {monokaiPython} from "./monokai.js";

import { Sidebar } from "./sidebar.js";
import { parseMarkdownForNotebook } from "./markdownParser.js";
import { BASE_URL } from './config.js';

let pyodideReady = false;
let pyodideWorker = null;
let pyodideInitPromise = null;
let pyodideRequestId = 0;
let activeNotebookLoadId = 0;
const pendingPyodideRequests = new Map();
let availableNotebooks = [];

function rejectPendingPyodideRequests(error) {
  for (const [requestId, handlers] of pendingPyodideRequests.entries()) {
    handlers.reject(error);
    pendingPyodideRequests.delete(requestId);
  }
}

function handlePyodideWorkerMessage(event) {
  const { requestId, ok, type, outputs, error } = event.data || {};

  if (!requestId || !pendingPyodideRequests.has(requestId)) {
    return;
  }

  const handlers = pendingPyodideRequests.get(requestId);
  pendingPyodideRequests.delete(requestId);

  if (!ok) {
    const message = error?.message || 'Pyodide worker request failed.';
    const workerError = new Error(message);
    workerError.name = error?.name || 'Error';
    workerError.stack = error?.stack || workerError.stack;
    workerError.type = error?.type || null;
    handlers.reject(workerError);
    return;
  }

  if (type === 'init') {
    pyodideReady = true;
  }

  handlers.resolve(outputs ?? event.data);
}

function handlePyodideWorkerError(event) {
  pyodideReady = false;
  pyodideInitPromise = null;

  const workerError = event.error || new Error(event.message || 'Pyodide worker crashed.');
  rejectPendingPyodideRequests(workerError);
  pyodideWorker = null;
}

function ensurePyodideWorker() {
  if (pyodideWorker) {
    return pyodideWorker;
  }

  pyodideWorker = new Worker(new URL('./pyodide-worker.js', import.meta.url), { type: 'module' });
  pyodideWorker.addEventListener('message', handlePyodideWorkerMessage);
  pyodideWorker.addEventListener('error', handlePyodideWorkerError);

  return pyodideWorker;
}

function terminatePyodideWorker() {
  pyodideReady = false;
  pyodideInitPromise = null;

  if (pyodideWorker) {
    pyodideWorker.terminate();
    pyodideWorker = null;
  }

  rejectPendingPyodideRequests(new Error('Pyodide worker was reset.'));
}

function postPyodideMessage(type, payload = {}) {
  ensurePyodideWorker();

  const requestId = ++pyodideRequestId;

  const requestPromise = new Promise((resolve, reject) => {
    pendingPyodideRequests.set(requestId, { resolve, reject });
  });

  pyodideWorker.postMessage({ requestId, type, payload });

  return requestPromise;
}

async function initializeNotebookEnvironment(dependencies, namedSnippets) {
  try {
    pyodideReady = false;

    const response = await postPyodideMessage('init', {
      dependencies: Array.isArray(dependencies) ? dependencies : [],
      namedSnippets: Array.from(namedSnippets.entries()).map(([filename, snippet]) => ({
        filename,
        content: snippet?.content || '',
      })),
    });

    pyodideReady = true;
    return response;
  } catch (error) {
    console.error('Failed to initialize Python environment:', error);
    return null;
  }
}

async function syncSnippetFile(filename, content) {
  if (!pyodideInitPromise) {
    throw new Error('Python environment is not initializing.');
  }

  await pyodideInitPromise;

  if (!pyodideReady) {
    throw new Error('Python environment is not ready.');
  }

  return postPyodideMessage('update-file', { filename, content });
}

async function executeCode(code, output, playBtn) {
  if (playBtn) {
    playBtn.classList.add('running');
  }

  try {
    if (!pyodideInitPromise) {
      throw new Error('Python environment is not initializing.');
    }

    if (!pyodideReady) {
      output.innerHTML = `
        <div class="loading-spinner-container">
          <div class="loading-spinner-message">Initializing Python environment...</div>
          <div class="loading-spinner"></div>
        </div>
      `;
      output.classList.add('visible', 'loading-output');
    }

    await pyodideInitPromise;

    output.innerHTML = '<pre>Running...</pre>';
    output.classList.remove('loading-output');
    output.classList.add('visible');

    if (!pyodideReady) {
      throw new Error('Python environment failed to initialize.');
    }

    const outputs = await postPyodideMessage('execute', { code });

    output.innerHTML = '';
    output.classList.remove('loading-output');

    for (const chunk of outputs) {
      if (chunk.type === 'text') {
        const pre = document.createElement('pre');
        pre.textContent = chunk.content;
        output.appendChild(pre);
      } else if (chunk.type === 'image') {
        const img = document.createElement('img');
        img.src = `data:image/png;base64,${chunk.content}`;
        img.style.display = 'block';
        img.style.margin = '1em auto';
        output.appendChild(img);
      }
    }

    output.classList.add('visible');
  } catch (e) {
    output.innerHTML = `<pre>Error: ${e}</pre>`;
    output.classList.remove('loading-output');
    output.classList.add('visible');
  } finally {
    if (playBtn) {
      playBtn.classList.remove('running');
    }
  }
}

async function loadNotebook(path) {
  const notebookDisplayArea = document.getElementById('notebook-display-area');
  const contentContainer = document.getElementById('content');

  document.querySelectorAll('.notebook-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const selectedItem = document.querySelector(`[data-path="${path}"]`);
  if (selectedItem) {
    selectedItem.classList.add('active');
  }

  const isValidNotebookPath = availableNotebooks.some(notebook => notebook.path === path);

  if (!isValidNotebookPath && path !== 'index.md') {
    const content = document.getElementById('content');
    if (content) {
      content.innerHTML = `
        <div class="error-page" style="text-align: center; padding: 50px;">
          <h1>404 Not Found</h1>
          <p>The notebook you are looking for does not exist.</p>
          <p>Please select a notebook from the sidebar or go to the <a href="${BASE_URL}index.md">Welcome! Notebook</a>.</p>
        </div>
      `;
    }
    return;
  }

  try {
    const loadId = ++activeNotebookLoadId;

    const response = await fetch(`${BASE_URL}notebooks/${path}`);
    if (!response.ok) {
      throw new Error(`Failed to load notebook: ${response.statusText}`);
    }
    const markdown = await response.text();
    const { metadata, tokens, namedSnippets } = parseMarkdownForNotebook(markdown);

    if (loadId !== activeNotebookLoadId) {
      return;
    }

    terminatePyodideWorker();
    pyodideInitPromise = initializeNotebookEnvironment(metadata.dependencies, namedSnippets);

    notebookDisplayArea.innerHTML = '';

    let author = 'Unknown Author';
    let version = '';

    if (metadata.meta && Array.isArray(metadata.meta)) {
      for (const item of metadata.meta) {
        if (item.author) {
          author = item.author;
        } else if (item.version) {
          version = item.version;
        }
      }
    }

    const metaInfoDiv = document.createElement('div');
    metaInfoDiv.className = 'notebook-meta-info';
    metaInfoDiv.innerHTML = `
      ${author}${version ? ` &bull; ${version}` : ''}
    `;
    
    const mainContentInner = document.createElement('div');
    mainContentInner.id = 'main-content-inner';
    
    contentContainer.innerHTML = '';
    contentContainer.classList.add('notebook-content-wrapper');
    contentContainer.appendChild(metaInfoDiv);
    mainContentInner.appendChild(contentContainer);
    notebookDisplayArea.appendChild(mainContentInner);

    var currentCodeBlockID = 0;

    for (const token of tokens) {
      if (token.type === 'code') {
        const editorContainer = document.createElement('div');
        editorContainer.className = 'cm-editor-container';
        contentContainer.appendChild(editorContainer);

        const filenameDisplay = document.createElement('div');
        filenameDisplay.className = 'filename-display';
        filenameDisplay.style.display = 'none';
        editorContainer.appendChild(filenameDisplay);

        if (token.isNamedSnippet) {
          filenameDisplay.style.display = 'flex';
          filenameDisplay.innerHTML = `<span class="file-icon">📄</span> ${token.filename}`;
        }

        let languageExtension = [];
        let themeExtension = [];
        let isCollapsible = false;
        const highlightCompartment = new Compartment();

        if (token.lang === 'python') {
          languageExtension = [python()];
          themeExtension = [monokaiPython];
          editorContainer.classList.add('cm-editor-container--python');
        } else {
          const lineCount = token.text.split('\n').length;
          isCollapsible = lineCount > 10;
          if (isCollapsible) {
            editorContainer.classList.add('cm-editor-container--collapsible');
          }
        }

        let saveButton, revertButton;
        if (token.isNamedSnippet && token.lang !== 'python') {
          const buttonContainer = document.createElement('div');
          buttonContainer.className = 'snippet-buttons';
          
          saveButton = document.createElement('button');
          saveButton.className = 'snippet-button save-button';
          saveButton.innerHTML = '✓';
          saveButton.title = 'Save changes';
          saveButton.disabled = true;
          
          revertButton = document.createElement('button');
          revertButton.className = 'snippet-button revert-button';
          revertButton.innerHTML = '↺';
          revertButton.title = 'Revert changes';
          revertButton.disabled = true;
          
          buttonContainer.appendChild(saveButton);
          buttonContainer.appendChild(revertButton);
          filenameDisplay.appendChild(buttonContainer);
        }

        const editor = new EditorView({
          doc: token.text,
          extensions: [
            lineNumbers(),
            highlightSpecialChars(),
            history(),
            foldGutter(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            bracketMatching(),
            closeBrackets(),
            autocompletion(),
            rectangularSelection(),
            crosshairCursor(),
            highlightSelectionMatches(),
            keymap.of([
              ...closeBracketsKeymap,
              ...defaultKeymap,
              ...searchKeymap,
              ...historyKeymap,
              ...foldKeymap,
              ...completionKeymap,
              ...lintKeymap
            ]),
            EditorView.lineWrapping,
            highlightCompartment.of([]),
            ...languageExtension,
            ...themeExtension,
            ...(token.readonly ? [EditorView.editable.of(false)] : []),
            ...(token.isNamedSnippet && token.lang !== 'python' ? [
              EditorView.updateListener.of(update => {
                if (update.docChanged) {
                  saveButton.disabled = false;
                  revertButton.disabled = false;
                }
              })
            ] : []),
          ],
          parent: editorContainer,
        });

        if (token.isNamedSnippet && token.lang !== 'python') {
          const originalContent = token.text;

          saveButton.addEventListener('click', () => {
            syncSnippetFile(token.filename, editor.state.doc.toString())
              .then(() => {
                saveButton.disabled = true;
              })
              .catch(error => {
                console.error('Failed to save snippet file:', error);
              });
          });

          revertButton.addEventListener('click', () => {
            editor.dispatch({
              changes: {
                from: 0,
                to: editor.state.doc.length,
                insert: originalContent
              }
            });
            syncSnippetFile(token.filename, originalContent)
              .then(() => {
                saveButton.disabled = true;
              })
              .catch(error => {
                console.error('Failed to revert snippet file:', error);
              });
          });
        }

        let interacted = false;
        const enableHighlight = () => {
          if (!interacted) {
            editor.dispatch({
              effects: highlightCompartment.reconfigure([highlightActiveLine(), highlightActiveLineGutter()])
            });
            interacted = true;
          }
        };

        const disableHighlight = () => {
          editor.dispatch({
            effects: highlightCompartment.reconfigure([])
          });
          interacted = false;
        };

        editor.dom.addEventListener('focusin', enableHighlight);
        editor.dom.addEventListener('focusout', disableHighlight);

        if (token.lang !== 'python' && isCollapsible) {
          const expandOverlay = document.createElement('div');
          expandOverlay.className = 'cm-expand-overlay';
          const expandButton = document.createElement('button');
          expandButton.className = 'cm-expand-button';
          expandButton.textContent = 'Show more';
          expandOverlay.appendChild(expandButton);
          editorContainer.appendChild(expandOverlay);

          expandButton.addEventListener('click', () => {
            editorContainer.classList.toggle('cm-editor-container--expanded');
            if (editorContainer.classList.contains('cm-editor-container--expanded')) {
              expandButton.textContent = 'Show less';
              editor.dom.style.height = 'auto';
            } else {
              expandButton.textContent = 'Show more';
              editor.dom.style.height = '';
            }
          });
        }

        if (token.lang === 'python') {
          const playBtn = document.createElement('div');
          playBtn.className = 'play-button';
          playBtn.id = `play-button-${currentCodeBlockID}`;
          currentCodeBlockID++;
          editorContainer.appendChild(playBtn);

          const output = document.createElement('pre');
          output.className = 'output';
          editorContainer.appendChild(output);

          playBtn.addEventListener('click', () => {
            executeCode(editor.state.doc.toString(), output, playBtn);
          });
        }
      } else {
        const parsedHtml = marked.parse(token.raw || '').trim();
        if (parsedHtml) {
          const div = document.createElement('div');
          div.className = 'markdown-content-block';
          div.innerHTML = parsedHtml;
          contentContainer.appendChild(div);
          if (window.MathJax) {
            window.MathJax.typesetPromise([div]).catch(function (err) {
              console.error('MathJax typesetting failed: ' + err.message);
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error loading notebook:', error);
    const content = document.getElementById('content');
    if (content) {
      content.innerHTML = `
        <div class="error-page" style="text-align: center; padding: 50px;">
          <h1>Error Loading Notebook</h1>
          <p>There was an error loading the notebook. Please try again later.</p>
          <p>Please go back to the <a href="${BASE_URL}index.md">default notebook</a>.</p>
        </div>
      `;
    }
  }
}

async function main() {
  // Get path from URL query parameter or pathname
  const urlParams = new URLSearchParams(window.location.search);
  let path = urlParams.get('path') || window.location.pathname.slice(1);
  
  console.log('Initial path:', path);
  console.log('URL params:', Object.fromEntries(urlParams.entries()));
  
  // Remove the query parameter from the URL without reloading
  if (urlParams.has('path')) {
    const newUrl = path + window.location.hash;
    console.log('Updating URL to:', newUrl);
    window.history.replaceState({}, '', newUrl);
  }

  try {
    const response = await fetch(`${BASE_URL}notebooks.json`);
    if (!response.ok) {
      throw new Error(`Failed to load notebooks manifest: ${response.statusText}`);
    }
    availableNotebooks = await response.json();
    console.log('Available notebooks:', availableNotebooks);
  } catch (error) {
    console.error('Error fetching available notebooks:', error);
  }

  const sidebar = new Sidebar();
  await sidebar.loadNotebooks();

  // Handle navigation
  if (path && path.endsWith('.md')) {
    console.log('Loading notebook:', path);
    await loadNotebook(path);
  } else {
    console.log('Loading default notebook: index.md');
    await loadNotebook('index.md');
  }

  document.addEventListener('notebookSelected', async (event) => {
    console.log('Notebook selected:', event.detail.path);
    await loadNotebook(event.detail.path);
  });

  window.addEventListener('popstate', async () => {
    let path = window.location.pathname.slice(1);
    console.log('Popstate - path:', path);
    if (path && path.endsWith('.md')) {
      await loadNotebook(path);
    } else {
      await loadNotebook('index.md');
    }
  });

  window.addEventListener('beforeunload', () => {
    terminatePyodideWorker();
  });
}

main();
