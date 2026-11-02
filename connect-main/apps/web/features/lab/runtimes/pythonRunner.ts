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

function getWorker(): Worker {
  if (typeof window === 'undefined') {
    throw new Error('Pyodide can only run in a browser environment');
  }

  if (!workerBlobUrl) {
    const blob = new Blob([PYODIDE_WORKER_SCRIPT], { type: 'application/javascript' });
    workerBlobUrl = URL.createObjectURL(blob);
  }

  if (!activeWorker) {
    activeWorker = new Worker(workerBlobUrl);
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
  }
}

export async function runPythonCode(
  code: string,
  stdin: string = '',
  timeoutMs: number = 6000,
): Promise<PythonExecutionResult> {
  const startTime = performance.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return new Promise<PythonExecutionResult>((resolve) => {
    let worker: Worker;
    try {
      worker = getWorker();
    } catch (err: any) {
      resolve({
        stdout: '',
        stderr: `Worker Initialization Error: ${err.message || String(err)}`,
        durationMs: 0,
        status: 'error',
        errorMessage: err.message || String(err),
      });
      return;
    }

    let isDone = false;

    // Hard timeout timer: terminates the worker thread if it loops infinitely
    const timer = setTimeout(() => {
      if (isDone) return;
      isDone = true;
      const durationMs = Math.round(performance.now() - startTime);

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
        const durationMs = Math.round(performance.now() - startTime);

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
      const durationMs = Math.round(performance.now() - startTime);
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
