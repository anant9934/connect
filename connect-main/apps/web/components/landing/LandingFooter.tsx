import React from 'react';
import Link from 'next/link';

export function LandingFooter() {
  return (
    <footer className="max-w-[1120px] mx-auto pt-10 sm:pt-14 px-4 sm:px-8 pb-14 border-t border-[#E9E7E1] text-[#17151F]">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10">
        {/* Brand Column */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon.svg"
              alt="Tathastu Meet Logo"
              width={28}
              height={28}
              className="w-7 h-7 rounded-[8px] shrink-0 object-cover"
            />
            <span className="font-heading font-bold text-[18px]">Tathastu Meet</span>
          </div>
          <p className="text-[13px] text-[#6B675C] max-w-xs leading-relaxed">
            Lightweight, high-fidelity video meetings built for research, projects, and teamwork.
          </p>
          <div className="text-[12px] text-[#9C988D] pt-2">
            © {new Date().getFullYear()} AI Tathastu. All rights reserved.
          </div>
        </div>

        {/* Product Column */}
        {/* Product Column */}
        <div>
          <div className="font-semibold text-[14px] text-[#17151F] mb-3">Product</div>
          <ul className="list-none p-0 m-0 space-y-2.5 text-[13px] text-[#6B675C]">
            <li>
              <Link href="/features" className="hover:text-[#17151F] transition-colors no-underline">
                Features & Capabilities
              </Link>
            </li>
            <li>
              <Link href="/rooms" className="hover:text-[#17151F] transition-colors no-underline">
                All Room Types
              </Link>
            </li>
            <li>
              <Link href="/rooms/research" className="hover:text-[#17151F] transition-colors no-underline">
                Research Room
              </Link>
            </li>
            <li>
              <Link href="/rooms/projects" className="hover:text-[#17151F] transition-colors no-underline">
                Project Room
              </Link>
            </li>
            <li>
              <Link href="/rooms/mentorship" className="hover:text-[#17151F] transition-colors no-underline">
                Mentorship Session
              </Link>
            </li>
          </ul>
        </div>

        {/* Solutions & Compare Column */}
        <div>
          <div className="font-semibold text-[14px] text-[#17151F] mb-3">Solutions & Compare</div>
          <ul className="list-none p-0 m-0 space-y-2.5 text-[13px] text-[#6B675C]">
            <li>
              <Link href="/use-cases/students" className="hover:text-[#17151F] transition-colors no-underline">
                For Students & Labs
              </Link>
            </li>
            <li>
              <Link href="/use-cases/researchers" className="hover:text-[#17151F] transition-colors no-underline">
                For Scientific Researchers
              </Link>
            </li>
            <li>
              <Link href="/use-cases/teams" className="hover:text-[#17151F] transition-colors no-underline">
                For Remote Agile Teams
              </Link>
            </li>
            <li>
              <Link href="/compare/zoom-alternative" className="hover:text-[#17151F] transition-colors no-underline">
                Zoom Alternative
              </Link>
            </li>
            <li>
              <Link href="/compare/google-meet-alternative" className="hover:text-[#17151F] transition-colors no-underline">
                Google Meet Alternative
              </Link>
            </li>
          </ul>
        </div>

        {/* Security & Access */}
        <div>
          <div className="font-semibold text-[14px] text-[#17151F] mb-3">Security & Access</div>
          <ul className="list-none p-0 m-0 space-y-2.5 text-[13px] text-[#6B675C]">
            <li>
              <Link href="/security" className="hover:text-[#17151F] transition-colors no-underline">
                Security & Zero Trust
              </Link>
            </li>
            <li>
              <Link href="/sign-in" className="hover:text-[#17151F] transition-colors no-underline">
                Account Sign In
              </Link>
            </li>
            <li>
              <a
                href="https://aitathastu.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-[#17151F] transition-colors no-underline"
              >
                AI Tathastu Ecosystem
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
