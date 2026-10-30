'use client';

import React from 'react';
import { ArrowRight } from 'lucide-react';

export const TathastuIntegration: React.FC = () => {
  return (
    <section id="use-cases" className="py-12 px-4 sm:px-6 max-w-6xl mx-auto">
      <div className="rounded-2xl bg-[#F7F7F4] border border-[#E9E9E5] p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-1.5 max-w-2xl">
          <h3 className="text-xl sm:text-2xl font-bold text-[#171717] tracking-tight">
            Works with AI Tathastu.
          </h3>
          <p className="text-sm sm:text-base text-[#666666] leading-relaxed">
            When Tathastu connects you with someone worth talking to, continue the conversation here.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <a
            href="https://aitathastu.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white hover:bg-[#F2F2EE] border border-[#E5E5DF] text-sm font-medium text-[#171717] transition-colors shadow-xs"
          >
            <span>Learn more</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#666666]" />
          </a>
        </div>
      </div>
    </section>
  );
};

export default TathastuIntegration;
