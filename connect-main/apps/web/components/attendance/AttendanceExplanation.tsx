import React from 'react';
import { MyAttendance } from '@/features/rooms/meetings';

const percent = (value: number) => `${Math.round(value * 100)}%`;
const RULE_LABELS: Record<string, string> = {
  never_connected: 'You did not connect to this class.',
  joined_late_marked_late: 'You joined after the allowed time, so you are marked late.',
  left_early_lowered_present_to_partial: 'You left before the allowed time, so present became partial.',
  browser_signal_unavailable: 'No tab visibility was reported, so it did not count for or against you.',
};

// Shows the result and each step that led to it.
export function AttendanceExplanation({ attendance }: { attendance: MyAttendance }) {
  const calc = attendance.calculation;
  return (
    <div data-testid="attendance-explanation" className="space-y-1 text-sm text-[#404040]">
      <p className="font-semibold text-[#171717]">
        {attendance.status}
        {attendance.isOverruled && attendance.originalStatus ? ` (corrected from ${attendance.originalStatus})` : ''}
      </p>
      {attendance.isOverruled && attendance.overruleReason && <p>Reason for the correction: {attendance.overruleReason}</p>}
      {calc ? (
        <>
          <p>
            Time connected: {Math.round(calc.connectedSeconds / 60)} of {Math.round(calc.sessionSeconds / 60)} minutes ({percent(calc.durationRatio)}), weight {percent(calc.durationWeight)}.
          </p>
          {calc.engagementWeight > 0 && (
            <p>Engagement: {calc.actions} actions, {calc.engagementTarget} earn full credit ({percent(calc.engagementRatio)}), weight {percent(calc.engagementWeight)}.</p>
          )}
          {calc.browserWeight > 0 && calc.browserRatio !== null && (
            <p>Tab visible: {percent(calc.browserRatio)} of reported time, weight {percent(calc.browserWeight)}.</p>
          )}
          <p>
            Score {percent(calc.score)}. Present needs {percent(calc.minPresent)}, partial needs {percent(calc.minPartial)}. Rules version {attendance.policyVersion ?? 'default'}.
          </p>
          {calc.rules.map((rule) => <p key={rule}>{RULE_LABELS[rule] ?? rule}</p>)}
        </>
      ) : (
        <p>{Math.round(attendance.connectedSeconds / 60)} minutes connected.</p>
      )}
    </div>
  );
}
