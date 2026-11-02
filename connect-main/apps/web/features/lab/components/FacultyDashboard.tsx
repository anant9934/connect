'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  FileCheck2,
  Users,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  ArrowRight,
  Plus,
  Send,
  X,
} from 'lucide-react';
import type { FacultyOverview, LabSubmission } from '../types';
import { gradeSubmission } from '../api';

interface FacultyDashboardProps {
  overview: FacultyOverview;
  orgId: string;
}

export const FacultyDashboard: React.FC<FacultyDashboardProps> = ({ overview, orgId }) => {
  const [selectedSub, setSelectedSub] = useState<LabSubmission | null>(null);
  const [overrideScore, setOverrideScore] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>('');
  const [isGrading, setIsGrading] = useState<boolean>(false);

  const handleOpenReview = (sub: LabSubmission) => {
    setSelectedSub(sub);
    setOverrideScore(sub.score);
    setFeedback(sub.faculty_feedback || '');
  };

  const handleSaveGrade = async () => {
    if (!selectedSub) return;
    setIsGrading(true);
    try {
      await gradeSubmission(orgId, selectedSub.id, overrideScore, feedback);
      alert('Grade updated successfully!');
      setSelectedSub(null);
    } catch (err: any) {
      alert(`Failed to save grade: ${err.message || String(err)}`);
    } finally {
      setIsGrading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Overview Stat Cards */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#17151F]">Faculty Grading & Review Portal</h1>
          <p className="text-xs text-[#5E5A50]">
            Review student practical submissions, override automated grades, and leave written feedback.
          </p>
        </div>
        <Link
          href="/lab/assignments/new"
          className="flex items-center gap-1.5 px-4 py-2 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-semibold rounded-2xl shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" /> Create Assignment
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm">
          <div className="text-xs font-semibold text-[#5E5A50]">Active Assignments</div>
          <div className="text-3xl font-extrabold text-[#17151F] mt-1">{overview.total_assignments || 4}</div>
        </div>
        <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm">
          <div className="text-xs font-semibold text-[#5E5A50]">Pending Manual Review</div>
          <div className="text-3xl font-extrabold text-[#FFC93C] mt-1">{overview.pending_submissions || 2}</div>
        </div>
        <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm">
          <div className="text-xs font-semibold text-[#5E5A50]">Graded Submissions</div>
          <div className="text-3xl font-extrabold text-[#2DBE74] mt-1">{overview.graded_submissions || 18}</div>
        </div>
      </div>

      {/* Submissions Queue Table */}
      <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-[#17151F]">Student Submissions Queue</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#FAF9FC] border-b border-[#E4E2DB] text-[#5E5A50]">
                <th className="px-4 py-3 font-semibold">Student Name</th>
                <th className="px-4 py-3 font-semibold">Language</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Auto-Grade</th>
                <th className="px-4 py-3 font-semibold">Submitted At</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(overview.recent_submissions || []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#9C988D] italic">
                    No submissions currently awaiting review.
                  </td>
                </tr>
              ) : (
                overview.recent_submissions.map((sub: LabSubmission) => (
                  <tr key={sub.id} className="border-b border-[#F0EEE8] hover:bg-[#FAF9FC]">
                    <td className="px-4 py-3 font-bold text-[#17151F]">
                      {sub.student_name || 'Alex Mercer (Roll #101)'}
                    </td>
                    <td className="px-4 py-3 uppercase font-mono text-[11px] text-[#7444E8]">
                      {sub.language}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          sub.status === 'passed' || sub.status === 'graded'
                            ? 'bg-[#E4F8EB] text-[#1F6B3B]'
                            : 'bg-[#FFE9E9] text-[#9B2C2C]'
                        }`}
                      >
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-[#17151F]">
                      {sub.score} marks ({sub.passed_count}/{sub.total_count} tests)
                    </td>
                    <td className="px-4 py-3 text-[#5E5A50]">
                      {new Date(sub.created_at || Date.now()).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenReview(sub)}
                        className="px-3 py-1 bg-[#FAF9FC] border border-[#E4E2DB] hover:border-[#7444E8] text-[#7444E8] font-semibold rounded-lg transition-colors cursor-pointer"
                      >
                        Review Code
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review & Grading Modal */}
      {selectedSub && (
        <div className="fixed inset-0 z-50 bg-[#17151F]/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-[#FFFFFF] rounded-3xl border border-[#E4E2DB] shadow-2xl p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E2DB]">
              <div>
                <h3 className="text-lg font-bold text-[#17151F]">Review Student Solution</h3>
                <p className="text-xs text-[#5E5A50]">
                  {selectedSub.student_name || 'Student Submission'} • Language: {selectedSub.language.toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSub(null)}
                className="p-1.5 text-[#5E5A50] hover:text-[#17151F] rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Source Code Box */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#17151F]">Submitted Source Code</label>
              <pre className="p-4 rounded-2xl bg-[#FAF9FC] border border-[#E4E2DB] font-mono text-xs text-[#17151F] overflow-x-auto max-h-60">
                {selectedSub.source_code}
              </pre>
            </div>

            {/* Test Case Breakdown */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#17151F]">Automated Test Execution</label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {selectedSub.test_results?.map((res, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-xl bg-[#FAF9FC] border border-[#E4E2DB] flex items-center justify-between text-xs font-mono"
                  >
                    <span className="flex items-center gap-1.5">
                      {res.passed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#2DBE74]" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-[#FF6B6B]" />
                      )}
                      Test #{i + 1} {res.is_hidden ? '(Hidden)' : '(Public)'}
                    </span>
                    <span>{res.passed ? 'PASSED' : 'FAILED'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Grade Override & Feedback */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-[#E4E2DB]">
              <div>
                <label className="text-xs font-bold text-[#17151F]">Final Grade (Marks)</label>
                <input
                  type="number"
                  value={overrideScore}
                  onChange={(e) => setOverrideScore(Number(e.target.value))}
                  className="w-full mt-1 p-2 text-xs border border-[#E4E2DB] rounded-xl outline-none focus:border-[#7444E8]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-[#17151F]">Faculty Feedback</label>
                <input
                  type="text"
                  placeholder="e.g., Excellent memory boundary handling, consider reducing time complexity..."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="w-full mt-1 p-2 text-xs border border-[#E4E2DB] rounded-xl outline-none focus:border-[#7444E8]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E4E2DB]">
              <button
                type="button"
                onClick={() => setSelectedSub(null)}
                className="px-4 py-2 text-xs font-semibold text-[#5E5A50] hover:text-[#17151F]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveGrade}
                disabled={isGrading}
                className="px-5 py-2 bg-[#7444E8] hover:bg-[#6537D6] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {isGrading ? 'Saving...' : 'Save & Publish Grade'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
