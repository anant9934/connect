'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Circle, Square } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { formatOffset } from '@/features/meeting/offset';

interface Marker { atMs: number; kind: 'slide' | 'transcript' | 'note'; label: string }

const pickMime = () =>
  ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

// Records this meeting tab and the host's microphone in the host's browser, at no cloud cost.
// The file downloads to the host's computer when recording stops; slide changes and caption
// lines are kept as markers (stored with the meeting) so replay can jump to them.
export const LocalRecorder: React.FC<{ roomCode: string }> = ({ roomCode }) => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef<Date | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onMarker = (e: Event) => {
      const { kind, label } = (e as CustomEvent).detail ?? {};
      if (!startedRef.current || typeof label !== 'string' || !['slide', 'transcript', 'note'].includes(kind)) return;
      markersRef.current.push({ atMs: Date.now() - startedRef.current.getTime(), kind, label: label.slice(0, 300) });
    };
    window.addEventListener('tc-marker', onMarker);
    const timer = setInterval(() => startedRef.current && setElapsed(Date.now() - startedRef.current.getTime()), 500);
    return () => {
      window.removeEventListener('tc-marker', onMarker);
      clearInterval(timer);
    };
  }, [recording]);

  const cleanup = () => {
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    audioRef.current?.close().catch(() => undefined);
    audioRef.current = null;
  };

  const start = async () => {
    setMessage(null);
    try {
      // The tab carries everyone's video and audio as this host sees and hears them.
      const tab = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 24 },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      } as DisplayMediaStreamOptions);
      streamsRef.current.push(tab);
      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamsRef.current.push(mic);
      } catch {
        // Recording continues without the host's own voice.
      }
      const context = new AudioContext();
      audioRef.current = context;
      const mix = context.createMediaStreamDestination();
      if (tab.getAudioTracks().length) context.createMediaStreamSource(tab).connect(mix);
      if (mic) context.createMediaStreamSource(mic).connect(mix);
      const stream = new MediaStream([...tab.getVideoTracks(), ...mix.stream.getAudioTracks()]);
      const mimeType = pickMime();
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_000_000 });
      chunksRef.current = [];
      markersRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.onstop = finish;
      // Stopping the share from the browser's own bar ends the recording too.
      tab.getVideoTracks()[0]?.addEventListener('ended', () => recorder.state !== 'inactive' && recorder.stop());
      startedRef.current = new Date();
      recorder.start(1000);
      recorderRef.current = recorder;
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      cleanup();
      setMessage(err instanceof Error && err.name === 'NotAllowedError' ? 'Recording needs permission to capture this tab.' : 'Recording could not start in this browser.');
    }
  };

  async function finish() {
    const startedAt = startedRef.current;
    const endedAt = new Date();
    setRecording(false);
    cleanup();
    if (!startedAt || chunksRef.current.length === 0) return;
    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || 'video/webm' });
    chunksRef.current = [];
    const stamp = startedAt.toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const fileName = `class-${roomCode}-${stamp}.webm`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    try {
      await apiFetch(`/api/v1/rooms/${encodeURIComponent(roomCode)}/recordings`, {
        method: 'POST',
        body: JSON.stringify({ startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), fileName, markers: markersRef.current.slice(0, 1000) }),
      });
      setMessage(`Saved ${fileName} to your downloads. Open it from meeting history to replay with markers.`);
    } catch {
      setMessage(`Saved ${fileName} to your downloads, but its markers could not be stored.`);
    }
  }

  const stop = () => recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();

  return (
    <div className="flex flex-col items-center gap-2" data-testid="local-recorder">
      <button type="button" data-testid="record-toggle" aria-pressed={recording} onClick={recording ? stop : start}
        className={`neu-pill inline-flex items-center gap-1.5 px-3 min-h-[36px] text-xs font-bold ${recording ? 'text-[#C2261C] !bg-[#FFE9E9]' : 'text-[#17171A]'}`}>
        {recording ? <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" /> : <Circle className="w-3.5 h-3.5 fill-[#FF3B30] text-[#FF3B30]" aria-hidden="true" />}
        {recording ? `Stop · ${formatOffset(elapsed)}` : 'Record locally'}
      </button>
      {message && <p role="status" className="text-[11px] text-[#17171A] bg-white/95 border border-[#ECECE6] rounded-lg px-2 py-1 max-w-[18rem]">{message}</p>}
    </div>
  );
};
