'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FilePlus,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import Link from 'next/link';
import type { SupportedLanguage } from '../types';
import { createLabAssignment } from '../api';

interface AssignmentCreatorProps {
  orgId: string;
  courses: Array<{ id: string; title: string; slug: string }>;
}

export const AssignmentCreator: React.FC<AssignmentCreatorProps> = ({ orgId, courses }) => {
  const router = useRouter();

  const [courseId, setCourseId] = useState<string>(courses[0]?.id || '');
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [maxScore, setMaxScore] = useState<number>(100);
  const [dueDate, setDueDate] = useState<string>('');
  const [allowedLanguages, setAllowedLanguages] = useState<SupportedLanguage[]>([
    'cpp',
    'python',
    'java',
  ]);
  const [starterCode, setStarterCode] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Test cases builder
  const [testCases, setTestCases] = useState<
    Array<{
      input: string;
      expected_output: string;
      is_hidden: boolean;
      weight: number;
      time_limit_ms: number;
    }>
  >([
    {
      input: '5\n',
      expected_output: '25',
      is_hidden: false,
      weight: 1,
      time_limit_ms: 2000,
    },
    {
      input: '100\n',
      expected_output: '10000',
      is_hidden: true,
      weight: 2,
      time_limit_ms: 2000,
    },
  ]);

  const handleToggleLang = (lang: SupportedLanguage) => {
    if (allowedLanguages.includes(lang)) {
      if (allowedLanguages.length > 1) {
        setAllowedLanguages(allowedLanguages.filter((l) => l !== lang));
      }
    } else {
      setAllowedLanguages([...allowedLanguages, lang]);
    }
  };

  const handleAddTestCase = () => {
    setTestCases([
      ...testCases,
      {
        input: '',
        expected_output: '',
        is_hidden: false,
        weight: 1,
        time_limit_ms: 2000,
      },
    ]);
  };

  const handleRemoveTestCase = (index: number) => {
    setTestCases(testCases.filter((_, i) => i !== index));
  };

  const handleUpdateTestCase = (index: number, field: string, value: any) => {
    const updated = [...testCases];
    (updated[index] as any)[field] = value;
    setTestCases(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !courseId) {
      alert('Please fill out the assignment title and select a course.');
      return;
    }

    setIsSubmitting(true);
    try {
      await createLabAssignment(orgId, {
        lab_course_id: courseId,
        title,
        description,
        allowed_languages: allowedLanguages,
        starter_code: starterCode,
        due_at: dueDate ? new Date(dueDate).toISOString() : new Date(Date.now() + 14 * 86400000).toISOString(),
        max_score: maxScore,
        test_cases: testCases,
      });

      alert('Assignment created successfully!');
      router.push('/lab/assignments');
    } catch (err: any) {
      alert(`Failed to create assignment: ${err.message || String(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <Link
          href="/lab/assignments"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5E5A50] hover:text-[#17151F] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Assignments
        </Link>
      </div>

      <div className="p-6 sm:p-8 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#F1EBFF] text-[#7444E8]">
              Faculty Authoring Suite
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-[#17151F]">Create Practical Programming Assignment</h1>
          <p className="text-xs text-[#5E5A50]">
            Author coding assessments with public sample test cases for students and hidden test suites for automated grading.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Target Course & Title */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#17151F]">Target Course</label>
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#E4E2DB] rounded-xl outline-none focus:border-[#7444E8] bg-[#FAF9FC]"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#17151F]">Max Marks</label>
              <input
                type="number"
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-[#E4E2DB] rounded-xl outline-none focus:border-[#7444E8] bg-[#FAF9FC]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#17151F]">Assignment Title</label>
            <input
              type="text"
              placeholder="e.g., Practical Lab 03: Binary Search Tree In-Order Traversal"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#E4E2DB] rounded-xl outline-none focus:border-[#7444E8] bg-[#FAF9FC]"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#17151F]">Problem Description & Specifications</label>
            <textarea
              rows={4}
              placeholder="Describe the problem requirements, constraints, input format, and output format..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 text-xs border border-[#E4E2DB] rounded-xl outline-none focus:border-[#7444E8] bg-[#FAF9FC]"
              required
            />
          </div>

          {/* Allowed Languages Checkboxes */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-[#17151F]">Permitted Programming Languages</label>
            <div className="flex flex-wrap gap-2">
              {(['cpp', 'python', 'java', 'html', 'sql'] as SupportedLanguage[]).map((lang) => {
                const isChecked = allowedLanguages.includes(lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => handleToggleLang(lang)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                      isChecked
                        ? 'bg-[#F1EBFF] border-[#7444E8] text-[#7444E8]'
                        : 'bg-[#FAF9FC] border-[#E4E2DB] text-[#5E5A50]'
                    }`}
                  >
                    {lang.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Starter Template Code */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#17151F]">Starter Code (Boilerplate)</label>
            <textarea
              rows={5}
              placeholder="// Starter code presented to students..."
              value={starterCode}
              onChange={(e) => setStarterCode(e.target.value)}
              className="w-full p-3 font-mono text-xs border border-[#E4E2DB] rounded-xl outline-none focus:border-[#7444E8] bg-[#FAF9FC]"
            />
          </div>

          {/* Dynamic Test Cases Suite Builder */}
          <div className="space-y-4 pt-4 border-t border-[#E4E2DB]">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#17151F]">Test Suite Assertions</h3>
                <p className="text-[11px] text-[#5E5A50]">
                  Public test cases are visible to students; hidden test cases are strictly guarded.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddTestCase}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#7444E8] text-xs font-semibold text-[#7444E8] rounded-xl transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Test Case
              </button>
            </div>

            <div className="space-y-3">
              {testCases.map((tc, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-[#FAF9FC] border border-[#E4E2DB] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#17151F]">Test Case #{idx + 1}</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-[#5E5A50] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={tc.is_hidden}
                          onChange={(e) => handleUpdateTestCase(idx, 'is_hidden', e.target.checked)}
                          className="rounded text-[#7444E8] focus:ring-0"
                        />
                        <span className="flex items-center gap-1 font-semibold">
                          {tc.is_hidden ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5 text-[#7444E8]" /> Hidden Test
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5 text-[#2DBE74]" /> Public Test
                            </>
                          )}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveTestCase(idx)}
                        className="text-[#FF6B6B] hover:text-[#9B2C2C] p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-[#5E5A50]">Input (stdin)</label>
                      <textarea
                        rows={2}
                        value={tc.input}
                        onChange={(e) => handleUpdateTestCase(idx, 'input', e.target.value)}
                        placeholder="5"
                        className="w-full p-2 font-mono text-xs border border-[#E4E2DB] rounded-lg bg-[#FFFFFF] outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-[#5E5A50]">Expected Output</label>
                      <textarea
                        rows={2}
                        value={tc.expected_output}
                        onChange={(e) => handleUpdateTestCase(idx, 'expected_output', e.target.value)}
                        placeholder="25"
                        className="w-full p-2 font-mono text-xs border border-[#E4E2DB] rounded-lg bg-[#FFFFFF] outline-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-bold rounded-2xl shadow-sm transition-colors cursor-pointer"
          >
            {isSubmitting ? 'Publishing Assignment...' : 'Publish Assignment to Class'}
          </button>
        </form>
      </div>
    </div>
  );
};
