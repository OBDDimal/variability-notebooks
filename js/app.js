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

let currentPyodide = null;
let pyodideReady = false;
let availableNotebooks = [];

async function initializeNotebookEnvironment(dependencies) {
  try {
    currentPyodide = await window.loadPyodide();    

    if (dependencies && Array.isArray(dependencies)) {
      await currentPyodide.loadPackage(dependencies);
    }

    const runnerResponse = await fetch(`${BASE_URL}py/runner.py`);
    if (!runnerResponse.ok) {
      throw new Error(`Failed to load runner.py: ${runnerResponse.statusText}`);
    }
    const runnerCode = await runnerResponse.text();

    currentPyodide.runPython(runnerCode);

    pyodideReady = true;
    return currentPyodide;
  } catch (error) {
    console.error(`Failed to initialize Python environment:`, error);
    return null;
  }
}

async function executeCode(code, output, playBtn) {
  if (playBtn) {
    playBtn.classList.add('running');
  }

  try {
    if (!pyodideReady) {
      output.innerHTML = `
        <div class="loading-spinner-container">
          <div class="loading-spinner-message">Initializing Python environment...</div>
          <div class="loading-spinner"></div>
        </div>
      `;
      output.classList.add('visible', 'loading-output');
    }

    while (!currentPyodide || !pyodideReady) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const run_code = currentPyodide.globals.get('run_code');
    if (!run_code) {
      output.innerHTML = '<pre>Error: Python runner not loaded.</pre>';
      return;
    }

    output.innerHTML = '<pre>Running...</pre>';
    output.classList.remove('loading-output');
    output.classList.add('visible');

    const resultJson = await run_code(code);
    const outputs = JSON.parse(resultJson);

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
    const response = await fetch(`notebooks/${path}`);
    if (!response.ok) {
      throw new Error(`Failed to load notebook: ${response.statusText}`);
    }
    const markdown = await response.text();
    const { metadata, tokens, namedSnippets } = parseMarkdownForNotebook(markdown);

    currentPyodide = null;
    pyodideReady = false;
    initializeNotebookEnvironment(metadata.dependencies).then(pyodideInstance => {
      if (pyodideInstance) {
        for (const [filename, { content }] of namedSnippets) {
          pyodideInstance.FS.writeFile(filename, content);
        }
      }
    }).catch(error => {
      console.error('Error initializing notebook environment or writing snippets:', error);
    });

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
            if (currentPyodide && pyodideReady) {
              currentPyodide.FS.writeFile(token.filename, editor.state.doc.toString());
              saveButton.disabled = true;
            }
          });

          revertButton.addEventListener('click', () => {
            editor.dispatch({
              changes: {
                from: 0,
                to: editor.state.doc.length,
                insert: originalContent
              }
            });
            if (currentPyodide && pyodideReady) {
              currentPyodide.FS.writeFile(token.filename, originalContent);
            }
            saveButton.disabled = true;
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
}

main();
