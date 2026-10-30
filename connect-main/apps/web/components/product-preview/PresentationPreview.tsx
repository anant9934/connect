import React from 'react';
import Image from 'next/image';
import { ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';

export const PresentationPreview: React.FC = () => {
  return (
    <div className="w-full bg-white rounded-xl sm:rounded-2xl border border-[#E9E9E5] p-4 sm:p-6 shadow-sm flex flex-col justify-between space-y-4">
      {/* Slide Top Bar */}
      <div className="flex items-center justify-between border-b border-[#F0F0EC] pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#7357E8]" />
          <span className="text-xs font-semibold tracking-wide uppercase text-[#7357E8]">
            Slide 04 / 12
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#666666] bg-[#F7F7F4] px-2.5 py-1 rounded-md">
          <Sparkles className="w-3 h-3 text-[#7357E8]" />
          <span>Team Review</span>
        </div>
      </div>

      {/* Slide Title */}
      <div className="space-y-1">
        <h4 className="text-lg sm:text-xl font-bold tracking-tight text-[#171717]">
          AI Collaboration Workflow
        </h4>
        <p className="text-xs sm:text-sm text-[#666666]">
          Pipeline architecture and cross-team alignment protocols
        </p>
      </div>

      {/* Slide Content: Diagram Left + Real Photo Right */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-stretch pt-1">
        {/* Left: Workflow Diagram & Short Highlights */}
        <div className="sm:col-span-7 flex flex-col justify-between space-y-3 bg-[#FAF9FD] rounded-xl p-3 sm:p-4 border border-[#ECE8FB]">
          {/* Visual Step-by-Step Flow */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-[#7357E8] uppercase tracking-wider">
              Execution Architecture
            </span>

            <div className="flex items-center gap-1.5 text-xs">
              <div className="flex-1 bg-white border border-[#E2DCF8] px-2.5 py-1.5 rounded-lg text-center font-medium text-[#171717] shadow-2xs">
                Context
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-[#7357E8] shrink-0" />
              <div className="flex-1 bg-[#7357E8] text-white px-2.5 py-1.5 rounded-lg text-center font-medium shadow-2xs">
                Model Core
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-[#7357E8] shrink-0" />
              <div className="flex-1 bg-white border border-[#52B879] text-[#2E8B57] px-2.5 py-1.5 rounded-lg text-center font-medium shadow-2xs">
                Verified
              </div>
            </div>
          </div>

          {/* Short bullet points */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-2 text-xs text-[#171717]">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#52B879] shrink-0" />
              <span>Realtime bidirectional synchronization</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#171717]">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#7357E8] shrink-0" />
              <span>Zero latency collaborative annotations</span>
            </div>
          </div>

          {/* Metric Bar (Warm yellow + mint accent) */}
          <div className="bg-[#FEF9E7] border border-[#FDE68A] rounded-lg p-2 flex items-center justify-between text-[11px]">
            <span className="text-[#854D0E] font-medium">Model Efficiency</span>
            <span className="text-[#2E8B57] font-bold">+34% Throughput</span>
          </div>
        </div>

        {/* Right: Real Presentation Photo */}
        <div className="sm:col-span-5 relative min-h-[140px] sm:min-h-[180px] rounded-xl overflow-hidden border border-[#E5E5DF] shadow-xs">
          <Image
            src="/demo/presentation-photo.webp"
            alt="Research team collaborating on architectural workflow"
            fill
            sizes="(max-width: 640px) 100vw, 30vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent flex items-end p-2.5">
            <span className="text-[10px] font-medium text-white/90 bg-black/40 px-2 py-0.5 rounded backdrop-blur-xs">
              Live Team Review
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PresentationPreview;
