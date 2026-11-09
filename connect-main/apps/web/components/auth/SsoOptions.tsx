'use client';

import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { listSsoProviders, ssoStartUrl, type SsoProvider } from '@/features/auth/api';

const SSO_ERRORS: Record<string, string> = {
  not_a_member: 'Your university account is not linked to a member here. Ask your institution admin to add you.',
  unknown_institution: 'That institution has not set up single sign-on.',
  not_configured: 'Single sign-on is not set up on this server.',
  session_expired: 'The sign-in took too long. Please try again.',
  state_mismatch: 'The sign-in could not be verified. Please try again.',
  too_many_attempts: 'Too many sign-in attempts. Wait a minute and try again.',
  provider_refused: 'Your university sign-in was cancelled or refused.',
  account_unavailable: 'This account is disabled.',
};

/** Lists the universities that sign in through their own identity provider, and explains any failed attempt. */
export function SsoOptions({ redirect, errorCode }: { redirect: string | null; errorCode: string | null }) {
  const [providers, setProviders] = useState<SsoProvider[]>([]);

  useEffect(() => {
    let live = true;
    listSsoProviders()
      .then((list) => { if (live) setProviders(list); })
      .catch(() => { /* single sign-on is optional; the password form still works */ });
    return () => { live = false; };
  }, []);

  const message = errorCode ? SSO_ERRORS[errorCode] ?? 'University sign-in failed. Please try again or use your password.' : null;
  if (!message && providers.length === 0) return null;

  return (
    <div className="mt-6" data-testid="sso-options">
      {message && (
        <div role="alert" data-testid="sso-error" className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {message}
        </div>
      )}
      {providers.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-xs text-[#686868] mb-3">
            <span className="h-px flex-1 bg-[#E9E9E5]" />
            or continue with your university
            <span className="h-px flex-1 bg-[#E9E9E5]" />
          </div>
          <div className="space-y-2">
            {providers.map((p) => (
              <a
                key={p.orgSlug}
                href={ssoStartUrl(p.orgSlug, redirect)}
                data-testid={`sso-${p.orgSlug}`}
                className="neu-pill flex w-full items-center justify-center gap-2 min-h-[44px] rounded-full text-sm font-semibold text-[#171717]"
              >
                <Building2 className="w-4 h-4 text-[#7444E8]" aria-hidden />
                {p.label || p.orgSlug}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
