'use client';

import { useEffect } from 'react';

// Registers /sw.js in production builds only, so development always sees fresh files.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // The app works without it; only offline support is lost.
    });
  }, []);
  return null;
}
