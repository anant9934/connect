'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSession } from '@/features/auth/api';
import { getMeetingHistory } from '@/features/rooms/api';
import { MeetingHistoryItem } from '@/features/rooms/types';
import { User } from '@/features/auth/types';
import {
  Calendar,
  Clock,
  Users,
  Video,
  ArrowLeft,
  Loader2,
  Lock,
  Copy,
  Check,
  ExternalLink,
  FileText,
  Download,
  X,
} from 'lucide-react';
import { getNotes } from '@/features/notes/api';
import { listFiles, getDownloadUrl } from '@/features/files/api';
import { MeetingNote } from '@/features/notes/types';
import { MeetingFile } from '@/features/files/types';

export default function MeetingHistoryPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [historyItems, setHistoryItems] = useState<MeetingHistoryItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Detail Modal States
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingHistoryItem | null>(null);
  const [detailNotes, setDetailNotes] = useState<MeetingNote | null>(null);
  const [detailFiles, setDetailFiles] = useState<MeetingFile[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const openDetails = async (item: MeetingHistoryItem) => {
    setSelectedMeeting(item);
    setLoadingDetails(true);
    setDetailNotes(null);
    setDetailFiles([]);
    try {
      const [noteData, filesData] = await Promise.all([
        getNotes(item.public_code).catch(() => null),
        listFiles(item.public_code).catch(() => []),
      ]);
      setDetailNotes(noteData);
      setDetailFiles(filesData);
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        const sessionUser = await getSession();
        if (!isMounted) return;

        if (!sessionUser) {
          setUser(null);
          setLoading(false);
          return;
        }

        setUser(sessionUser);

        const res = await getMeetingHistory(30, 0);
        if (!isMounted) return;

        setHistoryItems(res.history || []);
        setTotalCount(res.total || 0);
      } catch (err: any) {
        if (!isMounted) return;
        setError(err?.message || 'Failed to retrieve meeting history');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // Fallback
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const formatDuration = (startIso?: string, endIso?: string) => {
    if (!startIso || !endIso) return '—';
    try {
      const start = new Date(startIso).getTime();
      const end = new Date(endIso).getTime();
      const diffMins = Math.round((end - start) / (1000 * 60));
      if (diffMins < 1) return '< 1 min';
      if (diffMins < 60) return `${diffMins} mins`;
      const hrs = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      return `${hrs}h ${mins}m`;
    } catch {
      return '—';
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#1C1C1C] flex flex-col">
      {/* Top Bar */}
      <header className="w-full border-b border-[#E5E5E3] bg-white/80 backdrop-blur-md px-6 h-16 flex items-center justify-between shrink-0">
        <Link
          href="/"
          className="flex items-center gap-2 text-xs font-medium text-[#666664] hover:text-[#1C1C1C] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Home</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center font-bold text-xs shadow-xs">
            TM
          </div>
          <span className="font-semibold text-sm font-heading">Tathastu Meet</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1C1C]">Meeting History</h1>
          <p className="text-xs text-[#666664] mt-1">
            Review sessions hosted by your account, timing records, and participant telemetry.
          </p>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="p-16 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 text-[#7658E8] animate-spin" />
            <p className="text-xs text-[#666664]">Loading your meeting records...</p>
          </div>
        )}

        {/* Unauthenticated State */}
        {!loading && !user && (
          <div className="bg-white rounded-3xl border border-[#E5E5E3] p-10 text-center space-y-4 shadow-sm max-w-md mx-auto my-12">
            <div className="w-14 h-14 rounded-2xl bg-[#EEE8FF] text-[#7658E8] flex items-center justify-center mx-auto shadow-xs">
              <Lock className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-[#1C1C1C]">Authentication Required</h2>
              <p className="text-xs text-[#666664] leading-relaxed">
                Meeting history is strictly private and scoped to authenticated host accounts.
              </p>
            </div>
            <div className="pt-2">
              <Link
                href="/sign-in?redirect=/history"
                className="inline-block w-full py-3 px-4 rounded-2xl bg-[#7658E8] hover:bg-[#6045D8] text-white text-xs font-semibold transition-colors shadow-xs"
              >
                Sign In to View History
              </Link>
            </div>
          </div>
        )}

        {/* Error State */}
        {!loading && user && error && (
          <div className="p-4 rounded-2xl bg-[#FFE5DF] border border-[#F8C8BF] text-[#D32F2F] text-xs">
            {error}
          </div>
        )}

        {/* Authenticated State: Empty */}
        {!loading && user && !error && historyItems.length === 0 && (
          <div className="bg-white rounded-3xl border border-[#E5E5E3] p-12 text-center space-y-4 shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-[#FAFAF8] border border-[#E5E5E3] text-[#666664] flex items-center justify-center mx-auto">
              <Calendar className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-[#1C1C1C]">No Meetings Hosted Yet</h2>
              <p className="text-xs text-[#666664] max-w-sm mx-auto">
                Once you create and host a meeting, its record and telemetry will appear here.
              </p>
            </div>
            <div className="pt-2">
              <Link
                href="/"
                className="inline-flex items-center gap-2 py-2.5 px-5 rounded-2xl bg-[#7658E8] hover:bg-[#6045D8] text-white text-xs font-semibold transition-colors shadow-xs"
              >
                <Video className="w-4 h-4" />
                <span>Start a Meeting Now</span>
              </Link>
            </div>
          </div>
        )}

        {/* Authenticated State: Table / List */}
        {!loading && user && !error && historyItems.length > 0 && (
          <div className="bg-white rounded-3xl border border-[#E5E5E3] overflow-hidden shadow-sm">
            <div className="p-4 sm:p-5 border-b border-[#E5E5E3] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#7658E8]" />
                <span className="font-semibold text-sm">Past Meetings</span>
                <span className="text-xs bg-[#EEE8FF] text-[#7658E8] px-2 py-0.5 rounded-full font-medium">
                  {totalCount} total
                </span>
              </div>
            </div>

            <div className="divide-y divide-[#E5E5E3]">
              {historyItems.map((item) => {
                const isActive = item.status === 'active';

                return (
                  <div
                    key={item.id}
                    className="p-4 sm:p-5 hover:bg-[#FAFAF8] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-[#1C1C1C]">
                          {item.public_code}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                            isActive
                              ? 'bg-[#DFF5E8] text-[#1E7E45]'
                              : 'bg-[#F2F2F0] text-[#666664]'
                          }`}
                        >
                          {item.status}
                        </span>
                        {item.waiting_room_enabled && (
                          <span className="text-[10px] bg-[#EEE8FF] text-[#7658E8] px-2 py-0.5 rounded-full font-medium">
                            Waiting Room
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-[#666664] flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-[#7658E8]" />
                          {formatDate(item.created_at)}
                        </span>
                        {item.ended_at && (
                          <span>
                            Duration: {formatDuration(item.created_at, item.ended_at)}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-[#7658E8]" />
                          {item.participant_count} participant{item.participant_count === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleCopyCode(item.public_code)}
                        className="px-3 py-1.5 rounded-xl border border-[#E5E5E3] hover:bg-white text-xs font-medium text-[#1C1C1C] transition-colors flex items-center gap-1.5 shadow-2xs"
                        title="Copy room code"
                      >
                        {copiedCode === item.public_code ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-[#666664]" />
                            <span>Copy Code</span>
                          </>
                        )}
                      </button>

                      {/* View Details Action */}
                      <button
                        onClick={() => openDetails(item)}
                        className="px-3 py-1.5 rounded-xl border border-[#E5E5E3] hover:bg-white text-xs font-medium text-[#1C1C1C] transition-colors flex items-center gap-1.5 shadow-2xs"
                      >
                        <FileText className="w-3.5 h-3.5 text-[#7658E8]" />
                        <span>View Details</span>
                      </button>

                      {isActive && (
                        <button
                          onClick={() => router.push(`/room/${item.public_code}/preview`)}
                          className="px-3 py-1.5 rounded-xl bg-[#7658E8] hover:bg-[#6045D8] text-white text-xs font-medium transition-colors flex items-center gap-1.5 shadow-xs"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Rejoin Room</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Meeting Details Modal */}
        {selectedMeeting && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl border border-[#E5E5E3] max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="px-6 py-5 border-b border-[#E5E5E3] flex items-center justify-between bg-[#FAFAF8]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-bold text-[#1C1C1C]">
                      {selectedMeeting.public_code}
                    </span>
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                        selectedMeeting.status === 'active'
                          ? 'bg-[#DFF5E8] text-[#1E7E45]'
                          : 'bg-[#F2F2F0] text-[#666664]'
                      }`}
                    >
                      {selectedMeeting.status}
                    </span>
                  </div>
                  <div className="text-xs text-[#737373] mt-0.5">
                    Created {formatDate(selectedMeeting.created_at)}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedMeeting(null)}
                  className="p-1.5 rounded-xl text-[#737373] hover:text-[#1C1C1C] hover:bg-[#E5E5E3]/50 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1">
                {loadingDetails ? (
                  <div className="text-center py-12 text-sm text-[#737373] flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#7658E8]" />
                    <span>Loading meeting artifacts…</span>
                  </div>
                ) : (
                  <>
                    {/* Saved Notes Section */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-bold text-[#1C1C1C] flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-[#7658E8]" />
                          <span>Saved Meeting Notes</span>
                        </h4>
                        {detailNotes && (
                          <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-[#EEE8FF] text-[#7658E8]">
                            Revision {detailNotes.revision}
                          </span>
                        )}
                      </div>

                      {detailNotes && detailNotes.content ? (
                        <div className="p-4 rounded-2xl bg-[#FAFAF8] border border-[#E5E5E3]">
                          <div className="font-semibold text-sm text-[#1C1C1C] mb-1">
                            {detailNotes.title}
                          </div>
                          <div className="text-xs text-[#1C1C1C] whitespace-pre-wrap leading-relaxed font-sans">
                            {detailNotes.content}
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 rounded-2xl bg-[#FAFAF8] border border-[#E5E5E3] text-xs text-[#737373]">
                          No notes were recorded for this meeting.
                        </div>
                      )}
                    </div>

                    {/* Shared Files Section */}
                    <div>
                      <h4 className="text-sm font-bold text-[#1C1C1C] mb-2 flex items-center gap-1.5">
                        <Download className="w-4 h-4 text-[#2DBE74]" />
                        <span>Shared Files ({detailFiles.length})</span>
                      </h4>

                      {detailFiles.length > 0 ? (
                        <div className="space-y-2">
                          {detailFiles.map((f) => (
                            <div
                              key={f.id}
                              className="p-3 rounded-xl border border-[#E5E5E3] bg-[#FAFAF8] flex items-center justify-between"
                            >
                              <div className="min-w-0 pr-3">
                                <div className="text-xs font-medium text-[#1C1C1C] truncate">
                                  {f.originalFilename}
                                </div>
                                <div className="text-[11px] text-[#737373]">
                                  {(f.sizeBytes / 1024).toFixed(1)} KB · {f.fileType.toUpperCase()}
                                </div>
                              </div>
                              {f.scanStatus === 'available' ? (
                                <a
                                  href={getDownloadUrl(selectedMeeting.public_code, f.id)}
                                  download={f.sanitizedFilename}
                                  className="px-3 py-1 rounded-lg bg-[#EEE8FF] text-[#7658E8] hover:bg-[#E2D9FE] text-xs font-medium flex items-center gap-1 transition-colors"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Download</span>
                                </a>
                              ) : (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#FFF2BE] text-[#8A6400]">
                                  {f.scanStatus}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 rounded-2xl bg-[#FAFAF8] border border-[#E5E5E3] text-xs text-[#737373]">
                          No files were shared during this meeting.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
