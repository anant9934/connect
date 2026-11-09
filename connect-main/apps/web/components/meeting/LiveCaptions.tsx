'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Captions, CaptionsOff } from 'lucide-react';
import { CAPTION_LANGS, type CaptionLang, useLiveSpeechTranscription } from '@/features/meeting/useLiveSpeechTranscription';

export interface IncomingCaption { text: string; final: boolean; from: string; at: number }

interface LiveCaptionsProps {
  roomCode: string;
  /** Hosts and co-hosts caption their own speech; everyone sees the captions. */
  canCaption: boolean;
  incoming: IncomingCaption | null;
  sendCaption: (text: string, final: boolean) => void;
}

const INTERIM_INTERVAL_MS = 250;
const DISCLOSURE_KEY = 'tc-captions-disclosed';

// Live captions over the meeting. The host turns them on; finished lines go to the meeting
// transcript and to everyone's screen. Students can hide them for themselves.
export const LiveCaptions: React.FC<LiveCaptionsProps> = ({ roomCode, canCaption, incoming, sendCaption }) => {
  const [lang, setLang] = useState<CaptionLang>('en-IN');
  const [lines, setLines] = useState<string[]>([]);
  const [interim, setInterim] = useState('');
  const [hidden, setHidden] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const lastInterim = useRef(0);

  const show = (text: string, final: boolean) => {
    if (final) {
      setLines((prev) => [...prev, text].slice(-2));
      setInterim('');
      window.dispatchEvent(new CustomEvent('tc-marker', { detail: { kind: 'transcript', label: text } }));
    } else {
      setInterim(text);
    }
  };

  const speech = useLiveSpeechTranscription({
    roomCode,
    lang,
    onCaption: (text, final) => {
      show(text, final);
      const now = performance.now();
      if (final || now - lastInterim.current > INTERIM_INTERVAL_MS) {
        lastInterim.current = now;
        sendCaption(text, final);
      }
    },
  });

  useEffect(() => {
    if (incoming) show(incoming.text, incoming.final);
  }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps

  // Captions fade out after a quiet spell.
  useEffect(() => {
    if (lines.length === 0 && !interim) return;
    const timer = setTimeout(() => { setLines([]); setInterim(''); }, 8000);
    return () => clearTimeout(timer);
  }, [lines, interim]);

  const start = () => {
    let disclosed = false;
    try { disclosed = localStorage.getItem(DISCLOSURE_KEY) === '1'; } catch { /* ask again */ }
    if (!disclosed) { setConfirming(true); return; }
    speech.start();
  };

  const hasText = lines.length > 0 || interim;
  return (
    <>
      <div className="flex flex-col items-center gap-2" data-testid="captions-control">
        {canCaption ? (
          <div className="neu-surface rounded-2xl p-1.5 flex items-center gap-1.5">
            <select aria-label="Caption language" value={lang} onChange={(e) => setLang(e.target.value as CaptionLang)}
              className="bg-transparent text-xs font-semibold text-[#17171A] min-h-[36px] max-w-[11rem] px-1">
              {CAPTION_LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <button type="button" data-testid="captions-toggle" aria-pressed={speech.active} onClick={() => (speech.active ? speech.stop() : start())}
              className={`neu-pill inline-flex items-center gap-1.5 px-3 min-h-[36px] text-xs font-bold ${speech.active ? 'text-[#1F6B3B] !bg-[#E4F8EB]' : 'text-[#17171A]'}`}>
              {speech.active ? <Captions className="w-4 h-4" aria-hidden="true" /> : <CaptionsOff className="w-4 h-4" aria-hidden="true" />}
              {speech.active ? 'Captions on' : 'Start captions'}
            </button>
          </div>
        ) : (
          <button type="button" aria-pressed={!hidden} onClick={() => setHidden(!hidden)} aria-label={hidden ? 'Show captions' : 'Hide captions'}
            className="neu-pill w-10 h-10 flex items-center justify-center text-[#17171A]">
            {hidden ? <CaptionsOff className="w-4 h-4" /> : <Captions className="w-4 h-4" />}
          </button>
        )}
        {speech.error && <p role="alert" className="text-[11px] text-[#9B2C2C] bg-[#FFE9E9] rounded-lg px-2 py-1 max-w-[16rem]">{speech.error}</p>}
      </div>

      {confirming && (
        <div role="dialog" aria-label="Before you start captions" className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="neu-card p-5 max-w-sm space-y-3">
            <h3 className="font-heading font-bold text-[#17171A]">Before captions start</h3>
            <p className="text-sm text-[#5F5F68]">
              {speech.engine === 'browser'
                ? 'Your browser turns your speech into text using its own speech service (Google, for Chrome). '
                : 'Your speech is sent in short clips to the meeting server, which uses Groq Whisper to turn it into text. '}
              Captions are shown to everyone here and saved to this meeting&apos;s transcript, which members can read later.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="neu-pill px-4 min-h-[40px] text-sm font-semibold" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" data-testid="captions-confirm" className="neu-pill px-4 min-h-[40px] text-sm font-semibold !bg-[#7444E8] !text-white"
                onClick={() => { try { localStorage.setItem(DISCLOSURE_KEY, '1'); } catch { /* ask next time */ } setConfirming(false); speech.start(); }}>
                Start captions
              </button>
            </div>
          </div>
        </div>
      )}

      {hasText && !hidden && (
        <div role="status" aria-live="polite" data-testid="caption-bar"
          className="fixed left-1/2 -translate-x-1/2 bottom-24 z-30 w-[min(92vw,760px)] rounded-2xl bg-[#17171A]/85 text-white px-4 py-2.5 text-center text-[clamp(0.9rem,1.8vw,1.15rem)] leading-snug shadow-lg">
          {lines.map((l, i) => <p key={i} className={i < lines.length - 1 && interim ? 'opacity-70' : ''}>{l}</p>)}
          {interim && <p className="text-[#FFF4D1]">{interim}</p>}
        </div>
      )}
    </>
  );
};
