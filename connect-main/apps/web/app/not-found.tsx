import React from 'react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[#FCFCFA]">
      <div className="w-16 h-16 rounded-2xl bg-[#F0EEE8] flex items-center justify-center mb-4">
        <span className="font-heading font-bold text-2xl text-[#17151F]">404</span>
      </div>
      <h1 className="text-2xl font-bold text-[#17151F] mb-2 font-heading">Page Not Found</h1>
      <p className="text-sm text-[#6B675C] mb-6 max-w-sm">
        The requested page or meeting space could not be found in Tathastu Meet.
      </p>
      <Link
        href="/"
        className="px-5 py-2.5 rounded-full text-xs font-semibold bg-[#17151F] hover:bg-[#2A2735] text-white shadow-xs transition-colors"
      >
        Return to Home
      </Link>
    </div>
  );
}
