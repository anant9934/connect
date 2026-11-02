import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Code2, Sparkles } from 'lucide-react';
import { CodeEditor } from '@/features/lab/components/CodeEditor';

export default function StandaloneEditorPage() {
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

          <div className="flex items-center gap-2">
            <span className="px-3 py-1 text-xs font-bold rounded-full bg-[#F1EBFF] text-[#7444E8]">
              Multi-Language Playground
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-[#17151F]">Online Code Editor &amp; Compiler Sandbox</h1>
          <p className="text-xs text-[#5E5A50]">
            Compile and run C++, Python 3 (WASM), Java, HTML5, CSS3, JavaScript, and SQLite in real time.
          </p>
        </div>

        <CodeEditor height="680px" />
      </div>
    </div>
  );
}
