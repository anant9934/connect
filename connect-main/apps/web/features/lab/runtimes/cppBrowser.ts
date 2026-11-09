// C++ practice runs in the browser, for when no server code runner is configured. A real
// Clang/LLD (YoWASP, ISC licence) compiled to WebAssembly is loaded from jsDelivr at a pinned
// version the first time someone runs C++ (about 105 MB), then kept in the Cache API under a
// versioned name shared with the service worker, so later sessions load it from disk, even offline. The
// program compiles and runs inside a Web Worker; a time limit ends runaway loops. These runs
// are practice only: official grades come from the server runner or from faculty review.

export const CLANG_VERSION = '22.0.0-git20542-10';
const CLANG_BASE = `https://cdn.jsdelivr.net/npm/@yowasp/clang@${CLANG_VERSION}/gen/`;
const CLANG_URL = `${CLANG_BASE}bundle.js`;
export const CLANG_DOWNLOAD_MB = 105;
/** Cache API name for the compiler files; public/sw.js uses the same name for the same version. */
export const CLANG_CACHE = `tm-clang-${CLANG_VERSION}`;

export interface BrowserRunResult {
  status: 'ok' | 'compile_error' | 'runtime_error' | 'time_limit';
  stdout: string;
  stderr: string;
  compileOutput: string;
  exitCode: number;
  compileMs: number;
  runMs: number;
}

export interface BrowserRunOptions {
  /** Called once before the compiler loads: true when it is already stored in this browser. */
  onLoading?: (cached: boolean) => void;
  /** Called while the compiler downloads the first time. */
  onProgress?: (doneBytes: number, totalBytes: number) => void;
  /** Called when compilation finishes and the program starts. */
  onCompiled?: () => void;
  timeLimitMs?: number;
}

// Runs inside the worker. Kept as a string so it needs no build step and can import from the CDN.
const WORKER_SOURCE = `
const CLANG_URL = ${JSON.stringify(CLANG_URL)};
const CLANG_BASE = ${JSON.stringify(CLANG_BASE)};
const CLANG_CACHE = ${JSON.stringify(CLANG_CACHE)};
const MAX_OUTPUT = 65536;
let clangPromise = null;

// The compiler bundle reads globalThis.fetch when it loads, so this wrapper (installed before the
// import) serves its 105 MB of wasm and headers from the Cache API after the first download.
const networkFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(CLANG_BASE) || typeof caches === 'undefined') return networkFetch(input, init);
  let cache = null;
  try {
    cache = await caches.open(CLANG_CACHE);
    const hit = await cache.match(url);
    if (hit) return hit;
  } catch (e) { cache = null; }
  const res = await networkFetch(url, init);
  if (cache && res.ok) cache.put(url, res.clone()).catch(() => {});
  return res;
};

async function compilerCached() {
  try { return typeof caches !== 'undefined' && !!(await (await caches.open(CLANG_CACHE)).match(CLANG_BASE + 'llvm.core.wasm')); }
  catch (e) { return false; }
}

class Exit { constructor(code) { this.code = code; } }

// Just enough WASI preview1 for console programs: stdin, stdout, stderr, args, clock, random, exit.
function wasiImports(memoryRef, stdinBytes, out) {
  let stdinPos = 0;
  const view = () => new DataView(memoryRef.memory.buffer);
  const bytes = () => new Uint8Array(memoryRef.memory.buffer);
  const ESUCCESS = 0, EBADF = 8, ENOSYS = 52;
  const imports = {
    fd_write(fd, iovs, iovsLen, nwritten) {
      let written = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view().getUint32(iovs + i * 8, true);
        const len = view().getUint32(iovs + i * 8 + 4, true);
        const chunk = bytes().slice(ptr, ptr + len);
        if (fd === 1 || fd === 2) {
          const target = fd === 1 ? out.stdout : out.stderr;
          if (target.length < MAX_OUTPUT) target.push(chunk);
          out.size += len;
        } else return EBADF;
        written += len;
      }
      view().setUint32(nwritten, written, true);
      return ESUCCESS;
    },
    fd_read(fd, iovs, iovsLen, nread) {
      if (fd !== 0) return EBADF;
      let read = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view().getUint32(iovs + i * 8, true);
        const len = view().getUint32(iovs + i * 8 + 4, true);
        const n = Math.min(len, stdinBytes.length - stdinPos);
        bytes().set(stdinBytes.subarray(stdinPos, stdinPos + n), ptr);
        stdinPos += n; read += n;
        if (n < len) break;
      }
      view().setUint32(nread, read, true);
      return ESUCCESS;
    },
    fd_close() { return ESUCCESS; },
    fd_seek() { return ESUCCESS; },
    fd_fdstat_get(fd, stat) {
      if (fd > 2) return EBADF;
      view().setUint8(stat, 2); // character device
      view().setUint16(stat + 2, 0, true);
      view().setBigUint64(stat + 8, 0n, true);
      view().setBigUint64(stat + 16, 0n, true);
      return ESUCCESS;
    },
    fd_prestat_get() { return EBADF; },
    fd_prestat_dir_name() { return EBADF; },
    environ_sizes_get(count, size) { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return ESUCCESS; },
    environ_get() { return ESUCCESS; },
    args_sizes_get(count, size) { view().setUint32(count, 1, true); view().setUint32(size, 5, true); return ESUCCESS; },
    args_get(argv, buf) { view().setUint32(argv, buf, true); bytes().set([109, 97, 105, 110, 0], buf); return ESUCCESS; },
    clock_time_get(id, precision, time) { view().setBigUint64(time, BigInt(Math.round(performance.now() * 1e6)), true); return ESUCCESS; },
    clock_res_get(id, res) { view().setBigUint64(res, 1000n, true); return ESUCCESS; },
    random_get(buf, len) { crypto.getRandomValues(bytes().subarray(buf, buf + len)); return ESUCCESS; },
    proc_exit(code) { throw new Exit(code); },
    sched_yield() { return ESUCCESS; },
  };
  return new Proxy(imports, { get: (t, k) => (k in t ? t[k] : () => ENOSYS) });
}

const join = (chunks) => {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder().decode(all);
};

let lastPercent = -1;
const progress = (s) => {
  const percent = Math.floor((100 * s.doneLength) / Math.max(s.totalLength, 1));
  if (percent === lastPercent) return;
  lastPercent = percent;
  self.postMessage({ type: 'progress', done: s.doneLength, total: s.totalLength });
};

self.onmessage = async ({ data }) => {
  const { source, stdin } = data;
  try {
    if (!clangPromise) {
      self.postMessage({ type: 'loading', cached: await compilerCached() });
      // runClang drops fetchProgress on its internal first pass, so load the files through its
      // --version path, which keeps it, before compiling anything.
      clangPromise = import(CLANG_URL).then(async (m) => {
        await m.runClang(['clang++', '--version'], {}, { stdout: () => {}, stderr: () => {}, fetchProgress: progress });
        return m;
      });
      clangPromise.catch(() => { clangPromise = null; lastPercent = -1; });
    }
    const clang = await clangPromise;
    const diagnostics = [];
    const capture = (b) => { if (b) diagnostics.push(new Uint8Array(b)); };
    const t0 = performance.now();
    let files;
    try {
      files = await clang.runClang(
        ['clang++', '-std=c++17', '-O1', '-fno-exceptions', '-Wall', 'main.cpp', '-o', 'main.wasm'],
        { 'main.cpp': source },
        { stdout: capture, stderr: capture, fetchProgress: progress },
      );
    } catch (e) {
      self.postMessage({ type: 'done', result: { status: 'compile_error', stdout: '', stderr: '', compileOutput: join(diagnostics) || String(e && e.message || e), exitCode: 1, compileMs: performance.now() - t0, runMs: 0 } });
      return;
    }
    const compileMs = performance.now() - t0;
    const warnings = join(diagnostics);
    self.postMessage({ type: 'compiled' });
    const out = { stdout: [], stderr: [], size: 0 };
    const memoryRef = { memory: null };
    const module = await WebAssembly.compile(files['main.wasm']);
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasiImports(memoryRef, new TextEncoder().encode(stdin || ''), out) });
    memoryRef.memory = instance.exports.memory;
    const t1 = performance.now();
    let exitCode = 0, status = 'ok', trap = '';
    try { instance.exports._start(); }
    catch (e) {
      if (e instanceof Exit) exitCode = e.code;
      else { status = 'runtime_error'; exitCode = 134; trap = String(e && e.message || e); }
    }
    if (status === 'ok' && exitCode !== 0) status = 'runtime_error';
    let stdout = join(out.stdout);
    if (out.size > MAX_OUTPUT) stdout += '\\n…output truncated';
    const stderr = [join(out.stderr), trap].filter(Boolean).join('\\n');
    self.postMessage({ type: 'done', result: { status, stdout, stderr, compileOutput: warnings, exitCode, compileMs, runMs: performance.now() - t1 } });
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.message || e) });
  }
};
`;

let worker: Worker | null = null;

const getWorker = () => {
  if (!worker) {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(url, { type: 'module' });
  }
  return worker;
};

/** Compiles and runs C++ in a browser sandbox. Rejects only when the compiler cannot load. */
export function runCppInBrowser(source: string, stdin: string, options: BrowserRunOptions = {}): Promise<BrowserRunResult> {
  const timeLimit = options.timeLimitMs ?? 5000;
  return new Promise((resolve, reject) => {
    const w = getWorker();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (timer) clearTimeout(timer);
      w.onmessage = null;
      w.onerror = null;
    };
    w.onmessage = ({ data }) => {
      if (data.type === 'loading') options.onLoading?.(data.cached);
      else if (data.type === 'progress') options.onProgress?.(data.done, data.total);
      else if (data.type === 'compiled') {
        options.onCompiled?.();
        // Only the program's own run counts against the limit, not the download or compile.
        timer = setTimeout(() => {
          finish();
          w.terminate();
          worker = null;
          resolve({ status: 'time_limit', stdout: '', stderr: `Stopped after ${timeLimit / 1000} s.`, compileOutput: '', exitCode: 137, compileMs: 0, runMs: timeLimit });
        }, timeLimit);
      } else if (data.type === 'done') {
        finish();
        resolve(data.result as BrowserRunResult);
      } else if (data.type === 'error') {
        finish();
        reject(new Error(data.message));
      }
    };
    w.onerror = (e) => {
      finish();
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || 'The browser compiler could not start.'));
    };
    w.postMessage({ source, stdin });
  });
}
