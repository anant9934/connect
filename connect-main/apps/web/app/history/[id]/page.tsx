'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { AttendanceExplanation } from '@/components/attendance/AttendanceExplanation';
import { getMeeting, MeetingDetail, meetingCalendarUrl, MyAttendance } from '@/features/rooms/meetings';
import { getNotes } from '@/features/notes/api';
import { getDownloadUrl, listFiles } from '@/features/files/api';
import { MeetingNote } from '@/features/notes/types';
import { MeetingFile } from '@/features/files/types';

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function MeetingDetailPage() {
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [attendance, setAttendance] = useState<MyAttendance | null>(null);
  const [notes, setNotes] = useState<MeetingNote | null>(null);
  const [files, setFiles] = useState<MeetingFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const { meeting: detail, attendance: mine } = await getMeeting(id);
        if (!isMounted) return;
        setMeeting(detail);
        setAttendance(mine);
        // Notes and files keep their own access rules, so a refusal simply hides them.
        const [noteData, fileData] = await Promise.all([
          getNotes(detail.publicCode).catch(() => null),
          listFiles(detail.publicCode).catch(() => []),
        ]);
        if (!isMounted) return;
        setNotes(noteData);
        setFiles(fileData);
      } catch (err) {
        if (isMounted) setError(err instanceof ApiError && err.statusCode === 404 ? 'This meeting is unavailable.' : 'Could not load this meeting.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const back = (
    <Link href="/history" className="inline-flex items-center gap-1.5 text-sm text-[#686868] hover:text-[#171717] min-h-[44px]">
      <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Meeting history
    </Link>
  );

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FCFCFA]">
        <Loader2 className="w-6 h-6 animate-spin text-[#7258E8]" aria-label="Loading" />
      </main>
    );
  }

  if (error || !meeting) {
    return (
      <main className="min-h-screen bg-[#FCFCFA] px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-3">
          {back}
          <p role="alert" className="text-sm text-red-700">{error || 'This meeting is unavailable.'}</p>
        </div>
      </main>
    );
  }

  const canOpen = meeting.status === 'active' || meeting.status === 'scheduled';
  const summary = meeting.attendanceSummary ? Object.entries(meeting.attendanceSummary) : [];

  return (
    <main className="min-h-screen bg-[#FCFCFA] px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {back}
        <header className="space-y-1">
          <h1 className="text-xl font-bold text-[#171717] break-words">{meeting.title || `Meeting ${meeting.publicCode}`}</h1>
          <p className="text-xs text-[#686868]">
            {when(meeting.meetingAt)} · {meeting.publicCode} · {meeting.status}
            {meeting.endedAt ? ` · ended ${when(meeting.endedAt)}` : ''}
          </p>
          <p className="text-xs text-[#686868] break-words">
            Host: {meeting.hostName}
            {meeting.courseTitle ? ` · ${meeting.courseTitle}` : ''}
            {meeting.organizationName ? ` · ${meeting.organizationName}` : ''}
          </p>
          <div className="flex flex-wrap gap-3 mt-2">
            {canOpen && (
              <Link href={`/room/${meeting.publicCode}/preview`} className="inline-flex items-center px-4 rounded-xl bg-[#7258E8] text-white text-sm font-semibold min-h-[44px]">
                Open meeting
              </Link>
            )}
            {meeting.status === 'scheduled' && (
              <a href={meetingCalendarUrl(meeting.id)} download data-testid="calendar-one" className="inline-flex items-center px-4 rounded-xl border border-[#E9E9E5] text-sm font-semibold text-[#171717] min-h-[44px]">
                Add to calendar
              </a>
            )}
          </div>
        </header>

        {attendance && (
          <section className="p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-2">
            <h2 className="text-sm font-semibold text-[#171717]">Your attendance</h2>
            <AttendanceExplanation attendance={attendance} />
          </section>
        )}

        {summary.length > 0 && (
          <section className="p-4 rounded-2xl border border-[#E9E9E5] bg-white">
            <h2 className="text-sm font-semibold text-[#171717]">Attendance</h2>
            <p className="text-sm text-[#404040]">{summary.map(([status, count]) => `${status}: ${count}`).join(' · ')}</p>
          </section>
        )}

        <section className="p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-2">
          <h2 className="text-sm font-semibold text-[#171717]">
            {meeting.access === 'participant' || meeting.access === 'student' ? 'Your participation' : 'Participants'}
          </h2>
          {meeting.participants.length === 0 && <p className="text-sm text-[#686868]">Nobody joined this meeting.</p>}
          <ul className="space-y-1">
            {meeting.participants.map((person, index) => (
              <li key={index} data-testid="meeting-participant" className="text-sm text-[#171717] break-words">
                {person.displayName}
                {person.isYou ? ' (you)' : ''}
                {person.isGuest ? ' (guest)' : ''} · {person.role} · joined {when(person.joinedAt)}
                {person.leftAt ? `, left ${when(person.leftAt)}` : ''}
              </li>
            ))}
          </ul>
        </section>

        {notes?.content && (
          <section className="p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-1">
            <h2 className="text-sm font-semibold text-[#171717]">{notes.title}</h2>
            <p className="text-sm text-[#404040] whitespace-pre-wrap break-words">{notes.content}</p>
          </section>
        )}

        {files.length > 0 && (
          <section className="p-4 rounded-2xl border border-[#E9E9E5] bg-white space-y-2">
            <h2 className="text-sm font-semibold text-[#171717]">Files</h2>
            <ul className="space-y-1">
              {files.map((file) => (
                <li key={file.id} className="text-sm">
                  <a href={getDownloadUrl(meeting.publicCode, file.id)} className="inline-flex items-center gap-1.5 text-[#7258E8] underline break-all min-h-[44px]">
                    <Download className="w-4 h-4 shrink-0" aria-hidden="true" /> {file.originalFilename}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
