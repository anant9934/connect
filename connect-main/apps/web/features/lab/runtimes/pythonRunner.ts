/**
 * pythonRunner.ts
 * In-browser WebAssembly Python execution engine powered by Pyodide.
 * Captures stdout, stderr, execution duration, and supports stdin emulation.
 */

declare global {
  interface Window {
    loadPyodide?: (config: { indexURL: string }) => Promise<any>;
    __pyodideInstance?: any;
    __pyodideLoading?: Promise<any>;
  }
}

export interface PythonExecutionResult {
  stdout: string;
  stderr: string;
  durationMs: number;
  status: 'passed' | 'failed' | 'error';
  errorMessage?: string;
}

const PYODIDE_CDN_VERSION = 'v0.25.1';
const PYODIDE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_CDN_VERSION}/full/`;

let pyodideInstance: any = null;
let pyodideLoadPromise: Promise<any> | null = null;

async function loadPyodideScript(): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Pyodide can only run in the browser');
  }

  if (window.loadPyodide) {
    return;
  }

  const existingScript = document.querySelector(`script[src*="pyodide.js"]`);
  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', (e) => reject(e));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PYODIDE_BASE_URL}pyodide.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Pyodide WebAssembly script from CDN'));
    document.head.appendChild(script);
  });
}

export async function getPyodide(): Promise<any> {
  if (pyodideInstance) {
    return pyodideInstance;
  }

  if (pyodideLoadPromise) {
    return pyodideLoadPromise;
  }

  pyodideLoadPromise = (async () => {
    await loadPyodideScript();
    if (!window.loadPyodide) {
      throw new Error('Pyodide script loaded but window.loadPyodide is not defined');
    }
    const pyodide = await window.loadPyodide({
      indexURL: PYODIDE_BASE_URL,
    });
    pyodideInstance = pyodide;
    return pyodide;
  })();

  return pyodideLoadPromise;
}

export async function runPythonCode(
  code: string,
  stdin: string = '',
  timeoutMs: number = 8000,
): Promise<PythonExecutionResult> {
  const startTime = performance.now();

  try {
    const pyodide = await getPyodide();

    // Prepare sandbox with captured stdout & stderr and mock stdin
    const setupScript = `
import sys
from io import StringIO

sys.stdout = StringIO()
sys.stderr = StringIO()

# Setup stdin buffer
stdin_lines = ${JSON.stringify(stdin.split('\n'))}
_stdin_iter = iter(stdin_lines)
def _mock_input(prompt=""):
    try:
        return next(_stdin_iter)
    except StopIteration:
        return ""
__builtins__.input = _mock_input
`;
    await pyodide.runPythonAsync(setupScript);

    // Run user code with timeout guard
    const executePromise = pyodide.runPythonAsync(code);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs)
    );

    await Promise.race([executePromise, timeoutPromise]);

    const harvestScript = `
out_val = sys.stdout.getvalue()
err_val = sys.stderr.getvalue()
(out_val, err_val)
`;
    const [stdout, stderr] = await pyodide.runPythonAsync(harvestScript);
    const durationMs = Math.round(performance.now() - startTime);

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      durationMs,
      status: stderr ? 'error' : 'passed',
      errorMessage: stderr || undefined,
    };
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - startTime);
    const errMsg = err?.message || String(err);

    return {
      stdout: '',
      stderr: errMsg,
      durationMs,
      status: 'error',
      errorMessage: errMsg,
    };
  }
}
