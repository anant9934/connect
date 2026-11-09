'use client';

import React, { useEffect, useState } from 'react';
import { Copy, Check, X, Link as LinkIcon, Hash } from 'lucide-react';
import { getMeetingInviteUrl } from '@/lib/utils/canonical';
import { getRoom } from '@/features/rooms/api';

interface InviteDialogProps {
  roomCode: string;
  isOpen: boolean;
  onClose: () => void;
}

export const InviteDialog: React.FC<InviteDialogProps> = ({ roomCode, isOpen, onClose }) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [meetingNumber, setMeetingNumber] = useState<string | null>(null);
  const [copiedNumber, setCopiedNumber] = useState(false);

  useEffect(() => {
    if (!isOpen || meetingNumber) return;
    let current = true;
    getRoom(roomCode)
      .then((room) => current && setMeetingNumber(room.meetingNumber || null))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [isOpen, roomCode, meetingNumber]);

  if (!isOpen) return null;

  const handleCopyNumber = async () => {
    if (!meetingNumber) return;
    try {
      await navigator.clipboard.writeText(meetingNumber.replace(/\s/g, ''));
      setCopiedNumber(true);
      setTimeout(() => setCopiedNumber(false), 2500);
    } catch {
      // Fallback
    }
  };

  const inviteUrl = getMeetingInviteUrl(roomCode);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white border border-[#E5E5E3] rounded-2xl p-6 text-[#1C1C1C] shadow-xl space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#EEE8FF] text-[#7658E8] flex items-center justify-center shadow-xs">
              <LinkIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-[#1C1C1C]">Invite to Meeting</h3>
              <p className="text-xs text-[#666664]">Share link or code with participants</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#666664] hover:text-[#1C1C1C] p-1.5 rounded-lg hover:bg-[#F2F2F0] transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Meeting Link Box */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#4A4A48] flex items-center gap-1.5">
            <LinkIcon className="w-3.5 h-3.5 text-[#7658E8]" /> Meeting Link
          </label>
          <div className="flex items-center gap-2 p-2 rounded-xl bg-[#FAFAF8] border border-[#E5E5E3]">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              className="flex-1 bg-transparent text-xs text-[#1C1C1C] outline-none font-mono selection:bg-[#EEE8FF] px-1 truncate"
            />
            <button
              onClick={handleCopyLink}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                copiedLink
                  ? 'bg-[#DFF5E8] text-[#1E7E45] border border-[#BDE6CE]'
                  : 'bg-[#7658E8] hover:bg-[#6045D8] text-white shadow-xs'
              }`}
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Link</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Meeting Code Box */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#4A4A48] flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5 text-[#7658E8]" /> Room Code
          </label>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FAFAF8] border border-[#E5E5E3]">
            <span className="font-mono text-sm tracking-wider font-semibold text-[#1C1C1C] px-1">
              {roomCode}
            </span>
            <button
              onClick={handleCopyCode}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                copiedCode
                  ? 'bg-[#DFF5E8] text-[#1E7E45] border border-[#BDE6CE]'
                  : 'bg-white hover:bg-[#F2F2F0] text-[#1C1C1C] border border-[#E5E5E3]'
              }`}
            >
              {copiedCode ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>
        </div>

        {meetingNumber && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#4A4A48] flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-[#7658E8]" /> Meeting ID
            </label>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FAFAF8] border border-[#E5E5E3]">
              <span data-testid="meeting-number" className="font-mono text-sm tracking-wider font-semibold text-[#1C1C1C] px-1">
                {meetingNumber}
              </span>
              <button
                onClick={handleCopyNumber}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 ${
                  copiedNumber
                    ? 'bg-[#DFF5E8] text-[#1E7E45] border border-[#BDE6CE]'
                    : 'bg-white hover:bg-[#F2F2F0] text-[#1C1C1C] border border-[#E5E5E3]'
                }`}
              >
                {copiedNumber ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedNumber ? 'Copied' : 'Copy ID'}</span>
              </button>
            </div>
          </div>
        )}

        <div className="pt-1 border-t border-[#F2F2F0] text-center">
          <p className="text-[11px] text-[#888886]">
            Anyone with the link can request to join. Hosts can manage admission in the participants panel.
          </p>
        </div>
      </div>
    </div>
  );
};

