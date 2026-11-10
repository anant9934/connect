'use client';

import React, { useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { issuePasswordReset, Member } from '@/features/institution/api';

const RESETTABLE = new Set(['student', 'faculty', 'institution_member', 'department_coordinator']);

/** Whether an administrator may issue this member a reset code (never to administrators). */
export const canResetPassword = (m: Member) => m.status === 'active' && RESETTABLE.has(m.role);

// Issues a one-time password reset code for one member. The code is shown once, here only; the
// server keeps just its hash.
export function PasswordResetControl({ orgId, member }: { orgId: string; member: Member }) {
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reset = async () => {
    if (!window.confirm(`Issue a one-time password reset code for ${member.displayName}? Any earlier code stops working.`)) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setIssued(await issuePasswordReset(orgId, member.userId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue a code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" data-testid="reset-password" disabled={busy} onClick={reset}
        className="neu-pill inline-flex items-center gap-1.5 px-3 min-h-[36px] text-xs font-semibold text-[#17171A] disabled:opacity-50">
        <KeyRound className="w-3.5 h-3.5" aria-hidden="true" /> Reset password
      </button>
      {error && <p role="alert" className="w-full text-sm text-[#9B2C2C] bg-[#FFE9E9] rounded-xl p-2">{error}</p>}
      {issued && (
        <div role="status" data-testid="reset-code" className="w-full neu-card !rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 bg-[#FFF4D1]">
          <div>
            <p className="font-mono text-lg font-bold tracking-widest text-[#17171A]">{issued.code}</p>
            <p className="text-[11px] text-[#6B4E00]">
              Give this to {member.displayName} in person. It works once, until {new Date(issued.expiresAt).toLocaleString()}, at /reset-password. It will not be shown again.
            </p>
          </div>
          <button type="button" className="neu-pill inline-flex items-center gap-1.5 px-3 min-h-[36px] text-xs font-semibold"
            onClick={async () => { try { await navigator.clipboard.writeText(issued.code); setCopied(true); } catch { /* copy by hand */ } }}>
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </>
  );
}

// Members, with a password reset for those an administrator may reset.
export function PeopleList({ orgId, members, roleLabels }: { orgId: string; members: Member[]; roleLabels: Record<string, string> }) {
  if (members.length === 0) return <p className="text-sm text-[#686868]">Nobody here yet.</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-[#F0EEE8]" data-testid="people-list">
        {members.map((m) => (
          <li key={m.userId} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#171717] truncate">{m.displayName}</p>
              <p className="text-xs text-[#686868] break-all">
                {m.email} · {roleLabels[m.role] ?? m.role}
                {m.memberIdentifier ? ` · Reg. ${m.memberIdentifier}` : ''}
                {m.status === 'active' ? '' : ` · ${m.status}`}
              </p>
            </div>
            {canResetPassword(m) && <PasswordResetControl orgId={orgId} member={m} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
