import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { Sparkles, FlaskConical, FolderKanban, GraduationCap, Video, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Meeting Rooms & Spaces | Tathastu Meet',
  description:
    'Discover purpose-built room formats in Tathastu Meet: Instant Meet, Research Rooms, Project Sprints, and Mentorship Sessions.',
  alternates: {
    canonical: '/rooms',
  },
  openGraph: {
    title: 'Meeting Rooms & Spaces | Tathastu Meet',
    description:
      'Discover purpose-built room formats in Tathastu Meet: Instant Meet, Research Rooms, Project Sprints, and Mentorship Sessions.',
    url: 'https://connect.aitathastu.com/rooms',
  },
};

const roomsData = [
  {
    icon: Sparkles,
    badge: 'Quick Sync',
    title: 'Instant Meeting',
    href: '/',
    description:
      'Spin up an ad-hoc room in one click. Share the secure code or link with colleagues and begin discussing without an account or download.',
    highlights: ['Instant room link generation', 'Up to 50 active participants', 'Full HD screen sharing'],
  },
  {
    icon: FlaskConical,
    badge: 'Deep Inquiry',
    title: 'Research Room',
    href: '/rooms/research',
    description:
      'Configured for academic inquiry, journal clubs, and cross-lab collaboration. Prioritizes audio clarity and document sharing for complex topics.',
    highlights: ['Code review & paper walkthroughs', 'Clean microphone dynamics', 'Distraction-free focus layout'],
  },
  {
    icon: FolderKanban,
    badge: 'Execution',
    title: 'Project Room',
    href: '/rooms/projects',
    description:
      'Designed for engineering standups, design reviews, and sprint planning. Keeps teams synchronized with fast screen switching and reactions.',
    highlights: ['Sprint retrospectives & demos', 'Multi-participant screen shares', 'Interactive emoji reactions'],
  },
  {
    icon: GraduationCap,
    badge: 'Growth',
    title: 'Mentorship Session',
    href: '/rooms/mentorship',
    description:
      'Intimate 1:1 or small-group mentoring spaces for student-faculty office hours, career counseling, and guided project reviews.',
    highlights: ['Low-latency 1:1 connection', 'Private waiting room admission', 'Clean presentation mode'],
  },
];

export default function RoomsPage() {
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
            <li className="font-semibold text-[#17151F]" aria-current="page">
              Rooms
            </li>
          </ol>
        </nav>

        <header className="max-w-3xl mb-14 sm:mb-20">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FFF5D6] px-3 py-1 rounded-full mb-3">
            Room Topology
          </span>
          <h1 className="font-heading font-bold text-3xl sm:text-5xl tracking-tight text-[#17151F] mb-5 leading-tight">
            One Real-Time Engine. Purpose-Built Rooms.
          </h1>
          <p className="text-base sm:text-lg text-[#6B675C] leading-relaxed">
            Instead of a generic video grid, Tathastu Meet formats rooms around your actual purpose.
            Whether conducting peer research, leading a project review, or mentoring student builders, choose the space that fits your work.
          </p>
        </header>

        <section aria-label="Available room types" className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 mb-20">
          {roomsData.map((room, idx) => {
            const Icon = room.icon;
            return (
              <article
                key={idx}
                className="bg-white rounded-3xl border border-[#E9E7E1] p-6 sm:p-8 shadow-xs hover:shadow-card transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-[#FFF5D6] text-[#B45309] flex items-center justify-center">
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7357E8] bg-[#F1EBFF] px-2.5 py-1 rounded-full">
                      {room.badge}
                    </span>
                  </div>

                  <h2 className="font-heading font-bold text-2xl text-[#17151F] mb-3">
                    {room.title}
                  </h2>
                  <p className="text-sm text-[#6B675C] leading-relaxed mb-6">
                    {room.description}
                  </p>

                  <ul className="list-none p-0 m-0 space-y-2 mb-6 text-xs text-[#524E44]">
                    {room.highlights.map((item, hIdx) => (
                      <li key={hIdx} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#FFC93C]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-4 border-t border-[#F0EEE8]">
                  <Link
                    href={room.href}
                    className="inline-flex items-center gap-2 min-h-[44px] text-xs font-semibold text-[#17151F] hover:text-[#7357E8] transition-colors"
                  >
                    <span>Learn more about {room.title}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
