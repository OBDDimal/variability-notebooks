import { loadPyodide, version as pyodideVersion } from "pyodide";

import { BASE_URL } from "./config.js";

const PYODIDE_ASSET_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;

let pyodide = null;
let runCode = null;

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
}

async function initializePyodide({ dependencies = [], namedSnippets = [] } = {}) {
  cleanupPyodide();

  pyodide = await loadPyodide({
    indexURL: PYODIDE_ASSET_BASE_URL,
  });

  if (Array.isArray(dependencies) && dependencies.length > 0) {
    await pyodide.loadPackage(dependencies);
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
  }
}

async function executeCode(code) {
  if (!runCode) {
    throw new Error("Python runner is not initialized.");
  }

  const resultJson = await runCode(code);
  return JSON.parse(resultJson);
}

async function updateSnippetFile({ filename, content }) {
  if (!pyodide) {
    throw new Error("Pyodide is not initialized.");
  }

  pyodide.FS.writeFile(filename, content || "");
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
      const outputs = await executeCode(payload.code || "");
      self.postMessage({ requestId, ok: true, type: "execute", outputs });
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