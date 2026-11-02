import React from 'react';
import { AssignmentCreator } from '@/features/lab/components/AssignmentCreator';
import { PILOT_COURSES } from '@/features/lab/runtimes/starterTemplates';

export default function NewAssignmentPage() {
  const dummyCourses = PILOT_COURSES.map((c, i) => ({
    id: `course-${i + 1}`,
    title: `${c.code}: ${c.title}`,
    slug: c.slug,
  }));

  return (
    <div className="min-h-screen bg-[#FAF9FC]">
      <AssignmentCreator
        orgId="11111111-1111-1111-1111-111111111111"
        courses={dummyCourses}
      />
    </div>
  );
}
