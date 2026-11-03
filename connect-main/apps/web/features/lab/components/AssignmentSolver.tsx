'use client';

import React, { useEffect, useState } from 'react';
import {
  FileCheck2,
  Play,
  Send,
  AlertCircle,
  CheckCircle2,
  Clock,
  Trophy,
  ArrowLeft,
  ShieldCheck,
  EyeOff,
} from 'lucide-react';
import Link from 'next/link';
import type { LabAssignment, SupportedLanguage, TestCaseResult } from '../types';
import { CodeEditor } from './CodeEditor';
import { submitAssignment } from '../api';
import { runPythonCode, preloadPython } from '../runtimes/pythonRunner';
import { executeSqlQuery } from '../runtimes/sqlRunner';

interface AssignmentSolverProps {
  assignment: LabAssignment;
  orgId: string;
  /** Called after a successful submission (e.g. to tell the teacher's view to refresh). */
  onSubmitted?: () => void;
  /** Compact layout without page navigation, for use inside a live meeting. */
  embedded?: boolean;
}

export const AssignmentSolver: React.FC<AssignmentSolverProps> = ({ assignment, orgId, onSubmitted, embedded = false }) => {
  const allowed: SupportedLanguage[] = (assignment.allowed_languages && assignment.allowed_languages.length > 0)
    ? (assignment.allowed_languages as SupportedLanguage[])
    : ['cpp', 'python', 'java'];
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>(allowed[0]);

  // Start downloading the Python runtime as soon as Python is selected, so Run is fast.
  useEffect(() => {
    if (selectedLanguage === 'python') preloadPython();
  }, [selectedLanguage]);

  const initialStarter =
    typeof assignment.starter_code === 'object' && assignment.starter_code !== null
      ? ('code' in assignment.starter_code ? (assignment.starter_code as { code: string }).code : '')
      : '';

  const [code, setCode] = useState<string>(initialStarter);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [publicTestResults, setPublicTestResults] = useState<Record<string, { passed: boolean; actual: string }>>({});
  const [submissionOutcome, setSubmissionOutcome] = useState<{
    score: number;
    status: string;
    passedCount: number;
    totalCount: number;
    results: TestCaseResult[];
  } | null>(
    assignment.user_submission
      ? {
          score: assignment.user_submission.score,
          status: assignment.user_submission.status,
          passedCount: assignment.user_submission.passed_count,
          totalCount: assignment.user_submission.total_count,
          results: assignment.user_submission.test_results,
        }
      : null
  );

  const publicTestCases = (assignment.test_cases || []).filter((tc) => !tc.is_hidden);

  // Run against public test cases client-side
  const handleRunPublicTests = async () => {
    setIsEvaluating(true);
    const results: Record<string, { passed: boolean; actual: string }> = {};

    try {
      for (const tc of publicTestCases) {
        if (selectedLanguage === 'python') {
          const res = await runPythonCode(code, tc.input);
          const cleanActual = res.stdout.trim();
          const cleanExpected = tc.expected_output.trim();
          results[tc.id] = {
            passed: cleanActual === cleanExpected,
            actual: res.stdout,
          };
        } else if (selectedLanguage === 'sql') {
          const queryRes = await executeSqlQuery(code);
          const actualStr = JSON.stringify(queryRes[0]?.values || []);
          results[tc.id] = {
            passed: actualStr.includes(tc.expected_output.trim()),
            actual: actualStr,
          };
        } else {
          // Compiled runtimes (C++, Java): Execution is explicitly BLOCKED under ₹0 policy
          results[tc.id] = {
            passed: false,
            actual: '[EXECUTION BLOCKED] Compilation & sandbox execution disabled under zero-trust ₹0 infrastructure policy.',
          };
        }
      }
      setPublicTestResults(results);
    } finally {
      setIsEvaluating(false);
    }
  };

  // Final submission to API
  const handleSubmitSolution = async () => {
    setIsSubmitting(true);
    try {
      // Gather outputs map for all test cases
      const outputs: Record<string, string> = {};
      const errors: Record<string, string> = {};
      const durations: Record<string, number> = {};

      for (const tc of assignment.test_cases || []) {
        if (selectedLanguage === 'python') {
          const res = await runPythonCode(code, tc.input);
          outputs[tc.id] = res.stdout;
          errors[tc.id] = res.stderr;
          durations[tc.id] = res.durationMs;
        } else if (selectedLanguage === 'sql') {
          const res = await executeSqlQuery(code);
          const hasErr = res.some((r) => !!r.error);
          if (hasErr) {
            errors[tc.id] = res.filter((r) => r.error).map((r) => r.error).join('\n');
          } else {
            outputs[tc.id] = JSON.stringify(res[0]?.values || []);
          }
          durations[tc.id] = res[0]?.executionTimeMs || 5;
        } else {
          // C++ / Java: Do not simulate successful execution. Flag honestly for manual faculty evaluation.
          errors[tc.id] = 'Automated execution BLOCKED for compiled binaries under zero-trust ₹0 policy (queued for manual faculty review)';
          durations[tc.id] = 0;
        }
      }

      const res = await submitAssignment(orgId, assignment.id, {
        language: selectedLanguage,
        source_code: code,
        outputs,
        errors,
        durations,
      });

      setSubmissionOutcome({
        score: res.submission.score,
        status: res.submission.status,
        passedCount: res.submission.passed_count,
        totalCount: res.submission.total_count,
        results: res.submission.test_results,
      });
      onSubmitted?.();
    } catch (err: any) {
      alert(`Submission failed: ${err.message || String(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={embedded ? 'p-4 space-y-4' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6'}>
      {/* Back button */}
      <div className={embedded ? 'hidden' : undefined}>
        <Link
          href="/lab/assignments"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5E5A50] hover:text-[#17151F] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Assignments
        </Link>
      </div>

      {/* Assignment Header */}
      <div className="p-6 sm:p-8 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 text-xs font-bold rounded-full bg-[#FAF9FC] border border-[#E4E2DB] text-[#17151F]">
              Assignment
            </span>
            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-[#E4F8EB] text-[#1F6B3B]">
              {assignment.max_score} Marks
            </span>
            <span className="px-3 py-1 text-xs font-medium rounded-full bg-[#F1EBFF] text-[#7444E8] flex items-center gap-1" suppressHydrationWarning>
              <Clock className="w-3 h-3" /> Due: {new Date(assignment.due_at).toLocaleDateString()}
            </span>
          </div>

          <h1 className="text-2xl font-extrabold text-[#17151F]">{assignment.title}</h1>
          <p className="text-sm text-[#5E5A50] leading-relaxed whitespace-pre-wrap">{assignment.description}</p>
        </div>

        {/* Score Badge if submitted */}
        {submissionOutcome && (
          <div className="p-4 rounded-2xl bg-[#FAF9FC] border border-[#E4E2DB] shrink-0 text-center min-w-[180px]">
            <div className="text-xs font-semibold text-[#5E5A50]">
              {submissionOutcome.status === 'graded' ? 'Official Grade' : 'Status: Pending Faculty Review'}
            </div>
            <div className="text-3xl font-extrabold text-[#7444E8]">
              {submissionOutcome.status === 'graded'
                ? `${submissionOutcome.score} / ${assignment.max_score}`
                : 'Pending'}
            </div>
            <div className="text-[11px] font-bold text-[#5E5A50] mt-1">
              {submissionOutcome.status === 'graded'
                ? `${submissionOutcome.passedCount} of ${submissionOutcome.totalCount} Verified`
                : `${submissionOutcome.passedCount} of ${submissionOutcome.totalCount} Self-Checks Passed`}
            </div>
            {assignment.user_submission?.faculty_feedback && (
              <div className="mt-2 text-left text-xs bg-[#FFFFFF] p-2 rounded-xl border border-[#E4E2DB] text-[#17151F]">
                <span className="font-bold text-[#7444E8]">Faculty Feedback:</span> {assignment.user_submission.faculty_feedback}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Editor & Test Cases Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Editor (2 columns) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#17151F]">Solution Implementation</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRunPublicTests}
                disabled={isEvaluating || isSubmitting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#7444E8] text-[#17151F] text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current text-[#7444E8]" />
                {isEvaluating ? 'Testing...' : 'Run Public Tests'}
              </button>
              <button
                type="button"
                onClick={handleSubmitSolution}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                {isSubmitting ? 'Evaluating...' : 'Submit Solution'}
              </button>
            </div>
          </div>

          <CodeEditor
            initialLanguage={selectedLanguage}
            initialCode={code}
            allowedLanguages={allowed}
            onCodeChange={setCode}
            height="560px"
          />
        </div>

        {/* Test Cases & Submission Results (1 column) */}
        <div className="space-y-6">
          {/* Public Test Cases Section */}
          <div className="p-5 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E4E2DB]">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#7444E8]" />
                <h3 className="text-sm font-bold text-[#17151F]">Public Sample Tests</h3>
              </div>
              <span className="text-[11px] text-[#5E5A50]">{publicTestCases.length} Cases</span>
            </div>

            <div className="space-y-3">
              {publicTestCases.length === 0 ? (
                <div className="text-xs text-[#9C988D] italic">No public test cases provided.</div>
              ) : (
                publicTestCases.map((tc, idx) => {
                  const runRes = publicTestResults[tc.id];
                  return (
                    <div key={tc.id} className="p-3.5 rounded-2xl bg-[#FAF9FC] border border-[#E4E2DB] space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-[#17151F]">
                        <span>Test Case {idx + 1}</span>
                        {runRes ? (
                          runRes.passed ? (
                            <span className="flex items-center gap-1 text-[#2DBE74] text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Passed
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[#FF6B6B] text-[11px]">
                              <AlertCircle className="w-3.5 h-3.5" /> Failed
                            </span>
                          )
                        ) : (
                          <span className="text-[11px] text-[#9C988D]">Not run</span>
                        )}
                      </div>

                      {tc.input && (
                        <div>
                          <div className="text-[10px] font-semibold text-[#5E5A50]">Input:</div>
                          <pre className="p-1.5 rounded-lg bg-[#FFFFFF] border border-[#F0EEE8] font-mono text-[11px] text-[#17151F] overflow-x-auto">
                            {tc.input}
                          </pre>
                        </div>
                      )}

                      <div>
                        <div className="text-[10px] font-semibold text-[#5E5A50]">Expected Output:</div>
                        <pre className="p-1.5 rounded-lg bg-[#FFFFFF] border border-[#F0EEE8] font-mono text-[11px] text-[#17151F] overflow-x-auto">
                          {tc.expected_output}
                        </pre>
                      </div>

                      {runRes && !runRes.passed && (
                        <div>
                          <div className="text-[10px] font-semibold text-[#FF6B6B]">Actual Output:</div>
                          <pre className="p-1.5 rounded-lg bg-[#FFE9E9] border border-[#FBD2D2] font-mono text-[11px] text-[#9B2C2C] overflow-x-auto">
                            {runRes.actual}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Submission Verdict Details */}
          {submissionOutcome && (
            <div className="p-5 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-[#E4E2DB]">
                <div className="flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-[#FFC93C]" />
                  <h3 className="text-sm font-bold text-[#17151F]">Evaluation Breakdown</h3>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-full uppercase ${
                    submissionOutcome.status === 'passed'
                      ? 'bg-[#E4F8EB] text-[#1F6B3B]'
                      : 'bg-[#FFE9E9] text-[#9B2C2C]'
                  }`}
                >
                  {submissionOutcome.status}
                </span>
              </div>

              <div className="space-y-2">
                {submissionOutcome.results.map((res, i) => (
                  <div
                    key={res.test_case_id}
                    className="p-3 rounded-xl bg-[#FAF9FC] border border-[#E4E2DB] flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      {res.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-[#2DBE74] shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-[#FF6B6B] shrink-0" />
                      )}
                      <div>
                        <div className="font-semibold text-[#17151F]">
                          Test #{i + 1} {res.is_hidden && <span className="text-[10px] text-[#7444E8]">(Hidden)</span>}
                        </div>
                        {res.error_message && (
                          <div className="text-[10px] text-[#FF6B6B]">{res.error_message}</div>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-[#5E5A50] font-mono">{res.execution_time_ms}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
