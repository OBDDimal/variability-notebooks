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
import {dimacsLanguage, uvlLanguage} from "./notebook-languages.js";

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
// filename -> { editor, markSynced } for the currently loaded notebook's named
// snippets, so cell output written to those files can be reflected in the editor.
let snippetEditors = new Map();

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

  if (type === 'execute') {
    handlers.resolve(event.data);
    return;
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

// Reflect files a cell wrote to back into their snippet editors. `files` is a
// { filename: content } map read from the Pyodide FS after execution.
function applySnippetFileUpdates(files) {
  if (!files) {
    return;
  }

  for (const [filename, rawContent] of Object.entries(files)) {
    const entry = snippetEditors.get(filename);
    if (!entry) {
      continue;
    }

    const content = rawContent.replace(/\s+$/, '');
    const { editor } = entry;
    if (editor.state.doc.toString() === content) {
      continue;
    }

    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: content },
    });

    if (typeof entry.markSynced === 'function') {
      entry.markSynced(content);
    }

    const container = editor.dom.closest('.cm-editor-container');
    if (container) {
      container.classList.remove('cm-editor-container--file-updated');
      // restart the highlight animation on repeated writes
      void container.offsetWidth;
      container.classList.add('cm-editor-container--file-updated');
    }
  }
}

// Add the "Run all" button to a notebook. Clicking it runs every Python cell
// top to bottom, waiting for each to finish before starting the next and
// stopping at the first cell that errors.
function addRunAllButton(container, pythonCells) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'notebook-run-all';
  button.title = 'Run all cells in order';
  button.innerHTML = '<span class="notebook-run-all__glyph"></span><span>Run all</span>';

  let running = false;
  button.addEventListener('click', async () => {
    if (running) {
      return;
    }
    running = true;
    button.classList.add('running');
    button.disabled = true;

    try {
      for (const cell of pythonCells) {
        cell.editorContainer.scrollIntoView({ block: 'nearest' });
        const result = await executeCode(
          cell.editor.state.doc.toString(),
          cell.output,
          cell.playBtn
        );
        if (result && result.ok === false) {
          break;
        }
      }
    } finally {
      running = false;
      button.classList.remove('running');
      button.disabled = false;
    }
  });

  // A zero-height sticky anchor keeps the button pinned to the notebook's
  // top-right corner while scrolling through the cells.
  const anchor = document.createElement('div');
  anchor.className = 'notebook-run-all-anchor';
  anchor.appendChild(button);
  container.insertBefore(anchor, container.firstChild);
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

    // Make sure any in-flight edits to snippet files land before the cell runs.
    await Promise.all(
      [...snippetEditors.values()]
        .map(entry => (typeof entry.flushSync === 'function' ? entry.flushSync() : null))
    );

    const { outputs, files } = await postPyodideMessage('execute', { code });

    applySnippetFileUpdates(files);

    output.innerHTML = '';
    output.classList.remove('loading-output');

    let hadError = false;
    for (const chunk of outputs) {
      if (chunk.type === 'text' || chunk.type === 'error') {
        const text = (chunk.content ?? '').replace(/\s+$/, '');
        if (!text) {
          continue;
        }
        const pre = document.createElement('pre');
        pre.textContent = text;
        if (chunk.type === 'error') {
          pre.classList.add('output-error');
          hadError = true;
        }
        output.appendChild(pre);
      } else if (chunk.type === 'image') {
        const img = document.createElement('img');
        img.src = `data:image/png;base64,${chunk.content}`;
        img.style.display = 'block';
        img.style.margin = '1em auto';
        output.appendChild(img);
      }
    }

    // Keep the output area collapsed when a run produced nothing to show.
    output.classList.toggle('visible', output.childElementCount > 0);
    return { ok: !hadError };
  } catch (e) {
    output.innerHTML = '';
    const pre = document.createElement('pre');
    pre.classList.add('output-error');
    pre.textContent = `Error: ${e}`;
    output.appendChild(pre);
    output.classList.remove('loading-output');
    output.classList.add('visible');
    return { ok: false };
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
    snippetEditors = new Map();
    const pythonCells = [];

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

        const DEFAULT_COLLAPSE_LINES = 20;

        let languageExtension = [];
        let themeExtension = [];
        let isCollapsible = false;
        let collapseLines = DEFAULT_COLLAPSE_LINES;
        let startCollapsed = false;
        const highlightCompartment = new Compartment();

        const lang = (token.lang || '').toLowerCase();

        if (lang === 'python') {
          languageExtension = [python()];
          themeExtension = [monokaiPython];
          editorContainer.classList.add('cm-editor-container--python');
        } else {
          if (lang === 'dimacs') {
            languageExtension = [dimacsLanguage];
          } else if (lang === 'uvl') {
            languageExtension = [uvlLanguage];
          }

          const lineCount = token.text.split('\n').length;
          // `show-only: N` caps the visible lines and starts the block collapsed;
          // without it a long block shows in full but can be collapsed to 20 lines.
          collapseLines = token.showOnly > 0 ? token.showOnly : DEFAULT_COLLAPSE_LINES;
          isCollapsible = lineCount > collapseLines;
          startCollapsed = isCollapsible && token.showOnly > 0;

          if (isCollapsible) {
            editorContainer.classList.add('cm-editor-container--collapsible');
            if (!startCollapsed) {
              editorContainer.classList.add('cm-editor-container--expanded');
            }
          }
        }

        const isEditableSnippet =
          token.isNamedSnippet && token.lang !== 'python' && !token.readonly;

        // Edits to an editable snippet are synced to the Pyodide FS live, so
        // there is no "save" step — only a reset back to the original content.
        let revertButton;
        let onSnippetEdit = null;
        if (isEditableSnippet) {
          const buttonContainer = document.createElement('div');
          buttonContainer.className = 'snippet-buttons';

          revertButton = document.createElement('button');
          revertButton.className = 'snippet-button revert-button';
          revertButton.textContent = '↺';
          revertButton.title = 'Reset to original';
          revertButton.disabled = true;

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
            ...(isEditableSnippet ? [
              EditorView.updateListener.of(update => {
                if (update.docChanged && onSnippetEdit) {
                  onSnippetEdit();
                }
              })
            ] : []),
          ],
          parent: editorContainer,
        });

        if (isCollapsible) {
          // Size the collapsed view to exactly `collapseLines` rows of the
          // editor, plus the filename bar when present.
          const lineHeight = editor.defaultLineHeight || 19;
          const chrome =
            filenameDisplay.style.display !== 'none' ? filenameDisplay.offsetHeight : 0;
          editorContainer.style.setProperty(
            '--cm-collapsed-height',
            `${Math.round(collapseLines * lineHeight) + 8 + chrome}px`
          );
        }

        if (token.isNamedSnippet) {
          const entry = { editor };

          if (isEditableSnippet) {
            let originalContent = token.text;
            let lastSynced = token.text;
            let syncTimer = null;

            // Push the editor's current content to the Pyodide FS. Returns a
            // promise so callers (e.g. running a cell) can wait for the write.
            const flushSync = () => {
              clearTimeout(syncTimer);
              syncTimer = null;
              const current = editor.state.doc.toString();
              revertButton.disabled = current === originalContent;
              if (current === lastSynced) {
                return Promise.resolve();
              }
              lastSynced = current;
              return syncSnippetFile(token.filename, current).catch(error => {
                console.error('Failed to sync snippet file:', error);
              });
            };
            entry.flushSync = flushSync;

            onSnippetEdit = () => {
              clearTimeout(syncTimer);
              syncTimer = setTimeout(flushSync, 200);
              revertButton.disabled =
                editor.state.doc.toString() === originalContent;
            };

            // A cell that writes to this file makes the new content the baseline
            // that "reset" returns to.
            entry.markSynced = (content) => {
              originalContent = content;
              lastSynced = content;
              revertButton.disabled = true;
            };

            revertButton.addEventListener('click', () => {
              editor.dispatch({
                changes: {
                  from: 0,
                  to: editor.state.doc.length,
                  insert: originalContent
                }
              });
              flushSync();
            });
          }

          snippetEditors.set(token.filename, entry);
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

          const syncExpandState = () => {
            const expanded = editorContainer.classList.contains('cm-editor-container--expanded');
            expandButton.textContent = expanded ? 'Show less' : 'Show more';
            editor.dom.style.height = expanded ? 'auto' : '';
          };

          syncExpandState();
          expandOverlay.appendChild(expandButton);
          editorContainer.appendChild(expandOverlay);

          expandButton.addEventListener('click', () => {
            editorContainer.classList.toggle('cm-editor-container--expanded');
            syncExpandState();
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

          pythonCells.push({ editor, output, playBtn, editorContainer });
        }
      } else {
        const parsedHtml = marked.parse(token.raw || '').trim();
        if (parsedHtml) {
          const div = document.createElement('div');
          div.className = 'markdown-content-block';
          div.innerHTML = parsedHtml;
          // Open every link in a new tab.
          div.querySelectorAll('a[href]').forEach(a => {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
          });
          contentContainer.appendChild(div);
          if (window.MathJax) {
            window.MathJax.typesetPromise([div]).catch(function (err) {
              console.error('MathJax typesetting failed: ' + err.message);
            });
          }
        }
      }
    }

    if (pythonCells.length > 0) {
      addRunAllButton(contentContainer, pythonCells);
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
