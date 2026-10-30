import React from 'react';
import Link from 'next/link';

export const Footer: React.FC = () => {
  return (
    <footer id="about" className="border-t border-[#E9E9E5] bg-[#F7F7F3] py-14 text-sm text-[#686868]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          {/* Brand Col */}
          <div className="col-span-2 space-y-3">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icon.svg"
                alt="Tathastu Meet Logo"
                width={28}
                height={28}
                className="w-7 h-7 rounded-lg object-cover shadow-2xs"
              />
              <span className="font-semibold text-base tracking-tight text-[#171717] font-heading">
                Tathastu Meet
              </span>
            </div>
            <p className="text-xs text-[#686868] max-w-sm leading-relaxed">
              Fast, simple video meetings and collaborative spaces for research teams, builders, mentors, and student groups.
            </p>
          </div>

          {/* Nav Col 1 */}
          <div className="space-y-3">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-[#171717]">
              Product
            </h5>
            <ul className="space-y-2 text-xs">
              <li>
                <a href="#product" className="hover:text-[#171717] transition-colors">
                  Meetings
                </a>
              </li>
              <li>
                <a href="#product" className="hover:text-[#171717] transition-colors">
                  Collaboration Spaces
                </a>
              </li>
              <li>
                <a href="#use-cases" className="hover:text-[#171717] transition-colors">
                  AI Matchmaking
                </a>
              </li>
            </ul>
          </div>

          {/* Nav Col 2 */}
          <div className="space-y-3">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-[#171717]">
              Use Cases
            </h5>
            <ul className="space-y-2 text-xs">
              <li>
                <a href="#use-cases" className="hover:text-[#171717] transition-colors">
                  Research Labs
                </a>
              </li>
              <li>
                <a href="#use-cases" className="hover:text-[#171717] transition-colors">
                  Peer Mentorship
                </a>
              </li>
              <li>
                <a href="#use-cases" className="hover:text-[#171717] transition-colors">
                  Project Sprints
                </a>
              </li>
            </ul>
          </div>

          {/* Nav Col 3 */}
          <div className="space-y-3">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-[#171717]">
              Company
            </h5>
            <ul className="space-y-2 text-xs">
              <li>
                <a href="#about" className="hover:text-[#171717] transition-colors">
                  About
                </a>
              </li>
              <li>
                <a href="#about" className="hover:text-[#171717] transition-colors">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#about" className="hover:text-[#171717] transition-colors">
                  Terms of Service
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-[#E9E9E5] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#686868]">
          <p>© {new Date().getFullYear()} AI Tathastu. All rights reserved.</p>
          <p className="flex items-center gap-2">
            <span>Work better, together.</span>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
