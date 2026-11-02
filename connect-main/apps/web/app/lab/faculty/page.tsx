'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import { FacultyDashboard } from '@/features/lab/components/FacultyDashboard';
import type { FacultyOverview } from '@/features/lab/types';
import { getSession } from '@/features/auth/api';
import { listOrganizations } from '@/features/institution/api';
import { fetchFacultyOverview } from '@/features/lab/api';

const FACULTY_ROLES = ['institution_admin', 'department_coordinator', 'faculty'];

export default function FacultyPortalPage() {
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string>('');
  const [isAuthorized, setIsAuthorized] = useState<boolean>(true);
  const [overview, setOverview] = useState<FacultyOverview>({
    pending_submissions: 0,
    graded_submissions: 0,
    total_assignments: 0,
    recent_submissions: [],
    course_stats: [],
  });

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const user = await getSession().catch(() => null);
        if (!user) {
          if (isMounted) {
            setIsAuthorized(false);
            setLoading(false);
          }
          return;
        }

        const orgs = await listOrganizations().catch(() => []);
        const permittedOrg = orgs.find((o) => FACULTY_ROLES.includes(o.role)) || orgs[0];

        if (!permittedOrg || !FACULTY_ROLES.includes(permittedOrg.role)) {
          if (isMounted) {
            setIsAuthorized(false);
            setLoading(false);
          }
          return;
        }

        if (isMounted) setOrgId(permittedOrg.id);

        const res = await fetchFacultyOverview(permittedOrg.id).catch(() => null);
        if (isMounted && res && res.overview) {
          setOverview(res.overview);
        }
      } catch {
        // Fallback gracefully
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FAF9FC]">
        <Loader2 className="w-6 h-6 animate-spin text-[#7444E8]" aria-label="Loading faculty portal" />
      </main>
    );
  }

  if (!isAuthorized) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FAF9FC] px-4">
        <div className="text-center space-y-4 max-w-md p-8 rounded-3xl bg-white border border-[#E4E2DB] shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-[#17151F]">Faculty Authorization Required</h1>
          <p className="text-xs text-[#5E5A50] leading-relaxed">
            The faculty grading portal is restricted to institutional instructors and course coordinators.
          </p>
          <div className="pt-2 flex justify-center gap-3">
            <Link
              href="/lab"
              className="px-4 py-2 bg-[#7444E8] text-white text-xs font-semibold rounded-xl hover:bg-[#6537D6] transition-colors"
            >
              Return to Lab Hub
            </Link>
            <Link
              href="/sign-in?redirect=/lab/faculty"
              className="px-4 py-2 border border-[#E4E2DB] text-xs font-semibold rounded-xl hover:bg-[#FAF9FC] transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9FC]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        <Link
          href="/lab"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5E5A50] hover:text-[#17151F] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Lab Hub
        </Link>
      </div>
      <FacultyDashboard overview={overview} orgId={orgId} />
    </div>
  );
}
