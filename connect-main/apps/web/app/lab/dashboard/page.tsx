'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { StudentDashboard } from '@/features/lab/components/StudentDashboard';
import type { LabStudentProgress } from '@/features/lab/types';
import { getSession } from '@/features/auth/api';
import { listOrganizations } from '@/features/institution/api';
import { fetchStudentProgress } from '@/features/lab/api';

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [progressList, setProgressList] = useState<LabStudentProgress[]>([]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const user = await getSession().catch(() => null);
        if (!user) {
          if (isMounted) setLoading(false);
          return;
        }

        const orgs = await listOrganizations().catch(() => []);
        if (orgs.length > 0) {
          const res = await fetchStudentProgress(orgs[0].id).catch(() => ({ progress: [] }));
          if (isMounted && res.progress && res.progress.length > 0) {
            setProgressList(res.progress);
            setLoading(false);
            return;
          }
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
        <Loader2 className="w-6 h-6 animate-spin text-[#7444E8]" aria-label="Loading student dashboard" />
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
      <StudentDashboard progressList={progressList} />
    </div>
  );
}
