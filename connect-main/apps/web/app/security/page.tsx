import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { ShieldCheck, Lock, Key, EyeOff, Server, UserCheck, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Security & Privacy Practices | Tathastu Meet',
  description:
    'Learn how Tathastu Meet secures video meetings: cryptographic token verification, ephemeral media relays, host admission gates, and zero third-party telemetry tracking.',
  alternates: {
    canonical: '/security',
  },
  openGraph: {
    title: 'Security & Privacy Practices | Tathastu Meet',
    description:
      'Learn how Tathastu Meet secures video meetings: cryptographic token verification, ephemeral media relays, host admission gates, and zero third-party telemetry tracking.',
    url: 'https://connect.aitathastu.com/security',
  },
};

const securityPillars = [
  {
    icon: Key,
    title: 'Server-Side Token Isolation',
    description:
      'LiveKit API keys and token signing secrets reside exclusively in the backend server environment. Browsers receive short-lived (10-minute), least-privilege JSON Web Tokens scoped strictly to the specified meeting room.',
  },
  {
    icon: UserCheck,
    title: 'Cryptographic Guest Verification',
    description:
      'Unauthenticated participants receive HMAC-signed guest credentials. A guest cannot spoof another attendee’s identity, claim host privileges, or bypass waiting room governance through client-side manipulation.',
  },
  {
    icon: Lock,
    title: 'Host Admission & Waiting Rooms',
    description:
      'When waiting room mode is active, incoming guests enter an isolated holding state. The host reviews attendee names and admits or declines each request server-side before any media token is generated.',
  },
  {
    icon: EyeOff,
    title: 'Private Route Protection',
    description:
      'Active meeting rooms and history archives are protected by strict noindex metadata, cache-control directives, and server-side authorization. Meeting codes are never indexed in public search engines or sitemaps.',
  },
  {
    icon: Server,
    title: 'Ephemeral Media Transmission',
    description:
      'Real-time audio, video, and screen sharing packets are routed directly between participants or via encrypted WebRTC SFU relays. Meeting streams are not recorded, stored, or analyzed without explicit host enablement.',
  },
  {
    icon: ShieldCheck,
    title: 'Strict Security Headers',
    description:
      'Production responses enforce Strict-Transport-Security (HSTS), Content-Security-Policy (CSP), X-Frame-Options: DENY, and granular Permissions-Policy restricting camera/mic access to authorized origins.',
  },
];

const faqs = [
  {
    question: 'How does Tathastu Meet handle meeting access and privacy?',
    answer:
      'Every meeting is isolated to its unique room identifier. Hosts can lock meetings to prevent new arrivals and activate waiting room admission. Media tokens are signed server-side with strict 10-minute expiries.',
  },
  {
    question: 'Are meeting conversations recorded or used for AI training?',
    answer:
      'No. Real-time media feeds pass through encrypted WebRTC channels and are never stored, transcribed, or used for AI model training without explicit configuration.',
  },
  {
    question: 'Can someone join my meeting just by guessing the URL?',
    answer:
      'Room codes are formatted with sufficient entropy to prevent random enumeration. When a meeting is locked or waiting room is enabled, possession of the code alone does not grant admission.',
  },
];

export default function SecurityPage() {
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
        name: 'Security',
        item: 'https://connect.aitathastu.com/security',
      },
    ],
  };

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };

  return (
    <div className="min-h-screen bg-[#FCFCFA] text-[#17151F] font-sans antialiased">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
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
              Security
            </li>
          </ol>
        </nav>

        {/* Hero Section */}
        <header className="max-w-3xl mb-14 sm:mb-20">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FFF5D6] px-3 py-1 rounded-full mb-3">
            Privacy & Trust
          </span>
          <h1 className="font-heading font-bold text-3xl sm:text-5xl tracking-tight text-[#17151F] mb-5 leading-tight">
            Security by Architecture, Not Afterthought
          </h1>
          <p className="text-base sm:text-lg text-[#6B675C] leading-relaxed">
            Tathastu Meet is designed with a defense-in-depth security model.
            From cryptographically signed participant tokens to strict room access policies,
            your discussions remain confidential, ephemeral, and protected.
          </p>
        </header>

        {/* Security Architecture Grid */}
        <section aria-label="Security architecture pillars" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 mb-20">
          {securityPillars.map((pillar, idx) => {
            const Icon = pillar.icon;
            return (
              <article
                key={idx}
                className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-7 shadow-xs hover:shadow-card transition-all"
              >
                <div className="w-12 h-12 rounded-2xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center mb-5">
                  <Icon className="w-6 h-6" />
                </div>
                <h2 className="font-heading font-bold text-xl text-[#17151F] mb-2.5">
                  {pillar.title}
                </h2>
                <p className="text-sm text-[#6B675C] leading-relaxed">
                  {pillar.description}
                </p>
              </article>
            );
          })}
        </section>

        {/* Frequently Answered Security Questions */}
        <section aria-labelledby="security-faq-heading" className="max-w-3xl mb-20">
          <h2 id="security-faq-heading" className="font-heading font-bold text-2xl sm:text-3xl text-[#17151F] mb-8">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            {faqs.map((faq, idx) => (
              <div key={idx} className="bg-white rounded-2xl border border-[#E9E7E1] p-6 shadow-2xs">
                <h3 className="font-heading font-semibold text-base sm:text-lg text-[#17151F] mb-2">
                  {faq.question}
                </h3>
                <p className="text-sm text-[#6B675C] leading-relaxed">
                  {faq.answer}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="bg-[#FAF9F5] border border-[#E9E7E1] rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="font-heading font-bold text-xl text-[#17151F] mb-1">
              Ready to start a confidential meeting?
            </h3>
            <p className="text-xs text-[#6B675C]">
              No downloads required. Enter the meeting stage in seconds.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FFC93C] hover:bg-[#F2BD31] text-[#17151F] font-semibold text-xs shadow-2xs transition-all shrink-0"
          >
            <span>Start Meeting</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
