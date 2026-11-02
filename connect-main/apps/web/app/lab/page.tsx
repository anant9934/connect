import React from 'react';
import Link from 'next/link';
import {
  Code2,
  Terminal,
  Activity,
  Layers,
  Database,
  Eye,
  FileCheck2,
  Trophy,
  ArrowRight,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { PILOT_COURSES } from '@/features/lab/runtimes/starterTemplates';

export default function LabHubPage() {
  return (
    <div className="min-h-screen bg-[#FAF9FC] py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-10">
        {/* Header Hero */}
        <div className="p-8 sm:p-12 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#7444E8]/10 rounded-full blur-3xl pointer-events-none -mr-32 -mt-32" />

          <div className="relative z-10 max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-bold rounded-full bg-[#F1EBFF] text-[#7444E8] border border-[#E3D9FC]">
              <Sparkles className="w-3.5 h-3.5" /> Phase 4 Practical Learning Platform
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#17151F] tracking-tight">
              Connect Programming &amp; Engineering Labs
            </h1>
            <p className="text-base text-[#5E5A50] leading-relaxed">
              Fully interactive browser-based workspaces supporting C++, Python, Java, HTML/CSS/JavaScript, and SQL. Featuring in-browser WebAssembly execution, interactive animated visualizers, and automated test-case evaluation.
            </p>

            {/* Quick action buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/lab/editor"
                className="flex items-center gap-2 px-4 py-2.5 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-bold rounded-2xl shadow-xs transition-colors"
              >
                <Code2 className="w-4 h-4" /> Open Multi-Language Editor
              </Link>
              <Link
                href="/lab/visualizer"
                className="flex items-center gap-2 px-4 py-2.5 bg-[#FAF9FC] hover:bg-[#F1EBFF] border border-[#E4E2DB] text-[#7444E8] text-xs font-bold rounded-2xl transition-colors"
              >
                <Activity className="w-4 h-4" /> DSA &amp; OOPS Visualizers
              </Link>
              <Link
                href="/lab/sql"
                className="flex items-center gap-2 px-4 py-2.5 bg-[#FAF9FC] hover:bg-[#E0F2FE] border border-[#E4E2DB] text-[#0284C7] text-xs font-bold rounded-2xl transition-colors"
              >
                <Database className="w-4 h-4" /> SQLite Lab
              </Link>
              <Link
                href="/lab/assignments"
                className="flex items-center gap-2 px-4 py-2.5 bg-[#FAF9FC] hover:bg-[#FAF9FC] border border-[#E4E2DB] text-[#17151F] text-xs font-bold rounded-2xl transition-colors"
              >
                <FileCheck2 className="w-4 h-4 text-[#2DBE74]" /> Assignments
              </Link>
            </div>
          </div>
        </div>

        {/* 5 Pilot Practical Courses Grid */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-[#17151F]">Pilot Practical Workspaces</h2>
              <p className="text-xs text-[#5E5A50]">
                Dedicated interactive curriculum environments with lesson exercises and auto-graded assessments.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {PILOT_COURSES.map((course) => (
              <div
                key={course.slug}
                className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex flex-col justify-between hover:border-[#7444E8] hover:shadow-md transition-all space-y-5"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#7444E8]">{course.code}</span>
                    <span
                      className="px-2.5 py-0.5 text-[10px] font-bold rounded-full text-white"
                      style={{ backgroundColor: course.accentColor }}
                    >
                      {course.badge}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-[#17151F]">{course.title}</h3>
                  <div className="text-xs font-semibold text-[#7444E8]">{course.tagline}</div>
                  <p className="text-xs text-[#5E5A50] leading-relaxed">{course.description}</p>

                  {/* Modules preview */}
                  <div className="pt-2 border-t border-[#F0EEE8] space-y-1.5">
                    <div className="text-[11px] font-bold text-[#17151F]">Included Curriculum Modules:</div>
                    {course.modules.map((m) => (
                      <div key={m.order} className="text-[11px] text-[#5E5A50] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#7444E8]" />
                        <span>{m.title}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-[#F0EEE8]">
                  <Link
                    href={`/lab/course/${course.slug}`}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-bold rounded-2xl shadow-xs transition-colors"
                  >
                    <span>Enter Course Workspace</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Portals & Dashboards Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[#2DBE74] font-bold text-sm">
                <Trophy className="w-4 h-4" />
                <span>Student Mastery Dashboard</span>
              </div>
              <p className="text-xs text-[#5E5A50]">
                Track completed coding exercises, submission grades, active streaks, and XP points.
              </p>
            </div>
            <Link
              href="/lab/dashboard"
              className="px-4 py-2 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#2DBE74] text-[#17151F] text-xs font-bold rounded-xl transition-colors shrink-0"
            >
              Open Dashboard
            </Link>
          </div>

          <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[#7444E8] font-bold text-sm">
                <BookOpen className="w-4 h-4" />
                <span>Faculty Evaluation Portal</span>
              </div>
              <p className="text-xs text-[#5E5A50]">
                Author new practical assignments, review student code diffs, override scores, and leave feedback.
              </p>
            </div>
            <Link
              href="/lab/faculty"
              className="px-4 py-2 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#7444E8] text-[#17151F] text-xs font-bold rounded-xl transition-colors shrink-0"
            >
              Faculty Portal
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
