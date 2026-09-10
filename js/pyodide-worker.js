import { loadPyodide, version as pyodideVersion } from "pyodide";

import { BASE_URL } from "./config.js";

const PYODIDE_ASSET_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;

let pyodide = null;
let runCode = null;

// Filenames of the notebook's named snippets. These files are seeded into the
// Pyodide FS at init and read back after every execution so the editor can
// reflect writes a cell made to them (files as outputs).
let namedSnippetFilenames = new Set();

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || "",
      type: error.type || null,
    };
  }

  return {
    name: "Error",
    message: String(error),
    stack: "",
    type: null,
  };
}

function cleanupPyodide() {
  if (runCode && typeof runCode.destroy === "function") {
    runCode.destroy();
  }

  runCode = null;
  pyodide = null;
  namedSnippetFilenames = new Set();
}

// Read every named-snippet file back from the Pyodide FS. Used after each
// execution to surface files a cell wrote to. Files that were removed or hold
// non-UTF-8 data are skipped.
function readNamedSnippetFiles() {
  const files = {};

  for (const filename of namedSnippetFilenames) {
    try {
      files[filename] = pyodide.FS.readFile(filename, { encoding: "utf8" });
    } catch (error) {
      // deleted, or binary content that will not decode as UTF-8 — skip it
    }
  }

  return files;
}

// Install each declared dependency. Packages that ship with the Pyodide
// distribution are loaded via loadPackage (served from the CDN and cached by the
// service worker). Anything Pyodide does not know about — e.g. pure-Python
// packages published only on PyPI, like uvllang — falls back to micropip, which
// fetches wheels from files.pythonhosted.org. Those requests are also handled by
// the service worker (see sw.js) so the fallback stays cache-friendly on repeat
// visits.
async function installDependencies(dependencies) {
  const micropipTargets = [];

  for (const dependency of dependencies) {
    try {
      await pyodide.loadPackage(dependency);
    } catch (error) {
      console.warn(
        `[pyodide-worker] loadPackage failed for "${dependency}", falling back to micropip.`,
        error,
      );
      micropipTargets.push(dependency);
    }
  }

  if (micropipTargets.length === 0) {
    return;
  }

  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");
  try {
    await micropip.install(micropipTargets);
  } finally {
    micropip.destroy();
  }
}

async function initializePyodide({ dependencies = [], namedSnippets = [] } = {}) {
  cleanupPyodide();

  pyodide = await loadPyodide({
    indexURL: PYODIDE_ASSET_BASE_URL,
  });

  if (Array.isArray(dependencies) && dependencies.length > 0) {
    await installDependencies(dependencies);
  }

  const runnerResponse = await fetch(`${BASE_URL}py/runner.py`);
  if (!runnerResponse.ok) {
    throw new Error(`Failed to load runner.py: ${runnerResponse.statusText}`);
  }

  const runnerCode = await runnerResponse.text();
  pyodide.runPython(runnerCode);
  runCode = pyodide.globals.get("run_code");

  for (const snippet of namedSnippets) {
    if (!snippet || !snippet.filename) {
      continue;
    }

    pyodide.FS.writeFile(snippet.filename, snippet.content || "");
    namedSnippetFilenames.add(snippet.filename);
  }
}

async function executeCode(code) {
  if (!runCode) {
    throw new Error("Python runner is not initialized.");
  }

  const resultJson = await runCode(code);
  return { outputs: JSON.parse(resultJson), files: readNamedSnippetFiles() };
}

async function updateSnippetFile({ filename, content }) {
  if (!pyodide) {
    throw new Error("Pyodide is not initialized.");
  }

  pyodide.FS.writeFile(filename, content || "");
  namedSnippetFilenames.add(filename);
}

self.addEventListener("message", async (event) => {
  const { requestId, type, payload = {} } = event.data || {};

  try {
    if (!requestId || !type) {
      throw new Error("Invalid worker message.");
    }

    if (type === "init") {
      await initializePyodide(payload);
      self.postMessage({ requestId, ok: true, type: "init" });
      return;
    }

    if (type === "execute") {
      const { outputs, files } = await executeCode(payload.code || "");
      self.postMessage({ requestId, ok: true, type: "execute", outputs, files });
      return;
    }

    if (type === "update-file") {
      await updateSnippetFile(payload);
      self.postMessage({ requestId, ok: true, type: "update-file" });
      return;
    }

    if (type === "terminate") {
      cleanupPyodide();
      self.postMessage({ requestId, ok: true, type: "terminate" });
      self.close();
      return;
    }

    throw new Error(`Unknown worker message type: ${type}`);
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      type,
      error: serializeError(error),
    });
  }
});