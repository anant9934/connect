'use client';

import React, { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Loader2,
  XCircle,
  Camera,
  Mic,
  Volume2,
  ShieldCheck,
  Globe,
  Radio,
  HelpCircle,
  RefreshCw,
  Square,
  AlertTriangle,
} from 'lucide-react';
import { getMediaDevices, DeviceInfo } from '@/features/meeting/media';
import { createAudioMeter, AudioMeterController } from '@/features/meeting/audioMeter';
import { PermissionHelpSheet } from '@/components/meeting/PermissionHelpSheet';

const STUN_SERVER = 'stun:stun.l.google.com:19302';
const ICE_WAIT_MS = 3500;

type Outcome = 'pending' | 'pass' | 'warn' | 'fail';

interface CheckItem {
  id: string;
  label: string;
  outcome: Outcome;
  detail: string;
}

const ICONS = {
  pending: <Loader2 className="w-5 h-5 animate-spin text-[#686868]" aria-hidden="true" />,
  pass: <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />,
  warn: <CircleAlert className="w-5 h-5 text-amber-600" aria-hidden="true" />,
  fail: <XCircle className="w-5 h-5 text-red-600" aria-hidden="true" />,
};

export default function DiagnosticsPage() {
  const [running, setRunning] = useState(true);
  const [serverCheck, setServerCheck] = useState<CheckItem>({
    id: 'server',
    label: 'Backend server & API reachability',
    outcome: 'pending',
    detail: 'Testing server latency and connectivity...',
  });
  const [networkCheck, setNetworkCheck] = useState<CheckItem>({
    id: 'network',
    label: 'WebRTC media transport & ICE',
    outcome: 'pending',
    detail: 'Gathering network ICE candidates via STUN...',
  });
  const [browserCheck, setBrowserCheck] = useState<CheckItem>({
    id: 'browser',
    label: 'Browser support & Secure Context',
    outcome: 'pending',
    detail: 'Verifying HTTPS and WebRTC APIs...',
  });

  // Permission states (queried passively without activating hardware)
  const [cameraPermission, setCameraPermission] = useState<'granted' | 'prompt' | 'denied' | 'unsupported'>('prompt');
  const [micPermission, setMicPermission] = useState<'granted' | 'prompt' | 'denied' | 'unsupported'>('prompt');
  const [deviceList, setDeviceList] = useState<{ video: DeviceInfo[]; audioIn: DeviceInfo[]; audioOut: DeviceInfo[] }>({
    video: [],
    audioIn: [],
    audioOut: [],
  });

  // Active testing states (explicit user action only!)
  const [isTestingCamera, setIsTestingCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraTestError, setCameraTestError] = useState<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micVolume, setMicVolume] = useState<number>(0);
  const [micTestError, setMicTestError] = useState<string | null>(null);
  const micMeterRef = useRef<AudioMeterController | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Help Sheet modal
  const [showHelpSheet, setShowHelpSheet] = useState(false);
  const [helpDevice, setHelpDevice] = useState<'camera' | 'microphone' | 'both'>('both');

  // 1. Check Server Reachability & Latency Breakdown
  const runServerCheck = useCallback(async (): Promise<CheckItem> => {
    const base = process.env.NEXT_PUBLIC_API_URL || '';
    try {
      // Step A: Warmup / TLS connection establishment
      const warmupStart = performance.now();
      const warmupRes = await fetch(`${base}/health/live`, { cache: 'no-store' });
      const warmupElapsed = Math.round(performance.now() - warmupStart);

      if (!warmupRes.ok) {
        return {
          id: 'server',
          label: 'Backend server & API reachability',
          outcome: 'fail',
          detail: `Server responded with HTTP status ${warmupRes.status}.`,
        };
      }

      // Step B: Steady-state latency sample on established connection
      const sampleStart = performance.now();
      const sampleRes = await fetch(`${base}/health/live`, { cache: 'no-store' });
      const sampleElapsed = Math.round(performance.now() - sampleStart);

      if (!sampleRes.ok) {
        return {
          id: 'server',
          label: 'Backend server & API reachability',
          outcome: 'warn',
          detail: `Initial ping succeeded (${warmupElapsed} ms), but secondary check failed.`,
        };
      }

      const reportedLatency = sampleElapsed;
      if (warmupElapsed > 1800) {
        return {
          id: 'server',
          label: 'Backend server & API reachability',
          outcome: 'pass',
          detail: `Reachable (~${reportedLatency} ms steady-state; cold-start was ~${warmupElapsed} ms). Cloud host is active.`,
        };
      }

      return {
        id: 'server',
        label: 'Backend server & API reachability',
        outcome: reportedLatency > 800 ? 'warn' : 'pass',
        detail: `Reachable (~${reportedLatency} ms roundtrip). Cloud backend operational.`,
      };
    } catch {
      return {
        id: 'server',
        label: 'Backend server & API reachability',
        outcome: 'fail',
        detail: 'Cannot reach backend service. The instance may be waking from idle or network is disconnected.',
      };
    }
  }, []);

  // 2. Check WebRTC PeerConnection and ICE candidate gathering
  const runNetworkCheck = useCallback((): Promise<CheckItem> => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
        resolve({
          id: 'network',
          label: 'WebRTC media transport & ICE',
          outcome: 'fail',
          detail: 'This browser environment does not support real-time WebRTC connections.',
        });
        return;
      }

      let pc: RTCPeerConnection | null = null;
      let timer: NodeJS.Timeout | null = null;
      const candidateTypes = new Set<string>();

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (pc) {
          try {
            pc.close();
          } catch {}
          pc = null;
        }
      };

      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_SERVER }] });

        const evaluateCandidates = () => {
          cleanup();
          if (candidateTypes.has('srflx') || candidateTypes.has('relay')) {
            resolve({
              id: 'network',
              label: 'WebRTC media transport & ICE',
              outcome: 'pass',
              detail: 'Media connection ready: STUN/SRFLX candidates gathered successfully.',
            });
          } else if (candidateTypes.has('host')) {
            resolve({
              id: 'network',
              label: 'WebRTC media transport & ICE',
              outcome: 'warn',
              detail: 'Only local host candidates found. A symmetric NAT or enterprise firewall may restrict direct media.',
            });
          } else {
            resolve({
              id: 'network',
              label: 'WebRTC media transport & ICE',
              outcome: 'fail',
              detail: 'No media candidates gathered. UDP traffic to STUN servers appears blocked.',
            });
          }
        };

        timer = setTimeout(evaluateCandidates, ICE_WAIT_MS);

        pc.onicecandidate = (event) => {
          if (event.candidate?.type) {
            candidateTypes.add(event.candidate.type);
          }
          if (!event.candidate) {
            evaluateCandidates();
          }
        };

        pc.createDataChannel('diagnostics');
        pc.createOffer()
          .then((offer) => pc?.setLocalDescription(offer))
          .catch(() => {
            cleanup();
            resolve({
              id: 'network',
              label: 'WebRTC media transport & ICE',
              outcome: 'fail',
              detail: 'Failed to create WebRTC offer in this browser.',
            });
          });
      } catch (err: any) {
        cleanup();
        resolve({
          id: 'network',
          label: 'WebRTC media transport & ICE',
          outcome: 'fail',
          detail: `PeerConnection creation error: ${err?.message || 'Unsupported'}`,
        });
      }
    });
  }, []);

  // 3. Check Browser Support & Secure Context
  const runBrowserCheck = useCallback((): CheckItem => {
    if (typeof window === 'undefined') {
      return { id: 'browser', label: 'Browser support & Secure Context', outcome: 'pending', detail: 'Evaluating...' };
    }

    const isSecure = typeof window.isSecureContext === 'boolean' ? window.isSecureContext : window.location.protocol === 'https:';
    const hasMedia = Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    const hasRTC = typeof RTCPeerConnection !== 'undefined';

    if (!isSecure) {
      return {
        id: 'browser',
        label: 'Browser support & Secure Context',
        outcome: 'fail',
        detail: 'Insecure context (HTTP). Modern browsers require HTTPS to grant camera and microphone access.',
      };
    }

    if (!hasMedia || !hasRTC) {
      return {
        id: 'browser',
        label: 'Browser support & Secure Context',
        outcome: 'fail',
        detail: 'Browser lacks required MediaDevices or WebRTC APIs.',
      };
    }

    return {
      id: 'browser',
      label: 'Browser support & Secure Context',
      outcome: 'pass',
      detail: 'Secure context verified (HTTPS active). WebRTC and Media APIs fully supported.',
    };
  }, []);

  // 4. Passive Permission & Device Enumeration Check (Zero hardware activation!)
  const checkPassivePermissionsAndDevices = useCallback(async () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    // Passive permission queries (do not trigger dialogs)
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      try {
        const camStatus = await navigator.permissions.query({ name: 'camera' as any });
        setCameraPermission(camStatus.state as any);
      } catch {
        setCameraPermission('prompt');
      }

      try {
        const micStatus = await navigator.permissions.query({ name: 'microphone' as any });
        setMicPermission(micStatus.state as any);
      } catch {
        setMicPermission('prompt');
      }
    }

    // Passive device enumeration
    const devs = await getMediaDevices();
    setDeviceList({
      video: devs.videoDevices,
      audioIn: devs.audioInputDevices,
      audioOut: devs.audioOutputDevices,
    });
  }, []);

  // Main automated check runner
  const runAllChecks = useCallback(async () => {
    setRunning(true);
    setServerCheck((prev) => ({ ...prev, outcome: 'pending', detail: 'Testing server latency...' }));
    setNetworkCheck((prev) => ({ ...prev, outcome: 'pending', detail: 'Gathering network ICE candidates...' }));
    setBrowserCheck(runBrowserCheck());

    const [srv, net] = await Promise.all([runServerCheck(), runNetworkCheck()]);
    setServerCheck(srv);
    setNetworkCheck(net);
    await checkPassivePermissionsAndDevices();
    setRunning(false);
  }, [runServerCheck, runNetworkCheck, runBrowserCheck, checkPassivePermissionsAndDevices]);

  useEffect(() => {
    runAllChecks();
  }, [runAllChecks]);

  // ---------------------------------------------------------------------------
  // EXPLICIT HARDWARE TESTING ACTIONS (Triggered ONLY on user button click!)
  // ---------------------------------------------------------------------------

  // Test Camera Action
  const handleTestCamera = async () => {
    if (isTestingCamera) {
      stopCameraTest();
      return;
    }

    setCameraTestError(null);
    setIsTestingCamera(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      setCameraStream(stream);
      setCameraPermission('granted');

      // Attach stream to video element
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
      }

      // Re-enumerate to get real device labels
      await checkPassivePermissionsAndDevices();

      // Auto-stop after 8 seconds
      cameraTimerRef.current = setTimeout(() => {
        stopCameraTest();
      }, 8000);
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraPermission('denied');
        setCameraTestError('Camera permission was denied in your browser.');
      } else if (name === 'NotFoundError') {
        setCameraTestError('No webcam hardware found on this device.');
      } else {
        setCameraTestError(`Camera error: ${err?.message || 'Could not start video track'}`);
      }
      setIsTestingCamera(false);
    }
  };

  const stopCameraTest = () => {
    if (cameraTimerRef.current) {
      clearTimeout(cameraTimerRef.current);
      cameraTimerRef.current = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    setIsTestingCamera(false);
  };

  useEffect(() => {
    if (cameraVideoRef.current && cameraStream) {
      cameraVideoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, isTestingCamera]);

  // Test Microphone Action
  const handleTestMicrophone = async () => {
    if (isTestingMic) {
      stopMicTest();
      return;
    }

    setMicTestError(null);
    setIsTestingMic(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;
      setMicPermission('granted');

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const meter = createAudioMeter(audioTrack, (vol) => {
          setMicVolume(vol);
        });
        micMeterRef.current = meter;
      }

      await checkPassivePermissionsAndDevices();

      // Auto-stop after 8 seconds
      micTimerRef.current = setTimeout(() => {
        stopMicTest();
      }, 8000);
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setMicPermission('denied');
        setMicTestError('Microphone permission was denied in your browser.');
      } else if (name === 'NotFoundError') {
        setMicTestError('No microphone hardware found on this device.');
      } else {
        setMicTestError(`Microphone error: ${err?.message || 'Could not start audio track'}`);
      }
      setIsTestingMic(false);
    }
  };

  const stopMicTest = () => {
    if (micTimerRef.current) {
      clearTimeout(micTimerRef.current);
      micTimerRef.current = null;
    }
    if (micMeterRef.current) {
      micMeterRef.current.stop();
      micMeterRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    setMicVolume(0);
    setIsTestingMic(false);
  };

  // Teardown any running hardware tests on unmount
  useEffect(() => {
    return () => {
      stopCameraTest();
      stopMicTest();
    };
  }, []);

  const hasDenied = cameraPermission === 'denied' || micPermission === 'denied';

  return (
    <main className="min-h-screen bg-[#FCFCFA] px-4 py-6 sm:py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Navigation & Title */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-[#686868] hover:text-[#171717] min-h-[44px] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Home
          </Link>
          <button
            type="button"
            id="diagnostics-check-again"
            disabled={running}
            onClick={runAllChecks}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E9E9E5] bg-white text-xs font-semibold text-[#171717] hover:bg-[#F2F2F0] disabled:opacity-60 transition-all shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
            <span>Check again</span>
          </button>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-[#171717]">System & Media Diagnostics</h1>
          <p className="text-xs sm:text-sm text-[#686868] mt-1">
            Independent diagnostic verification of network reachability, WebRTC capabilities, and media devices.
          </p>
        </div>

        {/* Remediation Banner if permissions are denied */}
        {hasDenied && (
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2 animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <h2 className="text-sm font-bold">Permissions Blocked by Browser</h2>
            </div>
            <p className="text-xs leading-relaxed text-amber-800">
              Your browser has blocked camera or microphone access for this website. To allow:
            </p>
            <ol className="text-xs space-y-1 list-decimal list-inside pl-1 text-amber-800">
              <li>Click the <strong>Lock / Settings icon (🔒)</strong> on the left side of the address bar.</li>
              <li>Toggle <strong>Camera</strong> and <strong>Microphone</strong> to <strong>Allow</strong>.</li>
              <li>Click <strong>Check again</strong> above to verify.</li>
            </ol>
            <button
              type="button"
              onClick={() => {
                setHelpDevice(cameraPermission === 'denied' ? 'camera' : 'microphone');
                setShowHelpSheet(true);
              }}
              className="text-xs font-semibold text-[#7258E8] hover:underline pt-1 inline-block"
            >
              View detailed browser instructions →
            </button>
          </div>
        )}

        {/* Core System Checks */}
        <section className="space-y-3">
          <h2 className="text-xs font-bold text-[#686868] uppercase tracking-wider">Infrastructure & Network Checks</h2>
          <div className="space-y-2">
            {[serverCheck, networkCheck, browserCheck].map((check) => (
              <div
                key={check.id}
                data-testid={`check-${check.id}`}
                data-outcome={check.outcome}
                className="p-4 rounded-2xl border border-[#E9E9E5] bg-white flex items-start gap-3 shadow-xs"
              >
                {ICONS[check.outcome]}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#171717]">{check.label}</p>
                  <p className="text-xs text-[#505050] mt-0.5 leading-relaxed break-words">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Device & Permission Status (Passive) */}
        <section className="space-y-3">
          <h2 className="text-xs font-bold text-[#686868] uppercase tracking-wider">Media Hardware & Permissions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Camera Status Card */}
            <div className="p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-[#171717]">
                  <Camera className="w-4 h-4 text-[#7258E8]" /> Camera
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    cameraPermission === 'granted'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : cameraPermission === 'denied'
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}
                >
                  {cameraPermission}
                </span>
              </div>
              <p className="text-xs text-[#686868]">
                {deviceList.video.length > 0
                  ? `${deviceList.video.length} camera(s) detected`
                  : 'No cameras detected or permission needed'}
              </p>

              {/* Explicit Test Action */}
              <button
                type="button"
                id="diagnostics-test-camera"
                onClick={handleTestCamera}
                className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 min-h-[38px] ${
                  isTestingCamera
                    ? 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                    : 'bg-[#F7F7F3] hover:bg-[#EAEAE8] text-[#171717] border border-[#E9E9E5]'
                }`}
              >
                {isTestingCamera ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop camera test</span>
                  </>
                ) : (
                  <>
                    <Camera className="w-3.5 h-3.5 text-[#7258E8]" />
                    <span>Test camera</span>
                  </>
                )}
              </button>

              {/* Inline Camera Video Test Stage */}
              {isTestingCamera && (
                <div className="relative aspect-video rounded-xl bg-black overflow-hidden border border-[#262626] animate-in fade-in">
                  <video
                    ref={cameraVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover -scale-x-100"
                  />
                  <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px]">
                    Live test preview (8s auto-stop)
                  </span>
                </div>
              )}
              {cameraTestError && <p className="text-xs text-red-600 mt-1">{cameraTestError}</p>}
            </div>

            {/* Microphone Status Card */}
            <div className="p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-[#171717]">
                  <Mic className="w-4 h-4 text-[#7258E8]" /> Microphone
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    micPermission === 'granted'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : micPermission === 'denied'
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}
                >
                  {micPermission}
                </span>
              </div>
              <p className="text-xs text-[#686868]">
                {deviceList.audioIn.length > 0
                  ? `${deviceList.audioIn.length} microphone(s) detected`
                  : 'No microphones detected or permission needed'}
              </p>

              {/* Explicit Test Action */}
              <button
                type="button"
                id="diagnostics-test-mic"
                onClick={handleTestMicrophone}
                className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 min-h-[38px] ${
                  isTestingMic
                    ? 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                    : 'bg-[#F7F7F3] hover:bg-[#EAEAE8] text-[#171717] border border-[#E9E9E5]'
                }`}
              >
                {isTestingMic ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop mic test</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5 text-[#7258E8]" />
                    <span>Test microphone</span>
                  </>
                )}
              </button>

              {/* Inline Microphone Audio Level Test */}
              {isTestingMic && (
                <div className="p-3 rounded-xl bg-[#F7F7F3] border border-[#E9E9E5] space-y-1.5 animate-in fade-in">
                  <div className="flex items-center justify-between text-[11px] text-[#686868]">
                    <span>Speak into microphone:</span>
                    <span className="font-mono font-medium text-emerald-700">{micVolume}%</span>
                  </div>
                  <div className="w-full h-3 rounded-full bg-white border border-[#E9E9E5] overflow-hidden p-0.5">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-75"
                      style={{ width: `${Math.min(100, micVolume * 1.5)}%` }}
                    />
                  </div>
                </div>
              )}
              {micTestError && <p className="text-xs text-red-600 mt-1">{micTestError}</p>}
            </div>
          </div>
        </section>

        {/* Global Permission Troubleshooting Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => {
              setHelpDevice('both');
              setShowHelpSheet(true);
            }}
            className="w-full py-3 px-4 rounded-xl border border-[#E9E9E5] bg-white hover:bg-[#F7F7F3] text-xs font-semibold text-[#171717] transition-all flex items-center justify-center gap-2 shadow-xs min-h-[44px]"
          >
            <HelpCircle className="w-4 h-4 text-[#7258E8]" />
            <span>Open browser permission instructions</span>
          </button>
        </div>
      </div>

      {/* Permission Help Sheet */}
      <PermissionHelpSheet
        isOpen={showHelpSheet}
        onClose={() => setShowHelpSheet(false)}
        targetDevice={helpDevice}
        cameraState={cameraPermission}
        micState={micPermission}
        onRetry={async () => {
          await checkPassivePermissionsAndDevices();
          return true;
        }}
      />
    </main>
  );
}
