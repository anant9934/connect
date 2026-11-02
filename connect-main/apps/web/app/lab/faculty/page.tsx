import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { FacultyDashboard } from '@/features/lab/components/FacultyDashboard';
import type { FacultyOverview } from '@/features/lab/types';

export default function FacultyPortalPage() {
  const dummyOverview: FacultyOverview = {
    pending_submissions: 3,
    graded_submissions: 24,
    total_assignments: 4,
    recent_submissions: [
      {
        id: 'sub-01',
        organization_id: '11111111-1111-1111-1111-111111111111',
        student_user_id: 'u-01',
        student_name: 'Alex Mercer (Roll #101)',
        language: 'cpp',
        source_code: `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "20" << endl;\n    cout << "10" << endl;\n    return 0;\n}`,
        status: 'passed',
        score: 100,
        passed_count: 3,
        total_count: 3,
        execution_duration_ms: 15,
        stdout: '20\n10',
        stderr: '',
        test_results: [
          { test_case_id: 'tc-1', passed: true, execution_time_ms: 5, is_hidden: false },
          { test_case_id: 'tc-2', passed: true, execution_time_ms: 6, is_hidden: false },
          { test_case_id: 'tc-3', passed: true, execution_time_ms: 4, is_hidden: true },
        ],
        faculty_feedback: 'Clean solution with zero memory leaks.',
        created_at: '2026-11-02T10:00:00.000Z',
      },
      {
        id: 'sub-02',
        organization_id: '11111111-1111-1111-1111-111111111111',
        student_user_id: 'u-02',
        student_name: 'Sara Connor (Roll #102)',
        language: 'python',
        source_code: `def solve():\n    print("20")\n    print("10")\nsolve()`,
        status: 'passed',
        score: 100,
        passed_count: 3,
        total_count: 3,
        execution_duration_ms: 22,
        stdout: '20\n10',
        stderr: '',
        test_results: [
          { test_case_id: 'tc-1', passed: true, execution_time_ms: 8, is_hidden: false },
          { test_case_id: 'tc-2', passed: true, execution_time_ms: 7, is_hidden: false },
          { test_case_id: 'tc-3', passed: true, execution_time_ms: 7, is_hidden: true },
        ],
        faculty_feedback: 'Great use of Pythonic syntax.',
        created_at: '2026-11-02T09:00:00.000Z',
      },
      {
        id: 'sub-03',
        organization_id: '11111111-1111-1111-1111-111111111111',
        student_user_id: 'u-03',
        student_name: 'Bruce Wayne (Roll #103)',
        language: 'cpp',
        source_code: `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "20" << endl;\n    // Missing second line\n    return 0;\n}`,
        status: 'failed',
        score: 33,
        passed_count: 1,
        total_count: 3,
        execution_duration_ms: 12,
        stdout: '20',
        stderr: '',
        test_results: [
          { test_case_id: 'tc-1', passed: false, execution_time_ms: 4, is_hidden: false, error_message: 'Expected "20\\n10", got "20"' },
          { test_case_id: 'tc-2', passed: true, execution_time_ms: 4, is_hidden: false },
          { test_case_id: 'tc-3', passed: false, execution_time_ms: 4, is_hidden: true },
        ],
        faculty_feedback: '',
        created_at: '2026-11-02T08:00:00.000Z',
      },
    ],
    course_stats: [],
  };

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
      <FacultyDashboard overview={dummyOverview} orgId="11111111-1111-1111-1111-111111111111" />
    </div>
  );
}
