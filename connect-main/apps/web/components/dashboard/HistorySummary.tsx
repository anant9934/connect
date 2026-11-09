'use client';

import React, { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, Clock, Presentation } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

interface Summary { meetings: number; ended: number; upcoming: number; avgMinutes: number; doubtsResolved: number; doubtsOpen: number; savedDecks: number; recordings: number; transcribed: number }

function Card({ icon, label, value, detail, tint, ink, testId }: { icon: React.ReactNode; label: string; value: string; detail: string; tint: string; ink: string; testId: string }) {
  return (
    <div className="neu-card p-4 space-y-1" data-testid={testId}>
      <span className="inline-flex w-8 h-8 rounded-xl items-center justify-center" style={{ backgroundColor: tint, color: ink }}>{icon}</span>
      <p className="font-heading text-2xl font-extrabold tracking-tight text-[#17171A] tabular-nums">{value}</p>
      <p className="text-xs font-semibold text-[#17171A]">{label}</p>
      <p className="text-[11px] text-[#5F5F68]">{detail}</p>
    </div>
  );
}

// Your classes at a glance, above the meeting list.
export function HistorySummary() {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    apiFetch<{ summary: Summary }>('/api/v1/meetings/summary', { method: 'GET' }).then((r) => setS(r.summary)).catch(() => setS(null));
  }, []);
  if (!s) return null;
  return (
    <section aria-label="Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="history-summary">
      <Card testId="summary-classes" icon={<BookOpen className="w-4 h-4" />} label="Classes" value={String(s.meetings)} detail={`${s.ended} finished · ${s.upcoming} upcoming`} tint="#F1EBFF" ink="#5A2FC7" />
      <Card testId="summary-minutes" icon={<Clock className="w-4 h-4" />} label="Average time in class" value={`${s.avgMinutes} min`} detail="Across classes you joined" tint="#E4F8EB" ink="#1F6B3B" />
      <Card testId="summary-doubts" icon={<CheckCircle2 className="w-4 h-4" />} label="Questions resolved" value={String(s.doubtsResolved)} detail={`${s.doubtsOpen} still open`} tint="#FFF4D1" ink="#6B4E00" />
      <Card testId="summary-material" icon={<Presentation className="w-4 h-4" />} label="Saved decks" value={String(s.savedDecks)} detail={`${s.recordings} recordings · ${s.transcribed} transcribed classes`} tint="#FFE9E9" ink="#9B2C2C" />
    </section>
  );
}
