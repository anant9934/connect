'use client';

import { useEffect, useState } from 'react';
import { reportActivity } from './api';

const REPORT_EVERY_MS = 30000;
const MISSES_BEFORE_STOPPING = 3;

// Reports only how long this tab was visible, nothing about what else is open. The server says
// whether this meeting records it at all, and the hook stops once it clearly does not.
export function useBrowserActivity(roomCode: string, enabled: boolean) {
  const [recorded, setRecorded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let visibleMs = 0;
    let hiddenMs = 0;
    let lastChange = Date.now();
    let stopped = false;
    let misses = 0;

    const tally = () => {
      const now = Date.now();
      if (document.visibilityState === 'visible') visibleMs += now - lastChange;
      else hiddenMs += now - lastChange;
      lastChange = now;
    };
    const send = async () => {
      if (stopped) return;
      tally();
      const visibleSeconds = Math.round(visibleMs / 1000);
      const hiddenSeconds = Math.round(hiddenMs / 1000);
      if (visibleSeconds + hiddenSeconds === 0) return;
      visibleMs = 0;
      hiddenMs = 0;
      try {
        const res = await reportActivity(roomCode, visibleSeconds, hiddenSeconds);
        setRecorded(res.recorded);
        misses = res.recorded ? 0 : misses + 1;
        if (misses >= MISSES_BEFORE_STOPPING) stop();
      } catch {
        // A lost report only makes this signal less complete.
      }
    };
    // A state change must be tallied under the state that just ended, so it counts before the flip.
    let wasVisible = document.visibilityState === 'visible';
    const onVisibility = () => {
      const now = Date.now();
      if (wasVisible) visibleMs += now - lastChange;
      else hiddenMs += now - lastChange;
      lastChange = now;
      wasVisible = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(send, REPORT_EVERY_MS);
    const stop = () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    return stop;
  }, [roomCode, enabled]);

  return recorded;
}
