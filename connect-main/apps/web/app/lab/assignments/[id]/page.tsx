'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { AssignmentSolver } from '@/features/lab/components/AssignmentSolver';
import type { LabAssignment } from '@/features/lab/types';
import { getSession } from '@/features/auth/api';
import { listOrganizations } from '@/features/institution/api';
import { fetchLabAssignment } from '@/features/lab/api';

const DEFAULT_ASSIGNMENT: LabAssignment = {
  id: '34880d8a-a5b0-424d-9d65-b8bf53e47ab7',
  organization_id: '33b4a67f-64fe-4410-bec0-579be3a780ee',
  lab_course_id: 'cbca5013-0b03-451c-bc6c-5796addb4eca',
  created_by_user_id: '3a545995-25b4-4a9e-a37b-32f75f6e2c75',
  title: 'Practical Lab: Dynamic Array Template with Memory Boundary Checks',
  description: `Problem Statement:
Design and implement a generic Container class template in C++ or Python that manages a dynamically allocated buffer.

Requirements:
1. Provide push(element) to insert at the end, resizing buffer by a factor of 2 when capacity is exceeded.
2. Provide pop() which removes the last element and returns it.
3. Provide at(index) that throws or prints an error message if index is out of bounds.
4. Correctly free all heap allocated memory in destructor with zero memory leaks.

Example:
Input:
push 10
push 20
pop
at 0

Expected Output:
20
10`,
  allowed_languages: ['cpp', 'python', 'java'],
  starter_code: {
    code: `#include <iostream>
using namespace std;

// Implement your solution here

int main() {
    cout << "20" << endl;
    cout << "10" << endl;
    return 0;
}`,
  },
  due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  max_score: 100,
  status: 'published',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  test_cases: [
    {
      id: 'tc-01',
      organization_id: '33b4a67f-64fe-4410-bec0-579be3a780ee',
      assignment_id: '34880d8a-a5b0-424d-9d65-b8bf53e47ab7',
      input: '5\n',
      expected_output: '20\n10',
      is_hidden: false,
      weight: 1,
      time_limit_ms: 2000,
    },
  ],
};

export default function AssignmentPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';

  const [loading, setLoading] = useState(true);
  const [assignment, setAssignment] = useState<LabAssignment | null>(null);
  const [orgId, setOrgId] = useState<string>('33b4a67f-64fe-4410-bec0-579be3a780ee');

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const user = await getSession().catch(() => null);
        if (user) {
          const orgs = await listOrganizations().catch(() => []);
          if (orgs.length > 0) {
            const currentOrgId = orgs[0].id;
            if (isMounted) setOrgId(currentOrgId);
            if (id) {
              const res = await fetchLabAssignment(currentOrgId, id).catch(() => null);
              if (isMounted && res && res.assignment) {
                // Ensure hidden test cases are sanitized
                const sanitized: LabAssignment = {
                  ...res.assignment,
                  test_cases: (res.assignment.test_cases || []).filter((tc) => !tc.is_hidden),
                };
                setAssignment(sanitized);
                setLoading(false);
                return;
              }
            }
          }
        }

        // Fallback to default student assignment
        if (isMounted) {
          setAssignment({
            ...DEFAULT_ASSIGNMENT,
            id: id || DEFAULT_ASSIGNMENT.id,
          });
        }
      } catch {
        if (isMounted) {
          setAssignment(DEFAULT_ASSIGNMENT);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [id]);

  if (loading || !assignment) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FAF9FC]">
        <Loader2 className="w-6 h-6 animate-spin text-[#7444E8]" aria-label="Loading assignment solver" />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9FC]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <Link
          href="/lab/assignments"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5E5A50] hover:text-[#17151F] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Assignments
        </Link>
      </div>
      <AssignmentSolver assignment={assignment} orgId={orgId} />
    </div>
  );
}
