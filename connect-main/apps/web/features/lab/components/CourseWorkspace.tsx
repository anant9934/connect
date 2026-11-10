'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Code2,
  FileCheck2,
  Sparkles,
  Trophy,
  Flame,
  ChevronRight,
  ArrowRight,
  CheckCircle2,
  Layers,
  Database,
  Eye,
  Activity,
  Cpu,
} from 'lucide-react';
import type { PilotCourseMeta, SupportedLanguage } from '../types';
import { CodeEditor } from './CodeEditor';

interface CourseWorkspaceProps {
  course: PilotCourseMeta;
  initialTab?: 'modules' | 'lab' | 'assignments' | 'progress';
}

export const CourseWorkspace: React.FC<CourseWorkspaceProps> = ({
  course,
  initialTab = 'modules',
}) => {
  const [activeTab, setActiveTab] = useState<'modules' | 'lab' | 'assignments' | 'progress'>(initialTab);
  const [selectedExercise, setSelectedExercise] = useState<{
    title: string;
    problem: string;
    starterCode: string;
    language: SupportedLanguage;
  } | null>(null);

  // Load sample exercise into editor
  const handleStartExercise = (ex: {
    title: string;
    problem: string;
    starterCode: string;
    language: SupportedLanguage;
  }) => {
    setSelectedExercise(ex);
    setActiveTab('lab');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Course Hero Banner */}
      <div className="p-6 sm:p-8 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm relative overflow-hidden">
        <div
          className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl opacity-15 pointer-events-none -mr-20 -mt-20"
          style={{ backgroundColor: course.accentColor }}
        />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 text-xs font-bold rounded-full bg-[#FAF9FC] border border-[#E4E2DB] text-[#17151F]">
                {course.code}
              </span>
              <span
                className="px-3 py-1 text-xs font-semibold rounded-full text-white"
                style={{ backgroundColor: course.accentColor }}
              >
                {course.badge}
              </span>
              <span className="px-3 py-1 text-xs font-medium rounded-full bg-[#F1EBFF] text-[#7444E8]">
                Interactive Practical Workspace
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#17151F] tracking-tight">
              {course.title}
            </h1>
            <p className="text-sm sm:text-base text-[#5E5A50] leading-relaxed">
              {course.description}
            </p>

            {/* Feature Tools Chips */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-[#6B675C] font-medium mr-1">Equipped Tools:</span>
              {course.tools.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-[#FAF9FC] border border-[#E4E2DB] text-[#17151F]"
                >
                  {t === 'editor' && <Code2 className="w-3.5 h-3.5 text-[#7444E8]" />}
                  {t === 'dsa_visualizer' && <Activity className="w-3.5 h-3.5 text-[#2DBE74]" />}
                  {t === 'oops_visualizer' && <Cpu className="w-3.5 h-3.5 text-[#7444E8]" />}
                  {t === 'sql_runner' && <Database className="w-3.5 h-3.5 text-[#06B6D4]" />}
                  {t === 'web_preview' && <Eye className="w-3.5 h-3.5 text-[#FF6B6B]" />}
                  {t.replace('_', ' ').toUpperCase()}
                </span>
              ))}
            </div>
          </div>

          {/* Quick Streak & Stats Card */}
          <div className="flex md:flex-col gap-3 p-4 rounded-2xl bg-[#FAF9FC] border border-[#E4E2DB] shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#FFF4D1] text-[#FFC93C] flex items-center justify-center shrink-0">
                <Flame className="w-5 h-5 fill-current" />
              </div>
              <div>
                <div className="text-sm font-bold text-[#17151F]">5 Day Streak</div>
                <div className="text-[11px] text-[#5E5A50]">Keep learning today</div>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#E4F8EB] text-[#2DBE74] flex items-center justify-center shrink-0">
                <Trophy className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-[#17151F]">120 Points</div>
                <div className="text-[11px] text-[#5E5A50]">8 Exercises Mastered</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Workspace Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E4E2DB] pb-px overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('modules')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-all border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
            activeTab === 'modules'
              ? 'border-[#7444E8] text-[#7444E8] bg-[#F1EBFF]/30'
              : 'border-transparent text-[#5E5A50] hover:text-[#17151F]'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Syllabus & Modules ({course.modules.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('lab')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-all border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
            activeTab === 'lab'
              ? 'border-[#7444E8] text-[#7444E8] bg-[#F1EBFF]/30'
              : 'border-transparent text-[#5E5A50] hover:text-[#17151F]'
          }`}
        >
          <Code2 className="w-4 h-4" />
          Practice Coding Lab
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('assignments')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-all border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
            activeTab === 'assignments'
              ? 'border-[#7444E8] text-[#7444E8] bg-[#F1EBFF]/30'
              : 'border-transparent text-[#5E5A50] hover:text-[#17151F]'
          }`}
        >
          <FileCheck2 className="w-4 h-4" />
          Assignments & Homework
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('progress')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-all border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
            activeTab === 'progress'
              ? 'border-[#7444E8] text-[#7444E8] bg-[#F1EBFF]/30'
              : 'border-transparent text-[#5E5A50] hover:text-[#17151F]'
          }`}
        >
          <Trophy className="w-4 h-4" />
          My Progress & Stats
        </button>
      </div>

      {/* Tab 1: Syllabus & Modules */}
      {activeTab === 'modules' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-[#17151F]">Curriculum Modules</h2>
            <span className="text-xs text-[#5E5A50] font-medium">
              Self-paced interactive exercises with real-time test case verification
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {course.modules.map((mod) => (
              <div
                key={mod.order}
                className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex flex-col justify-between hover:border-[#7444E8] transition-all space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#7444E8] uppercase tracking-wider">
                      Module {mod.order}
                    </span>
                    <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-[#E4F8EB] text-[#1F6B3B]">
                      {mod.sampleExercise.difficulty.toUpperCase()}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-[#17151F]">{mod.title}</h3>
                  <p className="text-sm text-[#5E5A50]">{mod.description}</p>

                  <div className="pt-2">
                    <div className="text-xs font-semibold text-[#17151F] mb-1.5">Topics covered:</div>
                    <ul className="space-y-1">
                      {mod.lessons.map((lesson, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-xs text-[#5E5A50]">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#2DBE74] shrink-0" />
                          <span>{lesson}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Sample exercise card */}
                <div className="p-3.5 rounded-xl bg-[#FAF9FC] border border-[#E4E2DB] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#17151F]">Practice Challenge:</span>
                    <span className="text-[#7444E8] font-bold">10 Points</span>
                  </div>
                  <div className="text-xs font-medium text-[#17151F]">{mod.sampleExercise.title}</div>
                  <p className="text-[11px] text-[#5E5A50] line-clamp-2">{mod.sampleExercise.problem}</p>
                  <button
                    type="button"
                    onClick={() =>
                      handleStartExercise({
                        title: mod.sampleExercise.title,
                        problem: mod.sampleExercise.problem,
                        starterCode: mod.sampleExercise.starterCode,
                        language: mod.sampleExercise.language,
                      })
                    }
                    className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 px-3 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
                  >
                    <span>Launch in Code Lab</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2: Practice Coding Lab */}
      {activeTab === 'lab' && (
        <div className="space-y-4">
          {selectedExercise && (
            <div className="p-4 rounded-2xl bg-[#F1EBFF] border border-[#E3D9FC] flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-[#7444E8] text-white">
                    Active Problem
                  </span>
                  <span className="text-sm font-bold text-[#17151F]">{selectedExercise.title}</span>
                </div>
                <p className="text-xs text-[#5E5A50] leading-relaxed">{selectedExercise.problem}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedExercise(null)}
                className="text-xs font-semibold text-[#7444E8] hover:underline shrink-0"
              >
                Clear Problem
              </button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-lg font-bold text-[#17151F]">Interactive Code Editor</h2>
              <p className="text-xs text-[#5E5A50]">
                Write, run, and debug your code with real-time console feedback.
              </p>
            </div>

            {/* Quick Link to Visualizer if available */}
            {course.tools.includes('dsa_visualizer') && (
              <Link
                href="/lab/visualizer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#7444E8] rounded-xl text-xs font-semibold text-[#7444E8] transition-colors"
              >
                <Layers className="w-3.5 h-3.5" />
                Open DSA Visualizer
              </Link>
            )}
            {course.tools.includes('sql_runner') && (
              <Link
                href="/lab/sql"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#06B6D4] rounded-xl text-xs font-semibold text-[#06B6D4] transition-colors"
              >
                <Database className="w-3.5 h-3.5" />
                Open Full SQL Lab
              </Link>
            )}
          </div>

          <CodeEditor
            key={selectedExercise ? `${selectedExercise.title}-${selectedExercise.language}` : 'free-practice'}
            initialLanguage={selectedExercise ? selectedExercise.language : course.primaryLanguage}
            initialCode={selectedExercise ? selectedExercise.starterCode : undefined}
            height="580px"
          />
        </div>
      )}

      {/* Tab 3: Assignments & Homework */}
      {activeTab === 'assignments' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#17151F]">Course Assignments</h2>
              <p className="text-xs text-[#5E5A50]">
                Faculty-created practical assessments evaluated against automated public and hidden test suites.
              </p>
            </div>
            <Link
              href="/lab/assignments"
              className="text-xs font-semibold text-[#7444E8] hover:underline flex items-center gap-1"
            >
              View all assignments <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="neu-card p-6 text-center space-y-2" data-testid="course-assignments-empty">
            <p className="text-sm font-semibold text-[#17151F]">Assignments for this course appear when your faculty publish them.</p>
            <p className="text-xs text-[#5E5A50]">Each one shows its due date, marks and public test cases; hidden tests run when you submit.</p>
          </div>
        </div>
      )}

      {/* Tab 4: Progress & Stats */}
      {activeTab === 'progress' && (
        <div className="space-y-6">
          <h2 className="text-xl font-bold text-[#17151F]">Student Mastery & Analytics</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-1">
              <div className="text-xs font-semibold text-[#5E5A50]">Exercises Completed</div>
              <div className="text-3xl font-extrabold text-[#7444E8]">8 / 12</div>
              <div className="w-full bg-[#F6F5F2] h-2 rounded-full overflow-hidden mt-3">
                <div className="bg-[#7444E8] h-full rounded-full" style={{ width: '66%' }} />
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-1">
              <div className="text-xs font-semibold text-[#5E5A50]">Assignments Submitted</div>
              <div className="text-3xl font-extrabold text-[#2DBE74]">2 / 2</div>
              <div className="w-full bg-[#F6F5F2] h-2 rounded-full overflow-hidden mt-3">
                <div className="bg-[#2DBE74] h-full rounded-full" style={{ width: '100%' }} />
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-1">
              <div className="text-xs font-semibold text-[#5E5A50]">Average Test Score</div>
              <div className="text-3xl font-extrabold text-[#FFC93C]">94.5%</div>
              <div className="w-full bg-[#F6F5F2] h-2 rounded-full overflow-hidden mt-3">
                <div className="bg-[#FFC93C] h-full rounded-full" style={{ width: '94.5%' }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
