import React from 'react';
import { notFound } from 'next/navigation';
import { PILOT_COURSES } from '@/features/lab/runtimes/starterTemplates';
import { CourseWorkspace } from '@/features/lab/components/CourseWorkspace';

interface CoursePageProps {
  params: Promise<{ slug: string }>;
}

export default async function CoursePage({ params }: CoursePageProps) {
  const { slug } = await params;
  const course = PILOT_COURSES.find((c) => c.slug === slug);

  if (!course) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[#FAF9FC]">
      <CourseWorkspace course={course} />
    </div>
  );
}
