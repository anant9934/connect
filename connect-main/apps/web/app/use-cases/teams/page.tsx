import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { Briefcase, Zap, Shield, Sparkles, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Video Conferencing for Remote Teams & Agile Sprints | Tathastu Meet',
  description:
    'Lightweight video collaboration platform for distributed engineering, product, and operations teams. Browser-based, low latency, and zero installation barrier.',
  alternates: {
    canonical: '/use-cases/teams',
  },
  openGraph: {
    title: 'Video Conferencing for Remote Teams & Agile Sprints | Tathastu Meet',
    description:
      'Lightweight video collaboration platform for distributed engineering, product, and operations teams. Browser-based, low latency, and zero installation barrier.',
    url: 'https://connect-alpha-seven.vercel.app/use-cases/teams',
  },
};

export default function TeamsUseCasePage() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://connect-alpha-seven.vercel.app',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Use Cases',
        item: 'https://connect-alpha-seven.vercel.app/use-cases/teams',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Remote Teams',
        item: 'https://connect-alpha-seven.vercel.app/use-cases/teams',
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
              Remote Teams
            </li>
          </ol>
        </nav>

        <header className="max-w-3xl mb-14 sm:mb-16">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FFF5D6] px-3 py-1 rounded-full mb-3">
            Distributed Work
          </span>
          <h1 className="font-heading font-bold text-3xl sm:text-5xl tracking-tight text-[#17151F] mb-5 leading-tight">
            Fast, Uncluttered Video Meetings for Agile Teams
          </h1>
          <p className="text-base sm:text-lg text-[#6B675C] leading-relaxed">
            Eliminate meeting fatigue and bloated desktop client updates.
            Tathastu Meet opens in your browser instantly, keeping distributed developers, designers, and managers connected.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-16">
          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Zap className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              No Client Bloat
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              No gigabyte-sized desktop background updaters slowing your machine down. Runs smoothly in Google Chrome, Safari, Edge, and Firefox.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Briefcase className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Rapid Standups & Reviews
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Jump from Slack or email directly into a live room with a short URL or room code. Screen share code branches and prototypes instantly.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Shield className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Enterprise Zero Trust
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Meeting links remain private with host admission controls, cryptographically verified guest credentials, and room locking.
            </p>
          </div>
        </section>

        <section className="bg-[#FAF9F5] border border-[#E9E7E1] rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="font-heading font-bold text-xl text-[#17151F] mb-1">
              Start your next team sync in seconds
            </h3>
            <p className="text-xs text-[#6B675C]">
              No credit card required. Free to get started.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FFC93C] hover:bg-[#F2BD31] text-[#17151F] font-semibold text-xs shadow-2xs transition-all shrink-0"
          >
            <span>Start Team Meeting</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
