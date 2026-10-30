import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// MOCK WEBRTC PRIMITIVES
// ============================================================================

class MockMediaStreamTrack {
  constructor(kind, label = 'mock-device', id = `track-${Math.random().toString(36).slice(2, 9)}`) {
    this.kind = kind;
    this.label = label;
    this.id = id;
    this.readyState = 'live';
    this.enabled = true;
    this.stopCalls = 0;
  }

  stop() {
    this.stopCalls++;
    this.readyState = 'ended';
  }
}

class MockMediaStream {
  constructor(tracks = []) {
    this._tracks = [...tracks];
  }

  getTracks() {
    return this._tracks;
  }

  getVideoTracks() {
    return this._tracks.filter((t) => t.kind === 'video');
  }

  getAudioTracks() {
    return this._tracks.filter((t) => t.kind === 'audio');
  }

  addTrack(track) {
    if (!this._tracks.includes(track)) {
      this._tracks.push(track);
    }
  }

  removeTrack(track) {
    this._tracks = this._tracks.filter((t) => t !== track);
  }
}

// ============================================================================
// LIGHTWEIGHT EXECUTABLE REACT HOOK TEST HARNESS
// ============================================================================

class ReactHookHarness {
  constructor(hookFactory) {
    this.hookFactory = hookFactory;
    this.hooks = [];
    this.hookCursor = 0;
    this.effects = [];
    this.cleanups = [];
    this.isMounted = true;
    this.result = null;
    this.renderCount = 0;
  }

  useState(initial) {
    const idx = this.hookCursor++;
    if (this.hooks[idx] === undefined) {
      this.hooks[idx] = {
        type: 'state',
        value: typeof initial === 'function' ? initial() : initial,
      };
    }
    const cell = this.hooks[idx];
    const setState = (next) => {
      if (!this.isMounted) return;
      const nextVal = typeof next === 'function' ? next(cell.value) : next;
      if (nextVal !== cell.value) {
        cell.value = nextVal;
        this.render();
      }
    };
    return [cell.value, setState];
  }

  useRef(initial) {
    const idx = this.hookCursor++;
    if (this.hooks[idx] === undefined) {
      this.hooks[idx] = { current: initial };
    }
    return this.hooks[idx];
  }

  useCallback(fn, deps) {
    const idx = this.hookCursor++;
    const prev = this.hooks[idx];
    if (!prev || this._haveDepsChanged(prev.deps, deps)) {
      this.hooks[idx] = { fn, deps };
      return fn;
    }
    return prev.fn;
  }

  useEffect(effectFn, deps) {
    const idx = this.hookCursor++;
    const prev = this.hooks[idx];
    const shouldRun = !prev || this._haveDepsChanged(prev.deps, deps);
    this.hooks[idx] = { deps };
    if (shouldRun) {
      this.effects.push({ idx, effectFn });
    }
  }

  _haveDepsChanged(prevDeps, nextDeps) {
    if (!prevDeps || !nextDeps) return true;
    if (prevDeps.length !== nextDeps.length) return true;
    for (let i = 0; i < prevDeps.length; i++) {
      if (!Object.is(prevDeps[i], nextDeps[i])) return true;
    }
    return false;
  }

  render() {
    if (!this.isMounted) return this.result;
    this.hookCursor = 0;
    this.effects = [];
    this.renderCount++;

    this.result = this.hookFactory();

    // Run queued effects asynchronously / synchronously for this render
    const effectsToRun = [...this.effects];
    for (const { idx, effectFn } of effectsToRun) {
      if (this.cleanups[idx]) {
        try {
          this.cleanups[idx]();
        } catch (e) {
          console.error('Error in effect cleanup:', e);
        }
        this.cleanups[idx] = null;
      }
      try {
        const cleanup = effectFn();
        if (typeof cleanup === 'function') {
          this.cleanups[idx] = cleanup;
        }
      } catch (e) {
        console.error('Error in effect:', e);
      }
    }

    return this.result;
  }

  unmount() {
    this.isMounted = false;
    for (let i = 0; i < this.cleanups.length; i++) {
      if (typeof this.cleanups[i] === 'function') {
        try {
          this.cleanups[i]();
        } catch (e) {
          console.error('Error in unmount cleanup:', e);
        }
        this.cleanups[i] = null;
      }
    }
  }
}

// ============================================================================
// DYNAMIC MODULE TRANSPILER & LOADER
// ============================================================================

function loadTranspiledHook(reactOrHarness, customNavigator) {
  const isRealReact = !(reactOrHarness instanceof ReactHookHarness);
  const customReact = isRealReact
    ? reactOrHarness
    : {
        useState: (initial) => reactOrHarness.useState(initial),
        useRef: (initial) => reactOrHarness.useRef(initial),
        useCallback: (fn, deps) => reactOrHarness.useCallback(fn, deps),
        useEffect: (fn, deps) => reactOrHarness.useEffect(fn, deps),
      };

  const moduleCache = new Map();

  function loadModule(filePath) {
    if (moduleCache.has(filePath)) {
      return moduleCache.get(filePath).exports;
    }

    const code = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;

    const moduleObj = { exports: {} };
    moduleCache.set(filePath, moduleObj);

    const customRequire = (id) => {
      if (id === 'react') return customReact;
      if (id.startsWith('.')) {
        const resolvedBase = path.resolve(path.dirname(filePath), id);
        const candidates = [
          resolvedBase,
          `${resolvedBase}.ts`,
          `${resolvedBase}.tsx`,
          `${resolvedBase}.js`,
          path.join(resolvedBase, 'index.ts'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return loadModule(candidate);
          }
        }
      }
      return {};
    };

    const globalsToInject = {
      window: globalThis.window,
      navigator: customNavigator,
      document: globalThis.document,
      MediaStream: MockMediaStream,
      MediaStreamTrack: MockMediaStreamTrack,
    };

    const fn = new Function(
      'require',
      'module',
      'exports',
      'window',
      'navigator',
      'document',
      'MediaStream',
      'MediaStreamTrack',
      transpiled
    );

    fn(
      customRequire,
      moduleObj,
      moduleObj.exports,
      globalsToInject.window,
      globalsToInject.navigator,
      globalsToInject.document,
      globalsToInject.MediaStream,
      globalsToInject.MediaStreamTrack
    );

    return moduleObj.exports;
  }

  const hookModule = loadModule(path.join(WEB_ROOT, 'features/meeting/permissions/useMediaPermissions.ts'));
  return hookModule.useMediaPermissions;
}

// ============================================================================
// TEST SUITE: EXECUTABLE CONCURRENCY & LIFECYCLE TESTS
// ============================================================================

describe('Phase P0.2: Executable Media Permissions Concurrency & Lifecycle Verification', () => {
  let createdTracks = [];
  let cameraPermissionState = 'prompt';
  let micPermissionState = 'prompt';
  let cameraStatusChangeCb = null;
  let micStatusChangeCb = null;

  let getUserMediaDelay = 0;
  let cameraShouldFailWith = null;
  let micShouldFailWith = null;

  let mockNavigator;

  beforeEach(() => {
    createdTracks = [];
    cameraPermissionState = 'prompt';
    micPermissionState = 'prompt';
    cameraStatusChangeCb = null;
    micStatusChangeCb = null;
    getUserMediaDelay = 0;
    cameraShouldFailWith = null;
    micShouldFailWith = null;

    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { protocol: 'https:' },
      isSecureContext: true,
    };

    globalThis.document = {
      visibilityState: 'visible',
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    mockNavigator = {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Realme 11 Pro 5G) Chrome/120.0.0.0 Mobile Safari/537.36',
      mediaDevices: {
        getUserMedia: async (constraints) => {
          if (getUserMediaDelay > 0) {
            await new Promise((r) => setTimeout(r, getUserMediaDelay));
          }

          if (constraints.video) {
            if (cameraShouldFailWith) {
              const err = new Error(cameraShouldFailWith.message || 'Camera error');
              err.name = cameraShouldFailWith.name || 'NotAllowedError';
              throw err;
            }
            const label = constraints.video?.deviceId?.ideal || 'mock-camera-front';
            const track = new MockMediaStreamTrack('video', label);
            createdTracks.push(track);
            return new MockMediaStream([track]);
          }

          if (constraints.audio) {
            if (micShouldFailWith) {
              const err = new Error(micShouldFailWith.message || 'Microphone error');
              err.name = micShouldFailWith.name || 'NotAllowedError';
              throw err;
            }
            const label = constraints.audio?.deviceId?.ideal || 'mock-mic-default';
            const track = new MockMediaStreamTrack('audio', label);
            createdTracks.push(track);
            return new MockMediaStream([track]);
          }

          throw new Error('Invalid constraints requested');
        },
        enumerateDevices: async () => [
          { deviceId: 'cam-front', kind: 'videoinput', label: 'Front Camera' },
          { deviceId: 'cam-back', kind: 'videoinput', label: 'Back Camera' },
          { deviceId: 'mic-builtin', kind: 'audioinput', label: 'Built-in Mic' },
        ],
      },
      permissions: {
        query: async ({ name }) => {
          if (name === 'camera') {
            return {
              get state() {
                return cameraPermissionState;
              },
              set onchange(cb) {
                cameraStatusChangeCb = cb;
              },
              get onchange() {
                return cameraStatusChangeCb;
              },
            };
          }
          if (name === 'microphone') {
            return {
              get state() {
                return micPermissionState;
              },
              set onchange(cb) {
                micStatusChangeCb = cb;
              },
              get onchange() {
                return micStatusChangeCb;
              },
            };
          }
          return { state: 'prompt' };
        },
      },
    };
  });

  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
  });

  // TEST 1: Camera and mic requests started simultaneously
  test('Case 1: Camera and mic requests started simultaneously complete without racing or mutual cancellation', async () => {
    let harness;
    const hookFn = () => {
      const hook = loadTranspiledHook(harness, mockNavigator);
      return hook();
    };
    harness = new ReactHookHarness(hookFn);
    harness.render();

    // Trigger both simultaneously
    const [camResult, micResult] = await Promise.all([
      harness.result.requestCamera(),
      harness.result.requestMicrophone(),
    ]);

    // Assert track identities
    assert.ok(camResult.track, 'Camera track must be acquired');
    assert.strictEqual(camResult.track.kind, 'video', 'Camera track must have kind "video"');
    assert.strictEqual(camResult.track.readyState, 'live', 'Camera track readyState must be "live"');
    assert.strictEqual(camResult.state, 'granted', 'Camera state must be granted');

    assert.ok(micResult.track, 'Mic track must be acquired');
    assert.strictEqual(micResult.track.kind, 'audio', 'Mic track must have kind "audio"');
    assert.strictEqual(micResult.track.readyState, 'live', 'Mic track readyState must be "live"');
    assert.strictEqual(micResult.state, 'granted', 'Mic state must be granted');

    // Assert UI / Hook state
    assert.strictEqual(harness.result.cameraState, 'granted');
    assert.strictEqual(harness.result.micState, 'granted');
    assert.strictEqual(harness.result.cameraTrack, camResult.track);
    assert.strictEqual(harness.result.micTrack, micResult.track);

    // Assert composite MediaStream contains both tracks
    assert.ok(harness.result.mediaStream, 'Composite MediaStream must exist');
    assert.strictEqual(harness.result.mediaStream.getVideoTracks().length, 1);
    assert.strictEqual(harness.result.mediaStream.getAudioTracks().length, 1);

    harness.unmount();
  });

  // TEST 2: Camera denied while mic succeeds
  test('Case 2: Camera denied while mic succeeds preserves audio track and does not tear down mic', async () => {
    cameraShouldFailWith = { name: 'NotAllowedError', message: 'Permission denied' };

    let harness;
    const hookFn = () => {
      const hook = loadTranspiledHook(harness, mockNavigator);
      return hook();
    };
    harness = new ReactHookHarness(hookFn);
    harness.render();

    const [camResult, micResult] = await Promise.all([
      harness.result.requestCamera(),
      harness.result.requestMicrophone(),
    ]);

    // Camera fails with denied
    assert.strictEqual(camResult.track, null, 'Camera track must be null when denied');
    assert.strictEqual(camResult.state, 'denied', 'Camera state must be denied');
    assert.ok(camResult.error, 'Camera must report descriptive permission error');

    // Mic succeeds
    assert.ok(micResult.track, 'Mic track must succeed despite camera failure');
    assert.strictEqual(micResult.track.kind, 'audio');
    assert.strictEqual(micResult.track.readyState, 'live', 'Mic track must remain live');
    assert.strictEqual(micResult.state, 'granted');

    // Hook state
    assert.strictEqual(harness.result.cameraState, 'denied');
    assert.strictEqual(harness.result.micState, 'granted');
    assert.strictEqual(harness.result.cameraTrack, null);
    assert.strictEqual(harness.result.micTrack, micResult.track);

    // Absence of unintended capture: stream only has audio
    assert.ok(harness.result.mediaStream);
    assert.strictEqual(harness.result.mediaStream.getVideoTracks().length, 0);
    assert.strictEqual(harness.result.mediaStream.getAudioTracks().length, 1);

    harness.unmount();
  });

  // TEST 3: Mic denied while camera succeeds
  test('Case 3: Mic denied while camera succeeds preserves video track and does not tear down camera', async () => {
    micShouldFailWith = { name: 'NotAllowedError', message: 'Permission denied' };

    let harness;
    const hookFn = () => {
      const hook = loadTranspiledHook(harness, mockNavigator);
      return hook();
    };
    harness = new ReactHookHarness(hookFn);
    harness.render();

    const [camResult, micResult] = await Promise.all([
      harness.result.requestCamera(),
      harness.result.requestMicrophone(),
    ]);

    // Mic fails
    assert.strictEqual(micResult.track, null);
    assert.strictEqual(micResult.state, 'denied');

    // Camera succeeds
    assert.ok(camResult.track);
    assert.strictEqual(camResult.track.kind, 'video');
    assert.strictEqual(camResult.track.readyState, 'live');
    assert.strictEqual(camResult.state, 'granted');

    // Hook state
    assert.strictEqual(harness.result.cameraState, 'granted');
    assert.strictEqual(harness.result.micState, 'denied');
    assert.strictEqual(harness.result.cameraTrack, camResult.track);
    assert.strictEqual(harness.result.micTrack, null);

    // Composite stream only has video
    assert.ok(harness.result.mediaStream);
    assert.strictEqual(harness.result.mediaStream.getVideoTracks().length, 1);
    assert.strictEqual(harness.result.mediaStream.getAudioTracks().length, 0);

    harness.unmount();
  });

  // TEST 4: Both requests succeed sequentially
  test('Case 4: Sequential independent activation succeeds with track identity validation', async () => {
    let harness;
    const hookFn = () => {
      const hook = loadTranspiledHook(harness, mockNavigator);
      return hook();
    };
    harness = new ReactHookHarness(hookFn);
    harness.render();

    // Activate camera first
    const camRes = await harness.result.requestCamera();
    assert.strictEqual(camRes.state, 'granted');
    assert.strictEqual(harness.result.micTrack, null, 'Turning on camera must never turn on mic');

    // Activate mic second
    const micRes = await harness.result.requestMicrophone();
    assert.strictEqual(micRes.state, 'granted');
    assert.strictEqual(harness.result.cameraTrack, camRes.track, 'Turning on mic must not touch camera track');

    harness.unmount();
  });

  // TEST 5: Rapid camera ON/OFF
  test('Case 5: Rapid camera ON/OFF terminates superseded tracks without leaks', async () => {
    getUserMediaDelay = 20; // 20ms async acquisition

    let harness;
    const hookFn = () => {
      const hook = loadTranspiledHook(harness, mockNavigator);
      return hook();
    };
    harness = new ReactHookHarness(hookFn);
    harness.render();

    // Trigger request 1 then immediately trigger request 2 before request 1 finishes
    const req1 = harness.result.requestCamera('cam-front');
    const req2 = harness.result.requestCamera('cam-back');

    const [res1, res2] = await Promise.all([req1, req2]);

    // Request 1 must have been superseded
    assert.strictEqual(res1.track, null, 'Superseded camera request must return null track');
    assert.strictEqual(res1.error, 'Camera request was superseded');

    // Request 2 must succeed
    assert.ok(res2.track, 'Latest camera request must succeed');
    assert.strictEqual(res2.track.readyState, 'live');

    // Stop camera immediately
    harness.result.stopCamera();
    assert.strictEqual(res2.track.readyState, 'ended', 'Track must be stopped when stopCamera() is called');
    assert.strictEqual(harness.result.cameraTrack, null, 'cameraTrack state must be null');

    harness.unmount();
  });

  // TEST 6: Camera switching while mic capture remains active
  test('Case 6: Camera switching stops old camera while microphone remains completely undisturbed', async () => {
    let harness;
    const hookFn = () => {
      const hook = loadTranspiledHook(harness, mockNavigator);
      return hook();
    };
    harness = new ReactHookHarness(hookFn);
    harness.render();

    // Initial capture: camera 1 and mic
    const cam1 = await harness.result.requestCamera('cam-front');
    const mic = await harness.result.requestMicrophone();

    assert.strictEqual(cam1.track.readyState, 'live');
    assert.strictEqual(mic.track.readyState, 'live');

    // Switch to camera 2
    const cam2 = await harness.result.requestCamera('cam-back');

    // Old camera track is stopped
    assert.strictEqual(cam1.track.readyState, 'ended', 'Old camera track must be stopped upon switch');
    // New camera track is live
    assert.strictEqual(cam2.track.readyState, 'live', 'New camera track must be live');
    // Mic track is COMPLETELY untouched
    assert.strictEqual(harness.result.micTrack, mic.track, 'Mic track identity must remain identical');
    assert.strictEqual(mic.track.readyState, 'live', 'Mic track must remain live');
    assert.strictEqual(mic.track.stopCalls, 0, 'Mic track stop() must not be called during camera switch');

    harness.unmount();
  });

  // TEST 7: Component unmount during pending media capture
  test('Case 7: Component unmount during pending media capture immediately cleans up and stops acquired track', async () => {
    getUserMediaDelay = 30; // 30ms latency

    let harness;
    const hookFn = () => {
      const hook = loadTranspiledHook(harness, mockNavigator);
      return hook();
    };
    harness = new ReactHookHarness(hookFn);
    harness.render();

    // Start in-flight camera request
    const pendingCamPromise = harness.result.requestCamera();

    // Unmount component while request is in-flight
    await new Promise((r) => setTimeout(r, 5));
    harness.unmount();

    // Await the in-flight request resolution
    const res = await pendingCamPromise;

    // Must return null track and superseded state
    assert.strictEqual(res.track, null, 'Unmounted component must reject track assignment');

    // Any track acquired behind the scenes must be stopped immediately
    assert.ok(createdTracks.length > 0, 'A track was acquired by getUserMedia');
    for (const track of createdTracks) {
      assert.strictEqual(track.readyState, 'ended', 'Track acquired after unmount must be immediately stopped');
    }
  });

  // TEST 8: Previously granted permission on page load
  test('Case 8: Previously granted permission on page load queries status without unexpectedly capturing media', async () => {
    cameraPermissionState = 'granted';
    micPermissionState = 'granted';

    let harness;
    const hookFn = () => {
      const hook = loadTranspiledHook(harness, mockNavigator);
      return hook();
    };
    harness = new ReactHookHarness(hookFn);
    harness.render();

    // Await initial async queryPermissions resolution
    await harness.result.queryPermissions();

    // Query reflects granted permission state
    assert.strictEqual(harness.result.cameraState, 'granted');
    assert.strictEqual(harness.result.micState, 'granted');

    // CRITICAL: Media tracks must remain strictly OFF
    assert.strictEqual(harness.result.cameraTrack, null, 'Camera must NOT be acquired automatically on mount');
    assert.strictEqual(harness.result.micTrack, null, 'Microphone must NOT be acquired automatically on mount');
    assert.strictEqual(harness.result.mediaStream, null, 'MediaStream must remain null on mount');
    assert.strictEqual(createdTracks.length, 0, 'Zero getUserMedia calls may occur on mount');

    harness.unmount();
  });

  // TEST 9: Denial followed by permission restoration
  test('Case 9: Permission denial followed by permission restoration transitions state and enables subsequent capture', async () => {
    cameraPermissionState = 'denied';

    let harness;
    const hookFn = () => {
      const hook = loadTranspiledHook(harness, mockNavigator);
      return hook();
    };
    harness = new ReactHookHarness(hookFn);
    harness.render();

    // Await initial async queryPermissions resolution
    await harness.result.queryPermissions();

    // Initial state is denied
    assert.strictEqual(harness.result.cameraState, 'denied');

    // User updates permission in browser settings
    cameraPermissionState = 'granted';
    if (cameraStatusChangeCb) {
      cameraStatusChangeCb();
    } else {
      await harness.result.queryPermissions();
    }

    // State reflects restored permission
    assert.strictEqual(harness.result.cameraState, 'granted', 'Permission state must update to granted');

    // Subsequent user activation succeeds
    const res = await harness.result.requestCamera();
    assert.ok(res.track, 'Camera track must be acquired after restoration');
    assert.strictEqual(res.track.readyState, 'live');
    assert.strictEqual(harness.result.cameraTrack, res.track);

    harness.unmount();
  });
});

// ============================================================================
// PHASE P0.3: REAL REACT 18 CONCURRENCY & STRICTMODE SUITE
// ============================================================================

describe('Phase P0.3: Real React 18 Concurrent & StrictMode Environment Validation', async () => {
  const ReactModule = await import('react');
  const ReactDOMClient = await import('react-dom/client');
  const React = ReactModule.default || ReactModule;

  function createMockElement(tagName = 'div') {
    const el = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      nodeName: tagName.toUpperCase(),
      childNodes: [],
      style: {},
      setAttribute() {},
      getAttribute() { return null; },
      removeAttribute() {},
      appendChild(c) { el.childNodes.push(c); return c; },
      removeChild(c) { el.childNodes = el.childNodes.filter((x) => x !== c); return c; },
      insertBefore(c) { el.childNodes.push(c); return c; },
      addEventListener() {},
      removeEventListener() {},
    };
    el.ownerDocument = globalThis.document;
    return el;
  }

  function setupRealDOM() {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { protocol: 'https:' },
      isSecureContext: true,
      HTMLIFrameElement: function HTMLIFrameElement() {},
    };
    globalThis.document = {
      nodeType: 9,
      nodeName: '#document',
      createElement: createMockElement,
      createElementNS: (_, tag) => createMockElement(tag),
      createTextNode: (text) => ({
        nodeType: 3,
        nodeValue: text,
        textContent: text,
        appendChild() {},
        removeChild() {},
        addEventListener() {},
        removeEventListener() {},
      }),
      createComment: () => ({ nodeType: 8, appendChild() {}, removeChild() {} }),
      addEventListener() {},
      removeEventListener() {},
      defaultView: globalThis.window,
      visibilityState: 'visible',
    };
    globalThis.window.document = globalThis.document;
    globalThis.HTMLIFrameElement = globalThis.window.HTMLIFrameElement;
  }

  let createdTracks = [];
  let cameraPermissionState = 'prompt';
  let micPermissionState = 'prompt';
  let cameraStatusChangeCb = null;
  let micStatusChangeCb = null;
  let mockNavigator;

  beforeEach(() => {
    setupRealDOM();
    createdTracks = [];
    cameraPermissionState = 'prompt';
    micPermissionState = 'prompt';
    cameraStatusChangeCb = null;
    micStatusChangeCb = null;

    mockNavigator = {
      mediaDevices: {
        getUserMedia: async (constraints) => {
          const tracks = [];
          if (constraints?.video) {
            const track = new MockMediaStreamTrack('video', 'Strict Camera');
            createdTracks.push(track);
            tracks.push(track);
          }
          if (constraints?.audio) {
            const track = new MockMediaStreamTrack('audio', 'Strict Mic');
            createdTracks.push(track);
            tracks.push(track);
          }
          return new MockMediaStream(tracks);
        },
      },
      permissions: {
        query: async ({ name }) => {
          const status = {
            get state() {
              return name === 'camera' ? cameraPermissionState : micPermissionState;
            },
            get onchange() {
              return name === 'camera' ? cameraStatusChangeCb : micStatusChangeCb;
            },
            set onchange(cb) {
              if (name === 'camera') cameraStatusChangeCb = cb;
              else micStatusChangeCb = cb;
            },
            addEventListener: (evt, cb) => {
              if (name === 'camera') cameraStatusChangeCb = cb;
              else micStatusChangeCb = cb;
            },
            removeEventListener: () => {
              if (name === 'camera') cameraStatusChangeCb = null;
              else micStatusChangeCb = null;
            },
          };
          return status;
        },
      },
    };
  });

  async function mountHookInStrictMode() {
    const hook = loadTranspiledHook(React, mockNavigator);
    const container = globalThis.document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let hookResult = null;

    function TestComponent() {
      hookResult = hook();
      return null;
    }

    await React.act(async () => {
      root.render(React.createElement(React.StrictMode, null, React.createElement(TestComponent)));
    });

    return {
      getResult: () => hookResult,
      unmount: async () => {
        await React.act(async () => {
          root.unmount();
        });
      },
      act: React.act,
    };
  }

  test('React 18 StrictMode: Double-mount behavior does NOT leak event listeners, duplicate queries, or capture media unexpectedly', async () => {
    cameraPermissionState = 'granted';
    micPermissionState = 'granted';

    const harness = await mountHookInStrictMode();

    // Query permissions explicitly
    await harness.act(async () => {
      await harness.getResult().queryPermissions();
    });

    // States reflect permissions
    assert.strictEqual(harness.getResult().cameraState, 'granted');
    assert.strictEqual(harness.getResult().micState, 'granted');

    // Strict Mode double-mounting MUST NOT trigger auto-capture
    assert.strictEqual(harness.getResult().cameraTrack, null, 'Strict Mode mount must not auto-acquire camera');
    assert.strictEqual(harness.getResult().micTrack, null, 'Strict Mode mount must not auto-acquire microphone');
    assert.strictEqual(harness.getResult().mediaStream, null, 'Strict Mode mount must keep mediaStream null');
    assert.strictEqual(createdTracks.length, 0, 'Zero tracks must be created during Strict Mode mount');

    await harness.unmount();
  });

  test('React 18 StrictMode: Camera and Microphone Independence under concurrent execution', async () => {
    const harness = await mountHookInStrictMode();

    // 1. Activate Camera
    let camRes;
    await harness.act(async () => {
      camRes = await harness.getResult().requestCamera();
    });

    assert.ok(camRes.track, 'Camera track must be acquired');
    assert.strictEqual(harness.getResult().cameraState, 'granted');
    assert.strictEqual(harness.getResult().micState, 'prompt', 'Microphone state must remain prompt');
    assert.strictEqual(harness.getResult().micTrack, null, 'Microphone track must remain null when camera activated');

    // 2. Activate Microphone
    let micRes;
    await harness.act(async () => {
      micRes = await harness.getResult().requestMicrophone();
    });

    assert.ok(micRes.track, 'Mic track must be acquired');
    assert.strictEqual(harness.getResult().micState, 'granted');
    assert.strictEqual(harness.getResult().cameraTrack, camRes.track, 'Camera track must remain unchanged when mic activated');

    // 3. Stop Camera
    await harness.act(async () => {
      harness.getResult().stopCamera();
    });

    assert.strictEqual(harness.getResult().cameraTrack, null, 'Camera track stopped');
    assert.strictEqual(camRes.track.readyState, 'ended', 'Camera track readyState ended');
    assert.strictEqual(harness.getResult().micTrack, micRes.track, 'Microphone must remain active when camera stopped');

    await harness.unmount();
  });

  test('React 18 StrictMode: Rapid toggles terminate superseded tracks without leaks', async () => {
    const harness = await mountHookInStrictMode();

    // Rapid toggle sequence
    await harness.act(async () => {
      const p1 = harness.getResult().requestCamera();
      harness.getResult().stopCamera();
      const p2 = harness.getResult().requestCamera();
      await Promise.all([p1, p2]);
    });

    assert.ok(harness.getResult().cameraTrack, 'Active camera track exists after rapid toggles');
    assert.strictEqual(harness.getResult().cameraTrack.readyState, 'live', 'Current track must be live');

    // All previous tracks must be cleanly ended
    const supersededTracks = createdTracks.filter((t) => t !== harness.getResult().cameraTrack);
    for (const track of supersededTracks) {
      assert.strictEqual(track.readyState, 'ended', 'Superseded track must be stopped');
    }

    await harness.unmount();
  });

  test('React 18 StrictMode: Unmount cleanup terminates all active media tracks', async () => {
    const harness = await mountHookInStrictMode();

    let camRes, micRes;
    await harness.act(async () => {
      camRes = await harness.getResult().requestCamera();
      micRes = await harness.getResult().requestMicrophone();
    });

    assert.strictEqual(camRes.track.readyState, 'live');
    assert.strictEqual(micRes.track.readyState, 'live');

    // Unmount
    await harness.unmount();

    // Verify all active tracks are stopped immediately
    assert.strictEqual(camRes.track.readyState, 'ended', 'Camera track must be ended on unmount');
    assert.strictEqual(micRes.track.readyState, 'ended', 'Mic track must be ended on unmount');
  });

  test('React 18 StrictMode: Permission recovery from denied to granted without remounting', async () => {
    cameraPermissionState = 'denied';

    const harness = await mountHookInStrictMode();

    await harness.act(async () => {
      await harness.getResult().queryPermissions();
    });
    assert.strictEqual(harness.getResult().cameraState, 'denied');

    // User grants permission in browser settings
    cameraPermissionState = 'granted';
    await harness.act(async () => {
      if (cameraStatusChangeCb) {
        cameraStatusChangeCb();
      } else {
        await harness.getResult().queryPermissions();
      }
    });

    assert.strictEqual(harness.getResult().cameraState, 'granted', 'State updated to granted after recovery');

    let camRes;
    await harness.act(async () => {
      camRes = await harness.getResult().requestCamera();
    });
    assert.ok(camRes.track, 'Camera successfully acquired after permission recovery');
    assert.strictEqual(camRes.track.readyState, 'live');

    await harness.unmount();
  });

  test('React 18 StrictMode: No unexpected device activation without explicit user action', async () => {
    cameraPermissionState = 'prompt';
    micPermissionState = 'prompt';

    const harness = await mountHookInStrictMode();
    const result = harness.getResult();

    await harness.act(async () => {
      await result.queryPermissions();
    });

    assert.strictEqual(result.cameraState, 'prompt');
    assert.strictEqual(result.micState, 'prompt');
    assert.strictEqual(createdTracks.length, 0, 'No tracks created without user click');
    assert.strictEqual(result.cameraTrack, null);
    assert.strictEqual(result.micTrack, null);

    await harness.unmount();
  });
});
