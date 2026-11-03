/**
 * pythonRunner.ts
 * In-browser WebAssembly Python execution engine powered by Pyodide in a dedicated Web Worker.
 * Ensures true pre-emptive timeout termination (preventing UI thread hangs on infinite loops),
 * stdout/stderr redirection, stdin buffer emulation, and 64KB output buffer limits.
 */

export interface PythonExecutionResult {
  stdout: string;
  stderr: string;
  durationMs: number;
  status: 'passed' | 'failed' | 'error';
  errorMessage?: string;
}

const MAX_OUTPUT_BYTES = 65536; // 64 KB safety buffer limit
const PYODIDE_CDN_VERSION = 'v0.25.1';

function clampOutput(str: string): string {
  if (str.length > MAX_OUTPUT_BYTES) {
    return str.slice(0, MAX_OUTPUT_BYTES) + '\n[Output truncated: Exceeded 64KB buffer limit]';
  }
  return str;
}

// Dedicated inline Worker script source
const PYODIDE_WORKER_SCRIPT = `
importScripts("https://cdn.jsdelivr.net/pyodide/${PYODIDE_CDN_VERSION}/full/pyodide.js");

let pyodideReadyPromise = (async () => {
  const py = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/${PYODIDE_CDN_VERSION}/full/",
  });
  return py;
})();
// Tell the page when the runtime is ready (or failed), so the execution time limit
// only starts once Python is actually able to run.
pyodideReadyPromise.then(
  () => self.postMessage({ type: 'ready' }),
  (err) => self.postMessage({ type: 'load-error', error: (err && err.message) || String(err) }),
);

self.onmessage = async (e) => {
  const { id, code, stdin } = e.data;
  try {
    const pyodide = await pyodideReadyPromise;

    const setupScript = \`
import sys
from io import StringIO

sys.stdout = StringIO()
sys.stderr = StringIO()

_stdin_lines = \${JSON.stringify(stdin ? stdin.split('\\n') : [])}
_stdin_iter = iter(_stdin_lines)
def _mock_input(prompt=""):
    try:
        return next(_stdin_iter)
    except StopIteration:
        return ""
__builtins__.input = _mock_input
\`;
    await pyodide.runPythonAsync(setupScript);
    await pyodide.runPythonAsync(code);

    const harvestScript = \`
[sys.stdout.getvalue(), sys.stderr.getvalue()]
\`;
    const [stdout, stderr] = await pyodide.runPythonAsync(harvestScript);
    self.postMessage({ id, status: 'success', stdout: stdout || '', stderr: stderr || '' });
  } catch (err) {
    self.postMessage({ id, status: 'error', error: err.message || String(err) });
  }
};
`;

let workerBlobUrl: string | null = null;
let activeWorker: Worker | null = null;
let workerReady: Promise<void> | null = null;

// Downloading the runtime (~10 MB) can take far longer than running code, so loading has
// its own generous limit, separate from the per-run execution limit.
const RUNTIME_LOAD_TIMEOUT_MS = 90000;

function getWorker(): Worker {
  if (typeof window === 'undefined') {
    throw new Error('Pyodide can only run in a browser environment');
  }

  if (!workerBlobUrl) {
    const blob = new Blob([PYODIDE_WORKER_SCRIPT], { type: 'application/javascript' });
    workerBlobUrl = URL.createObjectURL(blob);
  }

  if (!activeWorker) {
    const worker = new Worker(workerBlobUrl);
    activeWorker = worker;
    workerReady = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out downloading the Python runtime')), RUNTIME_LOAD_TIMEOUT_MS);
      const onMessage = (e: MessageEvent) => {
        if (e.data?.type === 'ready') {
          clearTimeout(timer);
          worker.removeEventListener('message', onMessage);
          resolve();
        } else if (e.data?.type === 'load-error') {
          clearTimeout(timer);
          worker.removeEventListener('message', onMessage);
          reject(new Error(e.data.error || 'failed to load the Python runtime'));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', (err) => {
        clearTimeout(timer);
        reject(new Error(err.message || 'failed to start the Python runtime'));
      }, { once: true });
    });
    workerReady.catch(() => undefined); // handled by callers; avoid unhandled rejection noise
  }

  return activeWorker;
}

function terminateActiveWorker() {
  if (activeWorker) {
    try {
      activeWorker.terminate();
    } catch (e) {
      // ignore
    }
    activeWorker = null;
    workerReady = null;
  }
}

/** Starts downloading the Python runtime in the background so the first Run is fast. */
export function preloadPython(): void {
  try {
    getWorker();
  } catch {
    // Not in a browser; nothing to preload.
  }
}

export async function runPythonCode(
  code: string,
  stdin: string = '',
  timeoutMs: number = 6000,
): Promise<PythonExecutionResult> {
  const startTime = performance.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  let worker: Worker;
  try {
    worker = getWorker();
    await workerReady;
  } catch (err: any) {
    terminateActiveWorker(); // let the next attempt start a fresh download
    const msg = `Python runtime could not be loaded (${err?.message || String(err)}). Check your internet connection and press Run again.`;
    return {
      stdout: '',
      stderr: msg,
      durationMs: Math.round(performance.now() - startTime),
      status: 'error',
      errorMessage: msg,
    };
  }

  // The runtime is ready: measure and limit only the user's code from here.
  const execStart = performance.now();

  return new Promise<PythonExecutionResult>((resolve) => {
    let isDone = false;

    // Hard timeout timer: terminates the worker thread if it loops infinitely
    const timer = setTimeout(() => {
      if (isDone) return;
      isDone = true;
      const durationMs = Math.round(performance.now() - execStart);

      // Kill the spinning thread immediately
      terminateActiveWorker();

      resolve({
        stdout: '',
        stderr: `Execution Terminated: Time limit exceeded (${timeoutMs}ms). Possible infinite loop or excessive resource consumption.`,
        durationMs,
        status: 'error',
        errorMessage: 'Time limit exceeded',
      });
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent) => {
      if (isDone) return;
      if (e.data && e.data.id === requestId) {
        isDone = true;
        clearTimeout(timer);
        const durationMs = Math.round(performance.now() - execStart);

        if (e.data.status === 'success') {
          const stdout = clampOutput(e.data.stdout);
          const stderr = clampOutput(e.data.stderr);
          resolve({
            stdout,
            stderr,
            durationMs,
            status: stderr ? 'error' : 'passed',
            errorMessage: stderr || undefined,
          });
        } else {
          const errMsg = clampOutput(e.data.error || 'Unknown runtime error');
          resolve({
            stdout: '',
            stderr: errMsg,
            durationMs,
            status: 'error',
            errorMessage: errMsg,
          });
        }
      }
    };

    worker.onerror = (err: ErrorEvent) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - execStart);
      terminateActiveWorker();

      const errMsg = clampOutput(err.message || 'Worker thread execution error');
      resolve({
        stdout: '',
        stderr: errMsg,
        durationMs,
        status: 'error',
        errorMessage: errMsg,
      });
    };

    worker.postMessage({ id: requestId, code, stdin });
  });
}
