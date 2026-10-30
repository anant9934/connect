import 'fast-text-encoding';

// Polyfill ES2021 WeakRef for Hermes JavaScript engine (used by livekit-client / XState)
if (typeof (global as any).WeakRef === 'undefined') {
  (global as any).WeakRef = class WeakRef<T extends object> {
    private target: T;
    constructor(target: T) {
      this.target = target;
    }
    deref(): T | undefined {
      return this.target;
    }
  };
}

// Polyfill FinalizationRegistry for Hermes
if (typeof (global as any).FinalizationRegistry === 'undefined') {
  (global as any).FinalizationRegistry = class FinalizationRegistry<T> {
    private cleanupCallback: (heldValue: T) => void;
    constructor(cleanupCallback: (heldValue: T) => void) {
      this.cleanupCallback = cleanupCallback;
    }
    register(_target: object, _heldValue: T, _unregisterToken?: object): void {}
    unregister(_unregisterToken: object): boolean {
      return true;
    }
  };
}

// Polyfill crypto.randomUUID if missing
if (typeof (global as any).crypto === 'undefined') {
  (global as any).crypto = {};
}
if (typeof (global as any).crypto.randomUUID !== 'function') {
  (global as any).crypto.randomUUID = function (): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
}
