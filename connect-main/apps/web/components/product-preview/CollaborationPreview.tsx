import React from 'react';
import Image from 'next/image';
import { PenTool, MessageSquare, Users, Copy, Check } from 'lucide-react';
import { MeetingToolbar } from './MeetingToolbar';

export const CollaborationPreview: React.FC = () => {
  const [copied, setCopied] = React.useState(false);

  const handleCopyCode = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative w-full rounded-2xl sm:rounded-3xl bg-[#FCFCFA] border border-[#E9E9E5] p-3 sm:p-5 shadow-lg overflow-hidden transition-all duration-300">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-[#F0F0EC]">
        {/* macOS dots */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="w-2.5 h-2.5 rounded-full bg-[#E56F63]/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#E3B936]/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#52B879]/80" />
        </div>

        {/* Clean Room Code Pill */}
        <button
          type="button"
          onClick={handleCopyCode}
          className="flex items-center gap-2 bg-[#F2F2EE] hover:bg-[#EBEBE6] border border-[#E5E5DF] px-3 py-1 rounded-full text-xs font-mono text-[#171717] transition-colors"
          title="Click to copy room code"
        >
          <span>tc-build-408</span>
          {copied ? (
            <Check className="w-3 h-3 text-[#52B879]" />
          ) : (
            <Copy className="w-3 h-3 text-[#666666]" />
          )}
        </button>

        {/* Side toggles (Participants + Notes/Chat) */}
        <div className="flex items-center gap-1.5">
          <div className="w-7 h-7 rounded-full bg-[#F6F4FE] border border-[#E2DCF8] text-[#7357E8] flex items-center justify-center">
            <Users className="w-3.5 h-3.5" />
          </div>
          <div className="w-7 h-7 rounded-full bg-[#F2F2EE] border border-[#E5E5DF] text-[#666666] flex items-center justify-center">
            <MessageSquare className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* Main Workspace Area: Shared Canvas + Side Participant Panel */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 py-3 sm:py-4">
        {/* Collaborative Center Canvas */}
        <div className="sm:col-span-8 bg-white rounded-xl sm:rounded-2xl border border-[#E9E9E5] p-4 sm:p-5 flex flex-col justify-between min-h-[220px]">
          <div className="flex items-center justify-between pb-3 border-b border-[#F5F5F0]">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#171717]">
              <PenTool className="w-3.5 h-3.5 text-[#7357E8]" />
              <span>Shared Canvas</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-[#52B879] font-medium bg-[#F4FAF6] px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#52B879]" />
              <span>Syncing</span>
            </div>
          </div>

          {/* Collaborative Artifact Content */}
          <div className="space-y-3 py-2">
            <div className="p-3 bg-[#FAF9FD] rounded-xl border border-[#EDE9FD] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#171717]">Model Evaluation Plan</span>
                <span className="text-[10px] text-[#7357E8] bg-white border border-[#E2DCF8] px-1.5 py-0.5 rounded">
                  Live
                </span>
              </div>
              <p className="text-[11px] text-[#666666] leading-relaxed">
                Benchmark inference latency across edge workers. Reviewing throughput milestones.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-[#F2F2EE] overflow-hidden">
                <div className="h-full bg-[#7357E8] rounded-full w-3/4" />
              </div>
              <span className="text-[11px] font-semibold text-[#171717]">75%</span>
            </div>
          </div>

          <div className="text-[11px] text-[#666666] border-t border-[#F5F5F0] pt-2 flex items-center justify-between">
            <span>Collaborative workspace</span>
            <span className="text-[#7357E8] font-medium">2 collaborators editing</span>
          </div>
        </div>

        {/* Side Mini Participant Column */}
        <div className="sm:col-span-4 flex flex-col gap-2.5">
          <div className="relative aspect-video rounded-xl overflow-hidden border border-[#52B879] shadow-2xs">
            <Image
              src="/demo/participant-01.webp"
              alt="Participant collaborating"
              fill
              sizes="200px"
              className="object-cover"
            />
            <div className="absolute bottom-1.5 left-1.5 bg-[#171717]/60 px-1.5 py-0.5 rounded text-[10px] text-white">
              Speaking
            </div>
          </div>

          <div className="relative aspect-video rounded-xl overflow-hidden border border-[#E5E5DF] shadow-2xs">
            <Image
              src="/demo/participant-02.webp"
              alt="Participant collaborating"
              fill
              sizes="200px"
              className="object-cover"
            />
          </div>
        </div>
      </div>

      {/* Bottom Toolbar */}
      <div className="flex justify-center pt-1">
        <MeetingToolbar />
      </div>
    </div>
  );
};

export default CollaborationPreview;
