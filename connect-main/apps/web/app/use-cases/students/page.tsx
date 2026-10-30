import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { GraduationCap, Users, BookOpen, Clock, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Video Conferencing for Students & Universities | Tathastu Meet',
  description:
    'Free, browser-based video meetings for students, study groups, and university project teams. No sign-ups required to join, fast screen sharing, and mobile support.',
  alternates: {
    canonical: '/use-cases/students',
  },
  openGraph: {
    title: 'Video Conferencing for Students & Universities | Tathastu Meet',
    description:
      'Free, browser-based video meetings for students, study groups, and university project teams. No sign-ups required to join, fast screen sharing, and mobile support.',
    url: 'https://connect.aitathastu.com/use-cases/students',
  },
};

export default function StudentsUseCasePage() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://connect.aitathastu.com',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Use Cases',
        item: 'https://connect.aitathastu.com/use-cases/students',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Students & Universities',
        item: 'https://connect.aitathastu.com/use-cases/students',
      },
    ],
  };

  return (
    <div className="min-h-screen bg-[#FCFCFA] text-[#17151F] font-sans antialiased">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <LandingNav />

      <main id="main-content" className="max-w-[1120px] mx-auto px-4 sm:px-8 py-12 sm:py-20">
        <nav aria-label="Breadcrumb" className="text-xs text-[#6B675C] mb-6">
          <ol className="flex items-center gap-2 list-none p-0 m-0">
            <li>
              <Link href="/" className="hover:text-[#17151F] transition-colors">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <span>Use Cases</span>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-[#17151F]" aria-current="page">
              Students
            </li>
          </ol>
        </nav>

        <header className="max-w-3xl mb-14 sm:mb-16">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FFF5D6] px-3 py-1 rounded-full mb-3">
            Academic Community
          </span>
          <h1 className="font-heading font-bold text-3xl sm:text-5xl tracking-tight text-[#17151F] mb-5 leading-tight">
            Video Meetings Built for Student Collaboration
          </h1>
          <p className="text-base sm:text-lg text-[#6B675C] leading-relaxed">
            Collaborating on college group projects, virtual study groups, and hackathons should not require
            expensive software licenses or heavy desktop downloads. Tathastu Meet connects students instantly in their browser.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-16">
          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Users className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Join with Just a Code
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Teammates enter your 9-character room code on phone or laptop and join immediately. Zero barriers or forced signups for guests.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <BookOpen className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Virtual Study Groups
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Share lecture notes, problem sets, and textbook diagrams with clean high-DPI screen sharing and real-time audio.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Clock className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              No 40-Minute Cutoffs
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Keep group project discussions moving without artificial mid-conversation session terminations.
            </p>
          </div>
        </section>

        <section className="bg-[#FAF9F5] border border-[#E9E7E1] rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="font-heading font-bold text-xl text-[#17151F] mb-1">
              Start your study group room now
            </h3>
            <p className="text-xs text-[#6B675C]">
              Takes 5 seconds. Free to use on web and Android.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FFC93C] hover:bg-[#F2BD31] text-[#17151F] font-semibold text-xs shadow-2xs transition-all shrink-0"
          >
            <span>Start Student Meeting</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
