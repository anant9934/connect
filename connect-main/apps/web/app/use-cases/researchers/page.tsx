import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { FlaskConical, Network, Lock, FileCode, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Video Meetings for Research Groups & AI Labs | Tathastu Meet',
  description:
    'Secure, privacy-conscious video collaboration platform for academic researchers, scientific laboratories, and AI teams. High-clarity audio and code sharing.',
  alternates: {
    canonical: '/use-cases/researchers',
  },
  openGraph: {
    title: 'Video Meetings for Research Groups & AI Labs | Tathastu Meet',
    description:
      'Secure, privacy-conscious video collaboration platform for academic researchers, scientific laboratories, and AI teams. High-clarity audio and code sharing.',
    url: 'https://connect.aitathastu.com/use-cases/researchers',
  },
};

export default function ResearchersUseCasePage() {
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
        item: 'https://connect.aitathastu.com/use-cases/researchers',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Researchers',
        item: 'https://connect.aitathastu.com/use-cases/researchers',
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
              Researchers
            </li>
          </ol>
        </nav>

        <header className="max-w-3xl mb-14 sm:mb-16">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FFF5D6] px-3 py-1 rounded-full mb-3">
            Scientific Inquiry
          </span>
          <h1 className="font-heading font-bold text-3xl sm:text-5xl tracking-tight text-[#17151F] mb-5 leading-tight">
            Collaborative Video for Scientific & AI Research
          </h1>
          <p className="text-base sm:text-lg text-[#6B675C] leading-relaxed">
            Leading labs and interdisciplinary researchers need high-fidelity screen rendering,
            clear conversational dynamics, and strict data isolation. Tathastu Meet provides zero-retention meeting spaces for research teams.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-16">
          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Lock className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Confidential Research Discussions
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              No tracking, no default recordings, and no training on user conversations. Data streams remain strictly private between participants.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <FileCode className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Code & Notebook Sharing
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Present Jupyter notebooks, PyTorch models, and benchmark graphs with full resolution and no text blurring.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-4">
              <Network className="w-5 h-5" />
            </div>
            <h2 className="font-heading font-bold text-lg text-[#17151F] mb-2">
              Cross-Institution Alignment
            </h2>
            <p className="text-sm text-[#6B675C] leading-relaxed">
              Connect university faculty, industry partners, and independent fellows across firewalls via modern WebRTC SFU infrastructure.
            </p>
          </div>
        </section>

        <section className="bg-[#FAF9F5] border border-[#E9E7E1] rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="font-heading font-bold text-xl text-[#17151F] mb-1">
              Set up your research room today
            </h3>
            <p className="text-xs text-[#6B675C]">
              Zero software installations needed for international collaborators.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FFC93C] hover:bg-[#F2BD31] text-[#17151F] font-semibold text-xs shadow-2xs transition-all shrink-0"
          >
            <span>Launch Research Room</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
