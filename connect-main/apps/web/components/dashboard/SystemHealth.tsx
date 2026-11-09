'use client';

import React, { useEffect, useState } from 'react';
import { Activity, Database, HardDrive, Sparkles } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { formatBytes } from '@/features/dashboard/format';

interface Health {
  activeRooms: number; scheduledRooms: number; peopleInClassNow: number; members: number; courses: number; classSessions: number;
  attendanceRecords: number; aiRequestsThisMonth: number; aiTokensThisMonth: number; aiBilledMicroUsdThisMonth: number;
  aiMonthlyBudgetMicroUsd: number | null; files: number; storageBytes: number; transcriptLines: number; recordings: number;
  databaseBytes?: number; largestTables?: { table: string; rows: number; bytes: number }[];
}

function Metric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div data-testid={testId}>
      <dt className="text-[11px] text-[#5F5F68]">{label}</dt>
      <dd className="text-lg font-bold text-[#17171A] tabular-nums">{value}</dd>
    </div>
  );
}

// Live rooms, AI use against budget, storage, and (for platform admins) database size.
export function SystemHealth({ orgId }: { orgId: string }) {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    let current = true;
    setH(null);
    apiFetch<{ health: Health }>(`/api/v1/organizations/${encodeURIComponent(orgId)}/admin/health`, { method: 'GET' })
      .then((r) => { if (current) setH(r.health); })
      .catch(() => undefined); // only administrators and auditors see this card
    return () => { current = false; };
  }, [orgId]);
  if (!h) return null;
  const budget = h.aiMonthlyBudgetMicroUsd ?? 0;
  const spent = h.aiBilledMicroUsdThisMonth;
  const used = budget > 0 ? Math.min(1, spent / budget) : 0;
  const card = 'neu-card p-4 space-y-3';
  const title = 'font-heading font-bold text-sm text-[#17171A] flex items-center gap-2';
  return (
    <section aria-label="System health and quotas" className="space-y-3" data-testid="system-health">
      <h2 className="font-heading font-bold text-[#17171A]">System health and quotas</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <div className={card}>
          <h3 className={title}><Activity className="w-4 h-4 text-[#2DBE74]" /> Live now</h3>
          <dl className="grid grid-cols-2 gap-3">
            <Metric testId="health-active-rooms" label="Rooms in progress" value={String(h.activeRooms)} />
            <Metric label="People in class" value={String(h.peopleInClassNow)} />
            <Metric label="Scheduled rooms" value={String(h.scheduledRooms)} />
            <Metric label="Members" value={String(h.members)} />
          </dl>
        </div>
        <div className={card}>
          <h3 className={title}><Sparkles className="w-4 h-4 text-[#7444E8]" /> AI this month</h3>
          <dl className="grid grid-cols-2 gap-3">
            <Metric testId="health-ai-tokens" label="Tokens" value={h.aiTokensThisMonth.toLocaleString()} />
            <Metric label="Requests" value={h.aiRequestsThisMonth.toLocaleString()} />
          </dl>
          <div>
            <p className="text-[11px] text-[#5F5F68] mb-1">{budget > 0 ? `Billed $${(spent / 1e6).toFixed(2)} of $${(budget / 1e6).toFixed(2)} budget` : `Free-tier models only; billed $${(spent / 1e6).toFixed(2)}`}</p>
            <div className="h-2.5 rounded-full neu-well overflow-hidden" role="progressbar" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full" style={{ width: `${used * 100}%`, backgroundColor: used > 0.85 ? '#FF6B6B' : '#7444E8' }} />
            </div>
          </div>
        </div>
        <div className={card}>
          <h3 className={title}><HardDrive className="w-4 h-4 text-[#B8860B]" /> Storage and records</h3>
          <dl className="grid grid-cols-2 gap-3">
            <Metric testId="health-storage" label="Shared files" value={`${formatBytes(h.storageBytes)} · ${h.files}`} />
            <Metric label="Transcript lines" value={h.transcriptLines.toLocaleString()} />
            <Metric label="Class sessions" value={h.classSessions.toLocaleString()} />
            <Metric label="Attendance records" value={h.attendanceRecords.toLocaleString()} />
          </dl>
        </div>
      </div>
      {h.databaseBytes !== undefined && (
        <div className={card} data-testid="health-database">
          <h3 className={title}><Database className="w-4 h-4 text-[#5F5F68]" /> Database (platform administrators)</h3>
          <p className="text-sm text-[#17171A]">Total size {formatBytes(h.databaseBytes)}</p>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[#5F5F68]"><th className="py-1">Table</th><th>Rows (estimate)</th><th>Size</th></tr></thead>
            <tbody>{(h.largestTables ?? []).map((t) => <tr key={t.table} className="border-t border-[#F0EEE8]"><td className="py-1 font-mono">{t.table}</td><td className="tabular-nums">{t.rows.toLocaleString()}</td><td className="tabular-nums">{formatBytes(t.bytes)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
