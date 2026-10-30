import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { Video, ShieldCheck, Share2, Users, Sliders, Smartphone, CheckCircle, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Platform Features & Capabilities | Tathastu Meet',
  description:
    'Explore verified video conferencing capabilities in Tathastu Meet: adaptive HD video, clear voice, instant screen sharing, and secure waiting rooms.',
  alternates: {
    canonical: '/features',
  },
  openGraph: {
    title: 'Platform Features & Capabilities | Tathastu Meet',
    description:
      'Explore verified video conferencing capabilities in Tathastu Meet: adaptive HD video, clear voice, instant screen sharing, and secure waiting rooms.',
    url: 'https://connect.aitathastu.com/features',
  },
};

const featureList = [
  {
    icon: Video,
    title: 'Adaptive Video & Crystal Voice',
    description:
      'Engineered with LiveKit Selective Forwarding Units (SFU) and WebRTC. Dynamic simulcast automatically adapts resolution and bitrate to each participant’s network conditions.',
    details: ['Adaptive bitrate scaling', 'Opus voice codec with echo cancellation', 'Automatic reconnection recovery'],
  },
  {
    icon: Share2,
    title: 'High-Fidelity Screen Sharing',
    description:
      'Share code reviews, research slides, designs, and browser windows with a single click. Supports full display capture with system audio passthrough.',
    details: ['Single-window or entire screen', 'Low-latency presentation feed', 'Simultaneous participant video'],
  },
  {
    icon: ShieldCheck,
    title: 'Zero-Trust Meeting Access',
    description:
      'Private meetings with cryptographic host authorization, room locking, and host-managed waiting room admission.',
    details: ['Host-controlled admission queue', 'HMAC-signed guest credentials', 'One-click instant room locking'],
  },
  {
    icon: Users,
    title: 'Smart Roundtable Grid',
    description:
      'Dynamic participant layout engine that optimizes screen space for 1, 2, 4, or up to 50 active participants across mobile and desktop viewports.',
    details: ['Active speaker auto-spotlight', 'Dominant audio indicator', 'Hand raise & reaction telemetry'],
  },
  {
    icon: Sliders,
    title: 'Pre-Join Device Verification',
    description:
      'Inspect camera preview, test microphone input levels, and verify output speakers before entering any active meeting stage.',
    details: ['Live camera mirror preview', 'Visual audio input meter', 'Hardware device selector'],
  },
  {
    icon: Smartphone,
    title: 'Cross-Platform Native Experience',
    description:
      'Access Tathastu Meet seamlessly in modern web browsers (Chrome, Safari, Firefox, Edge) or on Android smartphones with our native app.',
    details: ['Zero install browser joining', 'Dedicated Android native APK', 'PWA installable app support'],
  },
];

export default function FeaturesPage() {
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
        name: 'Features',
        item: 'https://connect.aitathastu.com/features',
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
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="text-xs text-[#6B675C] mb-6">
          <ol className="flex items-center gap-2 list-none p-0 m-0">
            <li>
              <Link href="/" className="hover:text-[#17151F] transition-colors">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-[#17151F]" aria-current="page">
              Features
            </li>
          </ol>
        </nav>

        {/* Hero Section */}
        <header className="max-w-3xl mb-14 sm:mb-20">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FFF5D6] px-3 py-1 rounded-full mb-3">
            Core Capabilities
          </span>
          <h1 className="font-heading font-bold text-3xl sm:text-5xl tracking-tight text-[#17151F] mb-5 leading-tight">
            Built for Real-Time Human Connection
          </h1>
          <p className="text-base sm:text-lg text-[#6B675C] leading-relaxed">
            Every feature in Tathastu Meet is designed to create the feeling of sitting around a real table.
            From low-latency media pipelines to privacy-first admission gates, explore what powers our meetings.
          </p>
        </header>

        {/* Features Grid */}
        <section aria-label="Verified features list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 mb-20">
          {featureList.map((item, idx) => {
            const Icon = item.icon;
            return (
              <article
                key={idx}
                className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs hover:shadow-card transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-5">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h2 className="font-heading font-bold text-xl text-[#17151F] mb-2.5">
                    {item.title}
                  </h2>
                  <p className="text-sm text-[#6B675C] leading-relaxed mb-6">
                    {item.description}
                  </p>
                </div>

                <ul className="list-none p-0 m-0 space-y-2 pt-4 border-t border-[#F0EEE8] text-xs text-[#524E44]">
                  {item.details.map((detail, dIdx) => (
                    <li key={dIdx} className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>

        {/* Technical Architecture Overview */}
        <section aria-labelledby="architecture-heading" className="bg-[#17151F] text-white rounded-3xl p-8 sm:p-12 mb-20 shadow-xl">
          <div className="max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#FFC93C] mb-2 block">
              Under the Hood
            </span>
            <h2 id="architecture-heading" className="font-heading font-bold text-2xl sm:text-4xl mb-4">
              Real-Time Architecture You Can Trust
            </h2>
            <p className="text-sm sm:text-base text-[#B3B0A6] leading-relaxed mb-8">
              We separate signaling orchestration, cryptographic identity verification, and media distribution.
              Media streams are delivered peer-to-peer or via globally distributed LiveKit SFU relays without persistent recording or unauthorized data retention.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/security"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#FFC93C] hover:bg-[#F2BD31] text-[#17151F] font-semibold text-xs transition-colors"
              >
                <span>Read Security Architecture</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/rooms"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 text-white font-semibold text-xs transition-colors"
              >
                <span>Explore Room Types</span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
