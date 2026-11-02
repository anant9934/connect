import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { StudentDashboard } from '@/features/lab/components/StudentDashboard';
import type { LabStudentProgress } from '@/features/lab/types';

export default function DashboardPage() {
  const dummyProgress: LabStudentProgress[] = [
    {
      id: 'p-1',
      organization_id: '11111111-1111-1111-1111-111111111111',
      lab_course_id: 'c-1',
      course_slug: 'cpp-oops',
      course_title: 'Object-Oriented Programming with C++',
      student_user_id: 'u-1',
      exercises_completed: 4,
      assignments_submitted: 1,
      total_points: 90,
      current_streak_days: 5,
      last_activity_at: new Date().toISOString(),
    },
    {
      id: 'p-2',
      organization_id: '11111111-1111-1111-1111-111111111111',
      lab_course_id: 'c-2',
      course_slug: 'dsa',
      course_title: 'Data Structures & Algorithms',
      student_user_id: 'u-1',
      exercises_completed: 5,
      assignments_submitted: 1,
      total_points: 100,
      current_streak_days: 5,
      last_activity_at: new Date().toISOString(),
    },
    {
      id: 'p-3',
      organization_id: '11111111-1111-1111-1111-111111111111',
      lab_course_id: 'c-5',
      course_slug: 'dbms-sql',
      course_title: 'Database Management Systems (SQL)',
      student_user_id: 'u-1',
      exercises_completed: 5,
      assignments_submitted: 1,
      total_points: 90,
      current_streak_days: 5,
      last_activity_at: new Date().toISOString(),
    },
  ];

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
      <StudentDashboard progressList={dummyProgress} />
    </div>
  );
}
