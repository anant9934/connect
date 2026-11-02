'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, CircleAlert, Loader2, XCircle } from 'lucide-react';

const LATENCY_SAMPLES = 5;
const SLOW_LATENCY_MS = 400;
const ICE_WAIT_MS = 4000;
const STUN_SERVER = 'stun:stun.l.google.com:19302';

type Outcome = 'pending' | 'pass' | 'warn' | 'fail';
interface Check {
  id: string;
  label: string;
  outcome: Outcome;
  detail: string;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function checkServer(): Promise<Pick<Check, 'outcome' | 'detail'>> {
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  const samples: number[] = [];
  for (let i = 0; i < LATENCY_SAMPLES; i += 1) {
    const started = performance.now();
    const res = await fetch(`${base}/health/live?n=${i}`, { cache: 'no-store' });
    if (!res.ok) return { outcome: 'fail', detail: `The server answered with an error (${res.status}).` };
    samples.push(performance.now() - started);
  }
  const typical = Math.round(median(samples));
  return typical > SLOW_LATENCY_MS
    ? { outcome: 'warn', detail: `Reachable but slow, about ${typical} ms. Low bandwidth mode may help.` }
    : { outcome: 'pass', detail: `Reachable, about ${typical} ms.` };
}

// Gathers connection candidates without opening a call, which shows what the network allows.
function checkPeerConnection(): Promise<Pick<Check, 'outcome' | 'detail'>> {
  return new Promise((resolve) => {
    if (typeof RTCPeerConnection === 'undefined') {
      resolve({ outcome: 'fail', detail: 'This browser does not support real-time media.' });
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_SERVER }] });
    const kinds = new Set<string>();
    const finish = () => {
      pc.close();
      if (kinds.has('srflx') || kinds.has('relay')) resolve({ outcome: 'pass', detail: 'Your network allows direct media connections.' });
      else if (kinds.size > 0) resolve({ outcome: 'warn', detail: 'Only local connections were found. A firewall may block media on this network.' });
      else resolve({ outcome: 'fail', detail: 'No media connection could be prepared on this network.' });
    };
    const timer = setTimeout(finish, ICE_WAIT_MS);
    pc.onicecandidate = (event) => {
      if (event.candidate?.type) kinds.add(event.candidate.type);
      if (!event.candidate) {
        clearTimeout(timer);
        finish();
      }
    };
    pc.createDataChannel('check');
    pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => {
      clearTimeout(timer);
      resolve({ outcome: 'fail', detail: 'This browser could not prepare a media connection.' });
    });
  });
}

// Asks only for what is needed to count devices and releases it straight away.
async function checkDevice(kind: 'audio' | 'video'): Promise<Pick<Check, 'outcome' | 'detail'>> {
  if (!navigator.mediaDevices?.getUserMedia) return { outcome: 'fail', detail: 'This page needs a secure connection to reach your devices.' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: true } : { video: true });
    const [track] = stream.getTracks();
    const label = track?.label || 'Default device';
    stream.getTracks().forEach((t) => t.stop());
    return { outcome: 'pass', detail: `Working: ${label}.` };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError') return { outcome: 'warn', detail: 'Permission was not given. Allow it in your browser settings to use it in meetings.' };
    if (name === 'NotFoundError') return { outcome: 'warn', detail: 'No device found. You can still join and listen.' };
    return { outcome: 'fail', detail: 'The device could not be started. Another app may be using it.' };
  }
}

const INITIAL: Check[] = [
  { id: 'server', label: 'Connect servers', outcome: 'pending', detail: 'Checking…' },
  { id: 'network', label: 'Media connection', outcome: 'pending', detail: 'Checking…' },
  { id: 'microphone', label: 'Microphone', outcome: 'pending', detail: 'Checking…' },
  { id: 'camera', label: 'Camera', outcome: 'pending', detail: 'Checking…' },
];

const ICONS = {
  pending: <Loader2 className="w-5 h-5 animate-spin text-[#686868]" aria-hidden="true" />,
  pass: <CheckCircle2 className="w-5 h-5 text-green-700" aria-hidden="true" />,
  warn: <CircleAlert className="w-5 h-5 text-amber-700" aria-hidden="true" />,
  fail: <XCircle className="w-5 h-5 text-red-700" aria-hidden="true" />,
};

export default function DiagnosticsPage() {
  const [checks, setChecks] = useState(INITIAL);
  const [running, setRunning] = useState(true);

  const run = useCallback(async () => {
    setRunning(true);
    setChecks(INITIAL);
    const update = (id: string, result: Pick<Check, 'outcome' | 'detail'>) =>
      setChecks((current) => current.map((c) => (c.id === id ? { ...c, ...result } : c)));
    const attempt = async (id: string, check: () => Promise<Pick<Check, 'outcome' | 'detail'>>) => {
      try {
        update(id, await check());
      } catch {
        update(id, { outcome: 'fail', detail: 'This could not be reached. Check your connection.' });
      }
    };
    await Promise.all([attempt('server', checkServer), attempt('network', checkPeerConnection)]);
    await attempt('microphone', () => checkDevice('audio'));
    await attempt('camera', () => checkDevice('video'));
    setRunning(false);
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <main className="min-h-screen bg-[#FCFCFA] px-4 py-6">
      <div className="max-w-xl mx-auto space-y-4">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-[#686868] hover:text-[#171717] min-h-[44px]">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Home
        </Link>
        <h1 className="text-xl font-bold text-[#171717]">Connection check</h1>
        <ul className="space-y-2">
          {checks.map((check) => (
            <li key={check.id} data-testid={`check-${check.id}`} data-outcome={check.outcome} className="p-4 rounded-2xl border border-[#E9E9E5] bg-white flex items-start gap-3">
              {ICONS[check.outcome]}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#171717]">{check.label}</p>
                <p className="text-xs text-[#404040] break-words">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" disabled={running} onClick={run} className="rounded-xl border border-[#E9E9E5] text-sm font-semibold text-[#171717] px-4 min-h-[44px] disabled:opacity-60">
          Check again
        </button>
      </div>
    </main>
  );
}
