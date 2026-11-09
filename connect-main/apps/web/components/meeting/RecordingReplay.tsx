'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, FileVideo } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { formatOffset, offsetInRecording } from '@/features/meeting/offset';

interface Marker { atMs: number; kind: 'slide' | 'transcript' | 'note'; label: string }
interface Recording { id: string; startedAt: string; endedAt: string; fileName: string; markers: Marker[] }
interface Line { speakerName: string; spokenAt: string; text: string; lang: string }

// Replay of a recording the host made locally. The video file stays with whoever has it; this
// page plays it from their computer and jumps to slide changes and transcript lines at MM:SS.
export function RecordingReplay({ meetingId }: { meetingId: string }) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [selected, setSelected] = useState<Recording | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let current = true;
    const base = `/api/v1/meetings/${encodeURIComponent(meetingId)}`;
    Promise.all([
      apiFetch<{ recordings: Recording[] }>(`${base}/recordings`, { method: 'GET' }).catch(() => ({ recordings: [] })),
      apiFetch<{ segments: Line[] }>(`${base}/transcript`, { method: 'GET' }).catch(() => ({ segments: [] })),
    ]).then(([r, t]) => {
      if (!current) return;
      setRecordings(r.recordings);
      setLines(t.segments);
      setSelected(r.recordings[0] ?? null);
    });
    return () => {
      current = false;
    };
  }, [meetingId]);

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  // Everything that can be jumped to, in time order: markers and, within the recording, transcript lines.
  const timeline = useMemo(() => {
    if (!selected) return [];
    const fromLines: Marker[] = [];
    for (const l of lines) {
      const atMs = offsetInRecording(l.spokenAt, selected.startedAt, selected.endedAt);
      if (atMs !== null) fromLines.push({ atMs, kind: 'transcript', label: `${l.speakerName}: ${l.text}` });
    }
    const slides = selected.markers.filter((m) => m.kind !== 'transcript');
    // Transcript lines come from the stored transcript; recorder copies of them would repeat.
    const all = [...slides, ...(fromLines.length ? fromLines : selected.markers.filter((m) => m.kind === 'transcript'))];
    return all.sort((a, b) => a.atMs - b.atMs);
  }, [selected, lines]);

  const shown = filter.trim() ? timeline.filter((m) => m.label.toLowerCase().includes(filter.trim().toLowerCase())) : timeline;
  const seek = (ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    v.play().catch(() => undefined);
  };

  if (recordings.length === 0 && lines.length === 0) return null;
  return (
    <section className="neu-card p-4 space-y-3" data-testid="recording-replay">
      <h2 className="text-sm font-semibold text-[#171717] flex items-center gap-1.5"><Clapperboard className="w-4 h-4 text-[#7444E8]" aria-hidden="true" /> Replay and transcript</h2>
      {recordings.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Recording" value={selected?.id ?? ''} onChange={(e) => setSelected(recordings.find((r) => r.id === e.target.value) ?? null)}
              className="neu-well !rounded-xl px-3 min-h-[40px] text-sm bg-transparent">
              {recordings.map((r) => (
                <option key={r.id} value={r.id}>{r.fileName} · {formatOffset(Date.parse(r.endedAt) - Date.parse(r.startedAt))}</option>
              ))}
            </select>
            <label className="neu-pill inline-flex items-center gap-1.5 px-3 min-h-[40px] text-xs font-semibold cursor-pointer">
              <FileVideo className="w-4 h-4" aria-hidden="true" /> Open the recording file
              <input type="file" accept="video/webm,video/*" className="sr-only" data-testid="recording-file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setVideoUrl(URL.createObjectURL(f)); }} />
            </label>
          </div>
          <p className="text-[11px] text-[#5F5F68]">Recordings stay on the computer that made them. Ask the host for <span className="font-mono">{selected?.fileName}</span>, then open it here.</p>
          {videoUrl && <video ref={videoRef} src={videoUrl} controls className="w-full rounded-2xl bg-black" data-testid="replay-video" />}
        </>
      ) : (
        <p className="text-xs text-[#5F5F68]">No recording was saved for this meeting; the transcript is below.</p>
      )}
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search the transcript and slides" aria-label="Search the transcript and slides"
        className="w-full neu-well !rounded-xl px-3 min-h-[40px] text-sm bg-transparent outline-none" />
      <ol className="max-h-80 overflow-y-auto space-y-1" data-testid="replay-timeline">
        {(selected ? shown : lines.map((l): Marker => ({ atMs: -1, kind: 'transcript', label: `${l.speakerName}: ${l.text}` }))).map((m, i) => (
          <li key={i}>
            <button type="button" disabled={!videoUrl || m.atMs < 0} onClick={() => seek(m.atMs)}
              className="w-full text-left flex gap-2 items-start rounded-xl px-2 py-1.5 hover:bg-[#F1EBFF] disabled:hover:bg-transparent">
              {m.atMs >= 0 && <span className="shrink-0 font-mono text-xs font-bold text-[#5A2FC7] pt-0.5">{formatOffset(m.atMs)}</span>}
              <span className={`text-sm ${m.kind === 'slide' ? 'font-semibold text-[#6B4E00]' : 'text-[#17171A]'}`}>{m.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
