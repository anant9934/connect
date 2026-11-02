'use client';

import React from 'react';
import Link from 'next/link';
import {
  Trophy,
  Flame,
  CheckCircle2,
  BookOpen,
  ArrowRight,
  TrendingUp,
  Award,
  Calendar,
} from 'lucide-react';
import type { LabStudentProgress } from '../types';
import { PILOT_COURSES } from '../runtimes/starterTemplates';

interface StudentDashboardProps {
  progressList: LabStudentProgress[];
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({ progressList }) => {
  const totalCompleted = progressList.reduce((acc, p) => acc + p.exercises_completed, 0);
  const totalAssignments = progressList.reduce((acc, p) => acc + p.assignments_submitted, 0);
  const totalScore = progressList.reduce((acc, p) => acc + p.total_points, 0);
  const maxStreak = progressList.reduce((acc, p) => Math.max(acc, p.current_streak_days), 5); // default mock streak 5

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#FFF4D1] text-[#FFC93C] flex items-center justify-center shrink-0">
            <Flame className="w-6 h-6 fill-current" />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-[#17151F]">{maxStreak} Days</div>
            <div className="text-xs text-[#5E5A50] font-medium">Active Learning Streak</div>
          </div>
        </div>

        <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#E4F8EB] text-[#2DBE74] flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-[#17151F]">{totalCompleted || 14}</div>
            <div className="text-xs text-[#5E5A50] font-medium">Exercises Mastered</div>
          </div>
        </div>

        <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#F1EBFF] text-[#7444E8] flex items-center justify-center shrink-0">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-[#17151F]">{totalAssignments || 3}</div>
            <div className="text-xs text-[#5E5A50] font-medium">Assignments Submitted</div>
          </div>
        </div>

        <div className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#E0F2FE] text-[#0284C7] flex items-center justify-center shrink-0">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-[#17151F]">{totalScore || 280} pts</div>
            <div className="text-xs text-[#5E5A50] font-medium">Practical XP Earned</div>
          </div>
        </div>
      </div>

      {/* Course Progress Section */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-[#17151F]">Enrolled Practical Courses</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {PILOT_COURSES.map((course) => (
            <div
              key={course.slug}
              className="p-6 rounded-3xl bg-[#FFFFFF] border border-[#E4E2DB] shadow-sm flex flex-col justify-between space-y-4 hover:border-[#7444E8] transition-all"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#7444E8]">{course.code}</span>
                  <span
                    className="px-2.5 py-0.5 text-[10px] font-bold rounded-full text-white"
                    style={{ backgroundColor: course.accentColor }}
                  >
                    {course.badge}
                  </span>
                </div>
                <h3 className="text-base font-bold text-[#17151F]">{course.title}</h3>
                <p className="text-xs text-[#5E5A50] line-clamp-2">{course.description}</p>
              </div>

              <div className="space-y-3 pt-2 border-t border-[#F0EEE8]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#5E5A50]">Progress</span>
                  <span className="font-bold text-[#17151F]">65%</span>
                </div>
                <div className="w-full bg-[#FAF9FC] border border-[#E4E2DB] h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: '65%', backgroundColor: course.accentColor }}
                  />
                </div>

                <Link
                  href={`/lab/course/${course.slug}`}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-[#FAF9FC] hover:bg-[#F1EBFF] text-[#7444E8] text-xs font-bold rounded-xl transition-colors cursor-pointer"
                >
                  <span>Continue Course</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
