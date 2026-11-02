import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { GraduationCap, HeartHandshake, Shield, Sparkles, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Mentorship Rooms & 1:1 Guidance Sessions | Tathastu Meet',
  description:
    'Dedicated video meetings for student-mentor guidance, academic office hours, and professional coaching. Private waiting rooms, low-latency audio, and 1:1 focus.',
  alternates: {
    canonical: '/rooms/mentorship',
  },
  openGraph: {
    title: 'Mentorship Rooms & 1:1 Guidance Sessions | Tathastu Meet',
    description:
      'Dedicated video meetings for student-mentor guidance, academic office hours, and professional coaching. Private waiting rooms, low-latency audio, and 1:1 focus.',
    url: 'https://connect-mauve-nine.vercel.app/rooms/mentorship',
  },
};

export default function MentorshipRoomPage() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://connect-mauve-nine.vercel.app',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Rooms',
        item: 'https://connect-mauve-nine.vercel.app/rooms',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Mentorship Room',
        item: 'https://connect-mauve-nine.vercel.app/rooms/mentorship',
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
              <Link href="/rooms" className="hover:text-[#17151F] transition-colors">
                Rooms
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-[#17151F]" aria-current="page">
              Mentorship Room
            </li>
          </ol>
        </nav>

        <header className="max-w-3xl mb-14 sm:mb-16">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FFF5D6] px-3 py-1 rounded-full mb-3">
            1:1 & Small Group Mentoring
          </span>
          <h1 className="font-heading font-bold text-3xl sm:text-5xl tracking-tight text-[#17151F] mb-5 leading-tight">
            Personal Guidance That Feels Like a Real Room Talk
          </h1>
          <p className="text-base sm:text-lg text-[#6B675C] leading-relaxed">
            Mentorship requires psychological safety, privacy, and conversational nuance.
            Tathastu Meet Mentorship Rooms provide student-faculty office hours and executive coaching with quiet, focused spaces.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-16">
          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Shield className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Waiting Room Admission
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Maintain office hour queues cleanly. Mentors admit students individually when ready, preventing unexpected drop-ins.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <HeartHandshake className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Natural 1:1 Intimacy
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Balanced, side-by-side participant framing creates natural eye contact and comfortable conversation dynamics.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Sparkles className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Seamless Resume & Portfolio Reviews
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Walk through student codebases, academic portfolios, and resumes with crisp, responsive screen sharing.
            </p>
          </div>
        </section>

        <section className="bg-[#FAF9F5] border border-[#E9E7E1] rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="font-heading font-bold text-xl text-[#17151F] mb-1">
              Host your next mentorship session
            </h3>
            <p className="text-xs text-[#6B675C]">
              Create a link once, share it with your mentee, and begin.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FFC93C] hover:bg-[#F2BD31] text-[#17151F] font-semibold text-xs shadow-2xs transition-all shrink-0"
          >
            <span>Start a Mentorship Room</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
