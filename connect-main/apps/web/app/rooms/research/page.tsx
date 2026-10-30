import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { FlaskConical, FileText, Share2, Mic, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Research Rooms for Academic & Lab Collaboration | Tathastu Meet',
  description:
    'Dedicated video collaboration for research labs, AI researchers, and academic groups. High-fidelity document sharing, clear voice, and distraction-free roundtable discussions.',
  alternates: {
    canonical: '/rooms/research',
  },
  openGraph: {
    title: 'Research Rooms for Academic & Lab Collaboration | Tathastu Meet',
    description:
      'Dedicated video collaboration for research labs, AI researchers, and academic groups. High-fidelity document sharing, clear voice, and distraction-free roundtable discussions.',
    url: 'https://connect.aitathastu.com/rooms/research',
  },
};

export default function ResearchRoomPage() {
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
        name: 'Research Room',
        item: 'https://connect.aitathastu.com/rooms/research',
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
              Research Room
            </li>
          </ol>
        </nav>

        <header className="max-w-3xl mb-14 sm:mb-16">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FFF5D6] px-3 py-1 rounded-full mb-3">
            Academic & Scientific Meetings
          </span>
          <h1 className="font-heading font-bold text-3xl sm:text-5xl tracking-tight text-[#17151F] mb-5 leading-tight">
            Research Collaboration Without Digital Friction
          </h1>
          <p className="text-base sm:text-lg text-[#6B675C] leading-relaxed">
            In-depth inquiry requires deep focus. The Tathastu Meet Research Room brings scientific labs,
            AI researchers, and academic collaborators together around an uncluttered, high-clarity video environment.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-16">
          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Share2 className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              High-DPI Paper & Code Sharing
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Read mathematical formulas, code repositories, and LaTeX papers without downsampling or fuzzy compression artifacts.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Mic className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Acoustic Voice Clarity
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Opus wideband audio captures nuanced discussions, preventing listener fatigue during long journal clubs and thesis reviews.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <FileText className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              In-Meeting Artifact Notes
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Record shared notes and findings directly during the discussion for authenticated hosts to reference in their session history.
            </p>
          </div>
        </section>

        <section className="bg-[#FAF9F5] border border-[#E9E7E1] rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="font-heading font-bold text-xl text-[#17151F] mb-1">
              Start a Research Room in Seconds
            </h3>
            <p className="text-xs text-[#6B675C]">
              Share the room code with your lab or co-authors. No registration needed for guests.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FFC93C] hover:bg-[#F2BD31] text-[#17151F] font-semibold text-xs shadow-2xs transition-all shrink-0"
          >
            <span>Launch Meeting Room</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
