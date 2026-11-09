'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Presentation, X } from 'lucide-react';
import { getSavedDeck, listSavedDecks, type LiveDeck, type SavedDeckSummary } from '@/features/classroom/liveCanvas';
import { printDeck, SlideCard } from './LiveCanvas';

// Decks the teacher saved from the live canvas, opened after class from meeting history.
export function SavedDecks({ meetingId }: { meetingId: string }) {
  const [decks, setDecks] = useState<SavedDeckSummary[]>([]);
  const [open, setOpen] = useState<{ title: string; deck: LiveDeck } | null>(null);
  const [slide, setSlide] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    listSavedDecks(meetingId).then((list) => current && setDecks(list)).catch(() => undefined);
    return () => {
      current = false;
    };
  }, [meetingId]);

  if (decks.length === 0) return null;
  const show = async (id: string) => {
    setError(null);
    try {
      const d = await getSavedDeck(meetingId, id);
      setOpen({ title: d.title, deck: d.content });
      setSlide(0);
    } catch {
      setError('Could not open that deck.');
    }
  };

  return (
    <section className="neu-card p-4 space-y-3" data-testid="saved-decks">
      <h2 className="text-sm font-semibold text-[#171717] flex items-center gap-1.5"><Presentation className="w-4 h-4 text-[#7444E8]" aria-hidden="true" /> Class decks</h2>
      <ul className="flex flex-wrap gap-2">
        {decks.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => show(d.id)} className="neu-pill px-3 min-h-[40px] text-xs font-semibold text-[#17171A]">
              {d.title} · {d.slideCount} slides
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-xs text-[#9B2C2C]">{error}</p>}
      {open && (
        <div className="space-y-2" data-testid="saved-deck-viewer">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#171717] truncate">{open.title}</p>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous slide" disabled={slide === 0} onClick={() => setSlide(slide - 1)} className="neu-pill w-10 h-10 flex items-center justify-center disabled:opacity-50"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-xs font-semibold">Slide {slide + 1} of {open.deck.slides.length}</span>
              <button type="button" aria-label="Next slide" disabled={slide >= open.deck.slides.length - 1} onClick={() => setSlide(slide + 1)} className="neu-pill w-10 h-10 flex items-center justify-center disabled:opacity-50"><ChevronRight className="w-4 h-4" /></button>
              <button type="button" onClick={() => printDeck(open.deck)} className="neu-pill px-3 min-h-[40px] text-xs font-semibold inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" aria-hidden="true" /> PDF</button>
              <button type="button" aria-label="Close deck" onClick={() => setOpen(null)} className="neu-pill w-10 h-10 flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
          </div>
          <SlideCard slide={open.deck.slides[slide]} />
        </div>
      )}
    </section>
  );
}
