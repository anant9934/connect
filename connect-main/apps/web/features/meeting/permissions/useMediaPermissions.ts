'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { DevicePermissionState } from './types';
import { detectBrowserEnvironment, BrowserEnvironmentInfo } from './browserDetection';
import {
  acquireCameraTrack,
  acquireMicrophoneTrack,
  stopMediaStream,
} from '../media';

export interface UseMediaPermissionsReturn {
  cameraState: DevicePermissionState;
  micState: DevicePermissionState;
  cameraError: string | null;
  micError: string | null;
  cameraTrack: MediaStreamTrack | null;
  micTrack: MediaStreamTrack | null;
  mediaStream: MediaStream | null;
  env: BrowserEnvironmentInfo;
  isChecking: boolean;
  queryPermissions: () => Promise<void>;
  requestCamera: (videoId?: string) => Promise<{ track: MediaStreamTrack | null; state: DevicePermissionState; error?: string }>;
  requestMicrophone: (audioId?: string) => Promise<{ track: MediaStreamTrack | null; state: DevicePermissionState; error?: string }>;
  stopCamera: () => void;
  stopMicrophone: () => void;
  stopAll: () => void;
}

export function useMediaPermissions(): UseMediaPermissionsReturn {
  const [cameraState, setCameraState] = useState<DevicePermissionState>('unknown');
  const [micState, setMicState] = useState<DevicePermissionState>('unknown');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const [cameraTrack, setCameraTrack] = useState<MediaStreamTrack | null>(null);
  const [micTrack, setMicTrack] = useState<MediaStreamTrack | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const [env, setEnv] = useState<BrowserEnvironmentInfo>(() => detectBrowserEnvironment());

  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);

  // Independent per-device request IDs to prevent concurrent cross-device cancellation races
  const cameraRequestIdRef = useRef(0);
  const micRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  // Sync internal refs
  cameraTrackRef.current = cameraTrack;
  micTrackRef.current = micTrack;

  // Rebuild composite MediaStream whenever tracks change
  useEffect(() => {
    const tracks: MediaStreamTrack[] = [];
    if (cameraTrack && cameraTrack.readyState === 'live') {
      tracks.push(cameraTrack);
    }
    if (micTrack && micTrack.readyState === 'live') {
      tracks.push(micTrack);
    }

    if (tracks.length > 0) {
      const newStream = new MediaStream(tracks);
      setMediaStream(newStream);
    } else {
      setMediaStream(null);
    }
  }, [cameraTrack, micTrack]);

  // Non-intrusively check current browser permissions status
  const queryPermissions = useCallback(async () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    const currentEnv = detectBrowserEnvironment();
    setEnv(currentEnv);

    if (!currentEnv.hasMediaDevicesSupport || !currentEnv.isSecureContext) {
      setCameraState('unsupported');
      setMicState('unsupported');
      return;
    }

    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      try {
        setIsChecking(true);
        // Query camera permission
        try {
          const camStatus = await navigator.permissions.query({ name: 'camera' as any });
          if (camStatus.state === 'granted') {
            setCameraState('granted');
            setCameraError(null);
          } else if (camStatus.state === 'denied') {
            setCameraState('denied');
          } else if (camStatus.state === 'prompt') {
            setCameraState((prev) => (prev === 'unknown' ? 'prompt' : prev));
          }

          camStatus.onchange = () => {
            if (!isMountedRef.current) return;
            if (camStatus.state === 'granted') {
              setCameraState('granted');
              setCameraError(null);
            } else if (camStatus.state === 'denied') {
              setCameraState('denied');
            } else {
              setCameraState('prompt');
            }
          };
        } catch {
          // Camera permission query not supported by this browser
          setCameraState((prev) => (prev === 'unknown' ? 'prompt' : prev));
        }

        // Query microphone permission
        try {
          const micStatus = await navigator.permissions.query({ name: 'microphone' as any });
          if (micStatus.state === 'granted') {
            setMicState('granted');
            setMicError(null);
          } else if (micStatus.state === 'denied') {
            setMicState('denied');
          } else if (micStatus.state === 'prompt') {
            setMicState((prev) => (prev === 'unknown' ? 'prompt' : prev));
          }

          micStatus.onchange = () => {
            if (!isMountedRef.current) return;
            if (micStatus.state === 'granted') {
              setMicState('granted');
              setMicError(null);
            } else if (micStatus.state === 'denied') {
              setMicState('denied');
            } else {
              setMicState('prompt');
            }
          };
        } catch {
          // Mic permission query not supported by this browser
          setMicState((prev) => (prev === 'unknown' ? 'prompt' : prev));
        }
      } catch {
        // Fallback default to prompt
        setCameraState((prev) => (prev === 'unknown' ? 'prompt' : prev));
        setMicState((prev) => (prev === 'unknown' ? 'prompt' : prev));
      } finally {
        if (isMountedRef.current) {
          setIsChecking(false);
        }
      }
    } else {
      setCameraState((prev) => (prev === 'unknown' ? 'prompt' : prev));
      setMicState((prev) => (prev === 'unknown' ? 'prompt' : prev));
    }
  }, []);

  // Request camera track independently using its own cameraRequestIdRef
  const requestCamera = useCallback(async (videoId?: string): Promise<{ track: MediaStreamTrack | null; state: DevicePermissionState; error?: string }> => {
    const currentReqId = ++cameraRequestIdRef.current;
    setCameraState('requesting');
    setCameraError(null);

    const result = await acquireCameraTrack(videoId);

    // Guard against component unmount or newer camera request (never affected by microphone operations)
    if (!isMountedRef.current || currentReqId !== cameraRequestIdRef.current) {
      if (result.track) {
        try {
          result.track.stop();
        } catch {}
      }
      return { track: null, state: 'unknown', error: 'Camera request was superseded' };
    }

    if (result.track) {
      // Stop old camera track only
      if (cameraTrackRef.current && cameraTrackRef.current !== result.track) {
        try {
          cameraTrackRef.current.stop();
        } catch {}
      }
      setCameraTrack(result.track);
      setCameraState('granted');
      setCameraError(null);
      return { track: result.track, state: 'granted' };
    } else {
      setCameraState(result.state);
      setCameraError(result.error || 'Failed to access camera');
      return { track: null, state: result.state, error: result.error };
    }
  }, []);

  // Request microphone track independently using its own micRequestIdRef
  const requestMicrophone = useCallback(async (audioId?: string): Promise<{ track: MediaStreamTrack | null; state: DevicePermissionState; error?: string }> => {
    const currentReqId = ++micRequestIdRef.current;
    setMicState('requesting');
    setMicError(null);

    const result = await acquireMicrophoneTrack(audioId);

    // Guard against component unmount or newer microphone request (never affected by camera operations)
    if (!isMountedRef.current || currentReqId !== micRequestIdRef.current) {
      if (result.track) {
        try {
          result.track.stop();
        } catch {}
      }
      return { track: null, state: 'unknown', error: 'Microphone request was superseded' };
    }

    if (result.track) {
      // Stop old mic track only
      if (micTrackRef.current && micTrackRef.current !== result.track) {
        try {
          micTrackRef.current.stop();
        } catch {}
      }
      setMicTrack(result.track);
      setMicState('granted');
      setMicError(null);
      return { track: result.track, state: 'granted' };
    } else {
      setMicState(result.state);
      setMicError(result.error || 'Failed to access microphone');
      return { track: null, state: result.state, error: result.error };
    }
  }, []);

  // Stop camera track independently
  const stopCamera = useCallback(() => {
    // Invalidate pending camera requests
    cameraRequestIdRef.current++;
    if (cameraTrackRef.current) {
      try {
        cameraTrackRef.current.stop();
      } catch {
        // safe ignore
      }
      cameraTrackRef.current = null;
      setCameraTrack(null);
    }
  }, []);

  // Stop microphone track independently
  const stopMicrophone = useCallback(() => {
    // Invalidate pending microphone requests
    micRequestIdRef.current++;
    if (micTrackRef.current) {
      try {
        micTrackRef.current.stop();
      } catch {
        // safe ignore
      }
      micTrackRef.current = null;
      setMicTrack(null);
    }
  }, []);

  // Stop all media tracks
  const stopAll = useCallback(() => {
    stopCamera();
    stopMicrophone();
  }, [stopCamera, stopMicrophone]);

  // Initial mount query
  useEffect(() => {
    isMountedRef.current = true;
    queryPermissions();

    return () => {
      isMountedRef.current = false;
    };
  }, [queryPermissions]);

  // Recheck on visibility change or window focus (e.g. user toggled settings and came back)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && isMountedRef.current) {
        queryPermissions();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [queryPermissions]);

  // Teardown tracks on component unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cameraRequestIdRef.current++;
      micRequestIdRef.current++;
      if (cameraTrackRef.current) {
        try {
          cameraTrackRef.current.stop();
        } catch {}
        cameraTrackRef.current = null;
      }
      if (micTrackRef.current) {
        try {
          micTrackRef.current.stop();
        } catch {}
        micTrackRef.current = null;
      }
    };
  }, []);

  return {
    cameraState,
    micState,
    cameraError,
    micError,
    cameraTrack,
    micTrack,
    mediaStream,
    env,
    isChecking,
    queryPermissions,
    requestCamera,
    requestMicrophone,
    stopCamera,
    stopMicrophone,
    stopAll,
  };
}
