'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck, UserX, Clock, ArrowLeft } from 'lucide-react';
import { getAdmissionStatus } from '@/features/rooms/api';

interface WaitingRoomProps {
  roomCode: string;
  identity: string;
  displayName: string;
  onAdmitted: () => void;
}

export const WaitingRoom: React.FC<WaitingRoomProps> = ({
  roomCode,
  identity,
  displayName,
  onAdmitted,
}) => {
  const router = useRouter();
  const [status, setStatus] = useState<'pending' | 'admitted' | 'denied'>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function checkStatus() {
      if (status !== 'pending') return;

      try {
        const res = await getAdmissionStatus(roomCode, identity);
        if (isCancelled) return;

        if (res.request.status === 'admitted') {
          setStatus('admitted');
          onAdmitted();
        } else if (res.request.status === 'denied') {
          setStatus('denied');
        }
      } catch (err: any) {
        if (err?.code === 'ROOM_ENDED') {
          setErrorMessage('This meeting has ended.');
          setStatus('denied');
        }
      }
    }

    // Initial check and interval polling
    checkStatus();
    const interval = setInterval(checkStatus, 2000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [roomCode, identity, status, onAdmitted]);

  if (status === 'denied') {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#FFFFFF] border border-[#E5E7EB] rounded-3xl p-8 text-center space-y-5 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-[#FFE5DF] text-[#D32F2F] flex items-center justify-center mx-auto">
            <UserX className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold text-[#1C1C1C]">Admission Declined</h2>
            <p className="text-xs text-[#6B7280] leading-relaxed">
              {errorMessage || 'The host was unable to admit you to the meeting at this time.'}
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => router.push('/')}
              className="w-full py-3 px-4 rounded-2xl bg-[#1C1C1C] hover:bg-[#333333] text-white text-xs font-medium transition-colors"
            >
              Return to Homepage
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#FFFFFF] border border-[#E5E7EB] rounded-3xl p-8 text-center space-y-6 shadow-sm">
        {/* Soft Lavender Pulse Indicator */}
        <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-[#EEE8FF] animate-ping opacity-75" />
          <div className="relative w-16 h-16 rounded-full bg-[#EEE8FF] text-[#7658E8] flex items-center justify-center shadow-inner">
            <Clock className="w-8 h-8" />
          </div>
        </div>

        {/* Informative Text */}
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EEE8FF] text-[#7658E8] text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            Waiting Room
          </span>
          <h2 className="text-xl font-bold text-[#1C1C1C]">Please wait, the host will let you in soon</h2>
          <p className="text-xs text-[#6B7280] leading-relaxed max-w-xs mx-auto">
            You are waiting to enter <span className="font-semibold text-[#1C1C1C]">{roomCode}</span> as{' '}
            <span className="font-semibold text-[#1C1C1C]">{displayName}</span>.
          </p>
        </div>

        {/* Polling Indicator */}
        <div className="p-3.5 rounded-2xl bg-[#FAFAF8] border border-[#ECECE8] flex items-center justify-center gap-2 text-xs text-[#71717A]">
          <Loader2 className="w-4 h-4 animate-spin text-[#7658E8]" />
          <span>Awaiting host approval...</span>
        </div>

        {/* Departure Action */}
        <div className="pt-2">
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#1C1C1C] font-medium transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Cancel and leave</span>
          </button>
        </div>
      </div>
    </div>
  );
};
