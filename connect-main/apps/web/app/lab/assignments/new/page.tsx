'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AssignmentCreator } from '@/features/lab/components/AssignmentCreator';
import { PILOT_COURSES } from '@/features/lab/runtimes/starterTemplates';
import { getSession } from '@/features/auth/api';
import { listOrganizations } from '@/features/institution/api';
import { fetchLabCourses } from '@/features/lab/api';

export default function NewAssignmentPage() {
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string>('33b4a67f-64fe-4410-bec0-579be3a780ee');
  const [courses, setCourses] = useState<Array<{ id: string; title: string; slug: string }>>([]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const defaultCourses = PILOT_COURSES.map((c, i) => ({
          id: `course-${i + 1}`,
          title: `${c.code}: ${c.title}`,
          slug: c.slug,
        }));

        const user = await getSession().catch(() => null);
        if (user) {
          const orgs = await listOrganizations().catch(() => []);
          if (orgs.length > 0) {
            const currentOrgId = orgs[0].id;
            if (isMounted) setOrgId(currentOrgId);

            const res = await fetchLabCourses(currentOrgId).catch(() => ({ courses: [] }));
            if (isMounted && res.courses && res.courses.length > 0) {
              setCourses(res.courses.map((c) => ({
                id: c.id,
                title: c.title,
                slug: c.slug,
              })));
              setLoading(false);
              return;
            }
          }
        }

        if (isMounted) setCourses(defaultCourses);
      } catch {
        if (isMounted) {
          setCourses(PILOT_COURSES.map((c, i) => ({
            id: `course-${i + 1}`,
            title: `${c.code}: ${c.title}`,
            slug: c.slug,
          })));
        }
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
        <Loader2 className="w-6 h-6 animate-spin text-[#7444E8]" aria-label="Loading assignment creator" />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9FC]">
      <AssignmentCreator orgId={orgId} courses={courses} />
    </div>
  );
}
