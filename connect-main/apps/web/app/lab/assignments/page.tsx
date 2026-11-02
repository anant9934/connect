import React from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2, Clock, Plus, ArrowRight } from 'lucide-react';

const SAMPLE_ASSIGNMENTS = [
  {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    title: 'Practical Lab 01: Implementation of Custom Template Vector in C++',
    course: 'Object-Oriented Programming with C++',
    courseCode: 'CS201-OOP',
    due: '2026-11-15',
    maxScore: 100,
    status: 'published',
    description: 'Construct a dynamically resizing generic Vector class with push_back, pop_back, operator[], copy constructor, and destructor.',
    allowedLanguages: ['cpp'],
  },
  {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    title: 'Practical Lab 02: Reverse Linked List & Detect Cycles',
    course: 'Data Structures & Algorithms',
    courseCode: 'CS202-DSA',
    due: '2026-11-18',
    maxScore: 100,
    status: 'published',
    description: 'Implement in-place reversal of a singly linked list and Floyd cycle detection with O(1) memory overhead.',
    allowedLanguages: ['cpp', 'python', 'java'],
  },
  {
    id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    title: 'Practical Lab 03: Relational Payroll Analytics with SQL JOINs',
    course: 'Database Management Systems (SQL)',
    courseCode: 'CS301-DBMS',
    due: '2026-11-20',
    maxScore: 100,
    status: 'published',
    description: 'Write analytical SQL queries to aggregate departmental payroll expenses and list students enrolled in multiple classes.',
    allowedLanguages: ['sql'],
  },
  {
    id: 'd4e5f6a7-b8c9-0123-def1-234567890123',
    title: 'Practical Lab 04: Word Frequency & Inverted Index in Python',
    course: 'Python for Engineers & Data Science',
    courseCode: 'CS102-PY',
    due: '2026-11-22',
    maxScore: 100,
    status: 'published',
    description: 'Process raw text corpus and construct an inverted index dictionary mapping unique terms to document identifiers.',
    allowedLanguages: ['python'],
  },
];

export default function AssignmentsPage() {
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

          <Link
            href="/lab/assignments/new"
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-semibold rounded-2xl shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" /> Create Assignment
          </Link>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-[#17151F]">Class Practical Assignments</h1>
          <p className="text-xs text-[#5E5A50]">
            Review assigned coding assessments, verify solutions against public sample tests, and submit for automated grading.
          </p>
        </div>

        <div className="space-y-4">
          {SAMPLE_ASSIGNMENTS.map((assign) => (
            <div
              key={assign.id}
              className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-[#7444E8] transition-all"
            >
              <div className="space-y-2 max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#FAF9FC] border border-[#E4E2DB] text-[#17151F]">
                    {assign.courseCode}
                  </span>
                  <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-[#F1EBFF] text-[#7444E8]">
                    {assign.course}
                  </span>
                  <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-[#E4F8EB] text-[#1F6B3B] flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Due {assign.due}
                  </span>
                </div>

                <h2 className="text-lg font-bold text-[#17151F]">{assign.title}</h2>
                <p className="text-xs text-[#5E5A50] leading-relaxed">{assign.description}</p>

                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[11px] text-[#6B675C] font-semibold">Allowed:</span>
                  {assign.allowedLanguages.map((l) => (
                    <span key={l} className="px-2 py-0.5 text-[10px] uppercase font-mono font-bold rounded-md bg-[#FAF9FC] border border-[#E4E2DB] text-[#17151F]">
                      {l}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <div className="text-sm font-extrabold text-[#17151F]">{assign.maxScore} Marks</div>
                  <div className="text-[11px] text-[#5E5A50]">Auto-Graded Suite</div>
                </div>

                <Link
                  href={`/lab/assignments/${assign.id}`}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <span>Solve Problem</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
