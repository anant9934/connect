'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Activity, Cpu, Sparkles } from 'lucide-react';
import { DSAVisualizer } from '@/features/lab/components/DSAVisualizer';
import { OOPSVisualizer } from '@/features/lab/components/OOPSVisualizer';

export default function VisualizersPage() {
  const [suite, setSuite] = useState<'dsa' | 'oops'>('dsa');

  return (
    <div className="min-h-screen bg-[#FAF9FC] py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/lab"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5E5A50] hover:text-[#17151F] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Lab Hub
          </Link>

          {/* Toggle between DSA and OOPS */}
          <div className="flex items-center gap-1 bg-[#FFFFFF] p-1 rounded-2xl border border-[#E4E2DB] shadow-xs">
            <button
              type="button"
              onClick={() => setSuite('dsa')}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                suite === 'dsa'
                  ? 'bg-[#7444E8] text-white shadow-xs'
                  : 'text-[#5E5A50] hover:text-[#17151F]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" /> DSA Visualizers
            </button>
            <button
              type="button"
              onClick={() => setSuite('oops')}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                suite === 'oops'
                  ? 'bg-[#7444E8] text-white shadow-xs'
                  : 'text-[#5E5A50] hover:text-[#17151F]'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" /> OOPS &amp; Memory Layout
            </button>
          </div>
        </div>

        {suite === 'dsa' ? <DSAVisualizer /> : <OOPSVisualizer />}
      </div>
    </div>
  );
}
