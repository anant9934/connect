'use client';

import React, { useState } from 'react';
import {
  Users,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Crown,
  UserX,
  X,
  Lock,
  Unlock,
  Hand,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { Participant as LiveKitParticipant, LocalParticipant } from 'livekit-client';
import { AdmissionRequest } from '@/features/rooms/types';

interface ParticipantsPanelProps {
  localParticipant: LocalParticipant | null;
  remoteParticipants: LiveKitParticipant[];
  isHost: boolean;
  isLocked: boolean;
  pendingAdmissions: AdmissionRequest[];
  raisedHands: Set<string>;
  onToggleLock: () => void;
  onRemoveParticipant: (identity: string) => void;
  onMuteParticipant: (identity: string) => void;
  onDecideAdmission: (requestId: string, decision: 'admitted' | 'denied') => void;
  onClose: () => void;
}

export const ParticipantsPanel: React.FC<ParticipantsPanelProps> = ({
  localParticipant,
  remoteParticipants,
  isHost,
  isLocked,
  pendingAdmissions,
  raisedHands,
  onToggleLock,
  onRemoveParticipant,
  onMuteParticipant,
  onDecideAdmission,
  onClose,
}) => {
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const totalCount = (localParticipant ? 1 : 0) + remoteParticipants.length;

  return (
    <div className="flex flex-col h-full bg-[#FFFFFF] border-l border-[#E5E7EB] text-[#1C1C1C] shadow-lg w-full select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#E5E7EB] bg-[#FFFFFF]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#EEE8FF] text-[#7658E8] flex items-center justify-center">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-[#1C1C1C]">Participants</h3>
              <span className="px-2 py-0.5 rounded-full bg-[#EEE8FF] text-[#7658E8] text-[11px] font-semibold">
                {totalCount}
              </span>
            </div>
            <p className="text-[11px] text-[#6B7280]">
              {isHost ? 'You are managing this call' : 'In active session'}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#1C1C1C] hover:bg-[#F3F4F6] transition-colors"
          aria-label="Close participants panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Host Meeting Moderation Bar */}
      {isHost && (
        <div className="px-4 py-2.5 bg-[#FAFAF8] border-b border-[#E5E7EB] flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-[#1C1C1C]">
            {isLocked ? (
              <Lock className="w-3.5 h-3.5 text-amber-600" />
            ) : (
              <Unlock className="w-3.5 h-3.5 text-[#6B7280]" />
            )}
            <span className="font-medium text-xs">
              {isLocked ? 'Meeting is locked' : 'Meeting is unlocked'}
            </span>
          </div>
          <button
            onClick={onToggleLock}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              isLocked
                ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                : 'bg-[#FFFFFF] border-[#D1D5DB] text-[#374151] hover:bg-[#F9FAFB]'
            }`}
          >
            {isLocked ? 'Unlock' : 'Lock Room'}
          </button>
        </div>
      )}

      {/* Content List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#FAFAF8]">
        {/* Waiting Room Section for Host */}
        {isHost && pendingAdmissions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-800 bg-[#FFF2BE] px-3 py-1.5 rounded-xl border border-amber-200">
              <span>Waiting to Join ({pendingAdmissions.length})</span>
            </div>
            <div className="space-y-2">
              {pendingAdmissions.map((req) => (
                <div
                  key={req.id}
                  className="p-3 rounded-xl bg-[#FFFFFF] border border-[#E5E7EB] shadow-sm flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#1C1C1C] truncate">{req.displayName}</p>
                    <p className="text-[10px] text-[#6B7280]">Guest in waiting room</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onDecideAdmission(req.id, 'admitted')}
                      className="px-2.5 py-1 rounded-lg bg-[#DFF5E8] hover:bg-[#C9EFD8] text-[#1E7E34] text-xs font-medium flex items-center gap-1 transition-colors"
                      title="Admit to meeting"
                    >
                      <Check className="w-3 h-3" />
                      <span>Admit</span>
                    </button>
                    <button
                      onClick={() => onDecideAdmission(req.id, 'denied')}
                      className="px-2 py-1 rounded-lg bg-[#FFE5DF] hover:bg-[#FCD2CA] text-[#D32F2F] text-xs font-medium transition-colors"
                      title="Deny entry"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* In-Call Participants List */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider px-1">
            In this meeting ({totalCount})
          </p>

          {/* Local Participant */}
          {localParticipant && (
            <div className="p-3 rounded-xl bg-[#FFFFFF] border border-[#E5E7EB] shadow-sm flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-[#EEE8FF] text-[#7658E8] font-semibold text-xs flex items-center justify-center shrink-0">
                  {(localParticipant.name || 'You').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[#1C1C1C] truncate">
                      {localParticipant.name || 'You'} (You)
                    </span>
                    {isHost && (
                      <span className="px-1.5 py-0.5 rounded-md bg-[#FFF2BE] text-amber-900 text-[10px] font-semibold flex items-center gap-1 border border-amber-200">
                        <Crown className="w-2.5 h-2.5" />
                        Host
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[#6B7280]">Local connection</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[#6B7280] shrink-0">
                {raisedHands.has(localParticipant.identity) && (
                  <span className="p-1 rounded-md bg-amber-100 text-amber-800" title="Hand raised">
                    <Hand className="w-3.5 h-3.5" />
                  </span>
                )}
                <span className={`p-1 rounded-md ${localParticipant.isMicrophoneEnabled ? 'bg-[#DFF5E8] text-[#1E7E34]' : 'bg-[#F3F4F6] text-[#9CA3AF]'}`}>
                  {localParticipant.isMicrophoneEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                </span>
                <span className={`p-1 rounded-md ${localParticipant.isCameraEnabled ? 'bg-[#DFF5E8] text-[#1E7E34]' : 'bg-[#F3F4F6] text-[#9CA3AF]'}`}>
                  {localParticipant.isCameraEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                </span>
              </div>
            </div>
          )}

          {/* Remote Participants */}
          {remoteParticipants.map((p) => {
            const hasHandRaised = raisedHands.has(p.identity);
            const isSpeaking = p.isSpeaking;

            return (
              <div
                key={p.identity}
                className={`p-3 rounded-xl bg-[#FFFFFF] border shadow-sm flex items-center justify-between gap-3 transition-all ${
                  isSpeaking ? 'border-[#7658E8] ring-1 ring-[#7658E8]' : 'border-[#E5E7EB]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#F3F4F6] text-[#4B5563] font-semibold text-xs flex items-center justify-center shrink-0">
                    {(p.name || 'Guest').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#1C1C1C] truncate">{p.name || 'Guest'}</p>
                    <span className="text-[10px] text-[#6B7280]">
                      {isSpeaking ? (
                        <span className="text-[#7658E8] font-medium">Speaking...</span>
                      ) : (
                        'Participant'
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {hasHandRaised && (
                    <span className="p-1 rounded-md bg-amber-100 text-amber-800" title="Hand raised">
                      <Hand className="w-3.5 h-3.5" />
                    </span>
                  )}
                  <span className={`p-1 rounded-md ${p.isMicrophoneEnabled ? 'bg-[#DFF5E8] text-[#1E7E34]' : 'bg-[#F3F4F6] text-[#9CA3AF]'}`}>
                    {p.isMicrophoneEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                  </span>
                  <span className={`p-1 rounded-md ${p.isCameraEnabled ? 'bg-[#DFF5E8] text-[#1E7E34]' : 'bg-[#F3F4F6] text-[#9CA3AF]'}`}>
                    {p.isCameraEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                  </span>

                  {/* Host Moderation Actions */}
                  {isHost && (
                    <div className="flex items-center gap-1 ml-1 pl-1 border-l border-[#E5E7EB]">
                      {p.isMicrophoneEnabled && (
                        <button
                          onClick={() => onMuteParticipant(p.identity)}
                          className="p-1 rounded-lg text-[#6B7280] hover:text-amber-700 hover:bg-amber-50 transition-colors"
                          title="Mute participant"
                          aria-label="Mute participant"
                        >
                          <MicOff className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmRemoveId(p.identity)}
                        className="p-1 rounded-lg text-[#6B7280] hover:text-red-700 hover:bg-red-50 transition-colors"
                        title="Remove from meeting"
                        aria-label="Remove participant"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Host Removal Confirmation Dialog */}
      {confirmRemoveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-xs bg-[#FFFFFF] border border-[#E5E7EB] rounded-2xl p-5 shadow-2xl text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-[#FFE5DF] text-[#D32F2F] flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-sm text-[#1C1C1C]">Remove participant?</h4>
              <p className="text-xs text-[#6B7280] mt-1">
                They will be disconnected from the room immediately and prevented from rejoining.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmRemoveId(null)}
                className="flex-1 py-2 px-3 rounded-xl border border-[#D1D5DB] text-xs font-medium text-[#374151] hover:bg-[#F9FAFB]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onRemoveParticipant(confirmRemoveId);
                  setConfirmRemoveId(null);
                }}
                className="flex-1 py-2 px-3 rounded-xl bg-[#D32F2F] hover:bg-[#B71C1C] text-xs font-medium text-white shadow-sm"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
