'use client';

// Live captions from the host's microphone. Uses the browser's own speech recognition where it
// exists (Chrome and Edge send the audio to their vendor's speech service); otherwise records
// short chunks and sends them to the API, which uses Groq's free Whisper. Finished lines are
// saved to the meeting transcript in small batches.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api/client';

export type CaptionLang = 'en-IN' | 'hi-IN' | 'en-US';
export const CAPTION_LANGS: { value: CaptionLang; label: string }[] = [
  { value: 'en-IN', label: 'English (India) / Hinglish' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'en-US', label: 'English (US)' },
];

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const recognitionClass = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const speechEngine = (): 'browser' | 'whisper' | 'none' =>
  recognitionClass() ? 'browser' : typeof MediaRecorder !== 'undefined' ? 'whisper' : 'none';

const WHISPER_CHUNK_MS = 6000;
const FLUSH_MS = 2000;

interface Options {
  roomCode: string;
  lang: CaptionLang;
  /** Interim and final text, for live captions on everyone's screen. */
  onCaption: (text: string, final: boolean) => void;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function useLiveSpeechTranscription({ roomCode, lang, onCaption }: Options) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engine = speechEngine();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const queueRef = useRef<{ clientId: string; spokenAt: string; text: string; lang: CaptionLang }[]>([]);
  const wantedRef = useRef(false);
  const onCaptionRef = useRef(onCaption);
  onCaptionRef.current = onCaption;

  const flush = useCallback(async () => {
    const batch = queueRef.current.splice(0, 20);
    if (batch.length === 0) return;
    try {
      await apiFetch(`/api/v1/rooms/${encodeURIComponent(roomCode)}/transcript`, { method: 'POST', body: JSON.stringify({ segments: batch }) });
    } catch {
      queueRef.current.unshift(...batch); // try again on the next flush
      if (queueRef.current.length > 200) queueRef.current.splice(0, queueRef.current.length - 200);
    }
  }, [roomCode]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(flush, FLUSH_MS);
    return () => {
      clearInterval(timer);
      flush();
    };
  }, [active, flush]);

  const stop = useCallback(() => {
    wantedRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
    recognitionRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  const startBrowser = useCallback(() => {
    const Recognition = recognitionClass()!;
    const rec = new Recognition();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        onCaptionRef.current(text, result.isFinal);
        if (result.isFinal) queueRef.current.push({ clientId: newId(), spokenAt: new Date().toISOString(), text, lang });
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone or speech recognition was blocked.');
        stop();
      }
    };
    // Recognition stops by itself after silence; keep it going while captions are on.
    rec.onend = () => {
      if (wantedRef.current) {
        try {
          rec.start();
        } catch {
          // Already restarting.
        }
      }
    };
    recognitionRef.current = rec;
    rec.start();
  }, [lang, stop]);

  const startWhisper = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    streamRef.current = stream;
    const record = () => {
      if (!wantedRef.current) return;
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
      const chunks: Blob[] = [];
      const startedAt = new Date().toISOString();
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.onstop = async () => {
        record(); // the next chunk starts at once, so no speech falls between chunks
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 2000) return; // silence
        const form = new FormData();
        form.append('audio', blob, 'chunk.webm');
        form.append('lang', lang);
        form.append('clientId', newId());
        form.append('spokenAt', startedAt);
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/rooms/${encodeURIComponent(roomCode)}/transcript/audio`, { method: 'POST', body: form, credentials: 'include' });
          const body = await res.json().catch(() => ({}));
          if (res.ok && body.text) onCaptionRef.current(body.text, true);
          else if (!res.ok) setError(body?.error?.message ?? 'Captions are unavailable right now.');
        } catch {
          setError('Captions are unavailable right now.');
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), WHISPER_CHUNK_MS);
    };
    record();
  }, [lang, roomCode]);

  const start = useCallback(async () => {
    setError(null);
    wantedRef.current = true;
    try {
      if (engine === 'browser') startBrowser();
      else if (engine === 'whisper') await startWhisper();
      else throw new Error('This browser cannot caption speech.');
      setActive(true);
    } catch (err) {
      wantedRef.current = false;
      setError(err instanceof Error ? err.message : 'Captions could not start.');
    }
  }, [engine, startBrowser, startWhisper]);

  // A language change restarts recognition in the new language.
  useEffect(() => {
    if (!wantedRef.current || engine !== 'browser') return;
    const old = recognitionRef.current;
    if (old) {
      old.onend = null; // otherwise it would restart itself in the old language
      old.stop();
    }
    recognitionRef.current = null;
    startBrowser();
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => stop, [stop]);

  return { active, error, engine, start, stop };
}
