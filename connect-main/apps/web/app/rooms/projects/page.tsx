import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { FolderKanban, Zap, Monitor, Smile, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Project Rooms for Agile Teams & Sprint Reviews | Tathastu Meet',
  description:
    'Real-time project rooms for engineering standups, design critiques, and product sprints. Fast screen sharing, low latency, and intuitive roundtable layout.',
  alternates: {
    canonical: '/rooms/projects',
  },
  openGraph: {
    title: 'Project Rooms for Agile Teams & Sprint Reviews | Tathastu Meet',
    description:
      'Real-time project rooms for engineering standups, design critiques, and product sprints. Fast screen sharing, low latency, and intuitive roundtable layout.',
    url: 'https://connect.aitathastu.com/rooms/projects',
  },
};

export default function ProjectRoomPage() {
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
        name: 'Rooms',
        item: 'https://connect.aitathastu.com/rooms',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Project Room',
        item: 'https://connect.aitathastu.com/rooms/projects',
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
              Project Room
            </li>
          </ol>
        </nav>

        <header className="max-w-3xl mb-14 sm:mb-16">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FFF5D6] px-3 py-1 rounded-full mb-3">
            Engineering & Product Teams
          </span>
          <h1 className="font-heading font-bold text-3xl sm:text-5xl tracking-tight text-[#17151F] mb-5 leading-tight">
            High-Velocity Project Meetings
          </h1>
          <p className="text-base sm:text-lg text-[#6B675C] leading-relaxed">
            Keep engineering sprints, product standups, and architecture reviews moving forward.
            Tathastu Meet Project Rooms give distributed teams an agile, fast-connecting virtual war room.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-16">
          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Zap className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Instant Standup Start
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              No calendar invites or downloads necessary. Team members join directly with a 9-digit room code in their browser.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Monitor className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Smooth Screen Sharing
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Effortlessly switch between IDE code reviews, Figma prototypes, and terminal logs with low-latency WebRTC streams.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Smile className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Interactive Team Reactions
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Express agreement, thumbs up, and raises hands without interrupting the speaker via lightweight real-time emoji telemetry.
            </p>
          </div>
        </section>

        <section className="bg-[#FAF9F5] border border-[#E9E7E1] rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="font-heading font-bold text-xl text-[#17151F] mb-1">
              Start your next sprint sync now
            </h3>
            <p className="text-xs text-[#6B675C]">
              Lightweight, fast, and free to start.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FFC93C] hover:bg-[#F2BD31] text-[#17151F] font-semibold text-xs shadow-2xs transition-all shrink-0"
          >
            <span>Start a Project Room</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
