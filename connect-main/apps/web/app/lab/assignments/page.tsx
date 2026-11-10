'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, Plus, ArrowRight, Loader2, FileCheck2 } from 'lucide-react';
import { getSession } from '@/features/auth/api';
import { listOrganizations } from '@/features/institution/api';
import { fetchLabAssignments } from '@/features/lab/api';
import type { LabAssignment } from '@/features/lab/types';

export default function AssignmentsPage() {
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<LabAssignment[]>([]);
  const [isStaff, setIsStaff] = useState(false);

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
          const role = orgs[0].role;
          if (['institution_admin', 'department_coordinator', 'faculty'].includes(role)) {
            if (isMounted) setIsStaff(true);
          }

          const res = await fetchLabAssignments(orgs[0].id).catch(() => ({ assignments: [] }));
          if (isMounted && res.assignments && res.assignments.length > 0) {
            setAssignments(res.assignments);
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

  return (
    <div className="min-h-screen bg-[#FAF9FC] py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/lab"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5E5A50] hover:text-[#17151F] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Lab Hub
          </Link>

          {isStaff && (
            <Link
              href="/lab/assignments/new"
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-semibold rounded-2xl shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" /> Create Assignment
            </Link>
          )}
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-[#17151F]">Class Practical Assignments</h1>
          <p className="text-xs text-[#5E5A50]">
            Review assigned coding assessments, verify solutions against public sample tests, and submit for automated grading.
          </p>
        </div>

        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-[#7444E8]" aria-label="Loading assignments" />
          </div>
        ) : assignments.length > 0 ? (
          <div className="space-y-4">
            {assignments.map((assign) => (
              <div
                key={assign.id}
                className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-[#7444E8] transition-all"
              >
                <div className="space-y-2 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#FAF9FC] border border-[#E4E2DB] text-[#17151F]">
                      {assign.allowed_languages.join(', ').toUpperCase()}
                    </span>
                    <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-[#E4F8EB] text-[#1F6B3B] flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Due {new Date(assign.due_at).toLocaleDateString()}
                    </span>
                    <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-[#F1EBFF] text-[#7444E8]">
                      {assign.max_score} Marks
                    </span>
                  </div>

                  <h2 className="text-lg font-bold text-[#17151F]">{assign.title}</h2>
                  <p className="text-xs text-[#5E5A50] leading-relaxed line-clamp-2">{assign.description}</p>
                </div>

                <div className="shrink-0 flex items-center gap-3">
                  <Link
                    href={`/lab/assignments/${assign.id}`}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-bold rounded-2xl shadow-xs transition-colors"
                  >
                    Solve Assignment <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div data-testid="assignments-empty" className="neu-card p-8 sm:p-10 text-center space-y-3">
            <span className="mx-auto inline-flex w-12 h-12 rounded-2xl items-center justify-center bg-[#F1EBFF] text-[#7444E8]">
              <FileCheck2 className="w-6 h-6" aria-hidden="true" />
            </span>
            <h2 className="text-base font-bold text-[#17151F]">No assignments yet</h2>
            <p className="text-sm text-[#5E5A50] max-w-md mx-auto">
              Assignments your faculty publish appear here with their due dates and test cases. Until then, practise in the course workspaces.
            </p>
            <Link href="/lab" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#7444E8] hover:underline">
              Browse course workspaces <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
