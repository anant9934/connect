import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Database } from 'lucide-react';
import { SqlLab } from '@/features/lab/components/SqlLab';

export default function SqlLabPage() {
  return (
    <div className="min-h-screen bg-[#FAF9FC] py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <Link
            href="/lab"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5E5A50] hover:text-[#17151F] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Lab Hub
          </Link>
        </div>

        <SqlLab />
      </div>
    </div>
  );
}
