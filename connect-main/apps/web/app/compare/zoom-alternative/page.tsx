import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { Check, X, ArrowRight, ShieldCheck, Zap, Laptop } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Zoom Alternative for Video Meetings & Research Teams | Tathastu Meet',
  description:
    'An honest, lightweight alternative to Zoom. Join video meetings in your browser without mandatory desktop downloads, no 40-minute cutoffs, and purpose-built rooms.',
  alternates: {
    canonical: '/compare/zoom-alternative',
  },
  openGraph: {
    title: 'Zoom Alternative for Video Meetings & Research Teams | Tathastu Meet',
    description:
      'An honest, lightweight alternative to Zoom. Join video meetings in your browser without mandatory desktop downloads, no 40-minute cutoffs, and purpose-built rooms.',
    url: 'https://connect-mauve-nine.vercel.app/compare/zoom-alternative',
  },
};

export default function ZoomAlternativePage() {
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
        name: 'Compare',
        item: 'https://connect-mauve-nine.vercel.app/compare/zoom-alternative',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Zoom Alternative',
        item: 'https://connect-mauve-nine.vercel.app/compare/zoom-alternative',
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
              <span>Compare</span>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-[#17151F]" aria-current="page">
              Zoom Alternative
            </li>
          </ol>
        </nav>

        <header className="max-w-3xl mb-14 sm:mb-16">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FFF5D6] px-3 py-1 rounded-full mb-3">
            Honest Platform Comparison
          </span>
          <h1 className="font-heading font-bold text-3xl sm:text-5xl tracking-tight text-[#17151F] mb-5 leading-tight">
            A Lightweight, Browser-First Alternative to Zoom
          </h1>
          <p className="text-base sm:text-lg text-[#6B675C] leading-relaxed">
            Zoom transformed video communications, but for research groups, builders, and agile project teams,
            heavy desktop client installs and arbitrary 40-minute timeouts introduce unnecessary friction.
            Here is how Tathastu Meet compares.
          </p>
        </header>

        {/* Feature Comparison Table */}
        <section aria-labelledby="comparison-table-heading" className="bg-white rounded-3xl border border-[#E9E7E1] overflow-hidden shadow-xs mb-16">
          <div className="p-6 sm:p-8 border-b border-[#E9E7E1]">
            <h2 id="comparison-table-heading" className="font-heading font-bold text-xl sm:text-2xl text-[#17151F]">
              Feature-by-Feature Comparison
            </h2>
            <p className="text-xs text-[#6B675C] mt-1">
              Factual assessment of client architecture and meeting experience.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#FAF9F5] border-b border-[#E9E7E1] text-[#17151F] font-heading font-semibold">
                  <th className="py-4 px-6">Capability</th>
                  <th className="py-4 px-6 text-[#B45309] bg-[#FFF9E6]">Tathastu Meet</th>
                  <th className="py-4 px-6 text-[#524E44]">Traditional Zoom Free</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9E7E1]">
                <tr>
                  <td className="py-4 px-6 font-medium text-[#17151F]">Guest Joining Requirements</td>
                  <td className="py-4 px-6 bg-[#FFF9E6] font-semibold text-[#17151F]">
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Zero install browser join with code
                    </span>
                  </td>
                  <td className="py-4 px-6 text-[#6B675C]">
                    Pushes desktop client download (.exe/.pkg)
                  </td>
                </tr>

                <tr>
                  <td className="py-4 px-6 font-medium text-[#17151F]">Meeting Duration Limits</td>
                  <td className="py-4 px-6 bg-[#FFF9E6] font-semibold text-[#17151F]">
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Continuous meetings without 40m cutoff
                    </span>
                  </td>
                  <td className="py-4 px-6 text-[#6B675C]">
                    <span className="inline-flex items-center gap-1.5 text-amber-700">
                      <X className="w-4 h-4 text-red-500" />
                      Strict 40-minute limit on group calls
                    </span>
                  </td>
                </tr>

                <tr>
                  <td className="py-4 px-6 font-medium text-[#17151F]">Room Architectures</td>
                  <td className="py-4 px-6 bg-[#FFF9E6] font-semibold text-[#17151F]">
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Research, Project & Mentorship spaces
                    </span>
                  </td>
                  <td className="py-4 px-6 text-[#6B675C]">
                    Single generic corporate video grid
                  </td>
                </tr>

                <tr>
                  <td className="py-4 px-6 font-medium text-[#17151F]">Screen Sharing & Latency</td>
                  <td className="py-4 px-6 bg-[#FFF9E6] font-semibold text-[#17151F]">
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Native WebRTC SFU with Opus audio
                    </span>
                  </td>
                  <td className="py-4 px-6 text-[#6B675C]">
                    Proprietary desktop media codec
                  </td>
                </tr>

                <tr>
                  <td className="py-4 px-6 font-medium text-[#17151F]">Security & Guest Access</td>
                  <td className="py-4 px-6 bg-[#FFF9E6] font-semibold text-[#17151F]">
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Cryptographic HMAC tokens + Waiting Room
                    </span>
                  </td>
                  <td className="py-4 px-6 text-[#6B675C]">
                    Waiting room + passcode required
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Legal Disclaimer */}
        <p className="text-[11px] text-[#8E8A80] leading-relaxed mb-16">
          *Disclaimer: Zoom is a registered trademark of Zoom Video Communications, Inc.
          Tathastu Meet is an independent platform and has no affiliation with, sponsorship by, or endorsement from Zoom Video Communications, Inc.
          Comparisons are based on standard public feature tiers as of 2026.
        </p>

        {/* CTA */}
        <section className="bg-[#FAF9F5] border border-[#E9E7E1] rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="font-heading font-bold text-xl text-[#17151F] mb-1">
              Experience the lightweight difference
            </h3>
            <p className="text-xs text-[#6B675C]">
              No downloads, no installations, no artificial 40-minute timeouts.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FFC93C] hover:bg-[#F2BD31] text-[#17151F] font-semibold text-xs shadow-2xs transition-all shrink-0"
          >
            <span>Start a Free Meeting</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
