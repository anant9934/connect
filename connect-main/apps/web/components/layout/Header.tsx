'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Button } from '../ui/Button';

export const Header: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full bg-[#FCFCFA]/85 backdrop-blur-md border-b border-[#E9E9E5]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 select-none group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon.svg"
            alt="Tathastu Meet Logo"
            width={32}
            height={32}
            className="w-8 h-8 rounded-xl object-cover shadow-2xs transition-transform group-hover:scale-105"
          />
          <span className="font-semibold text-base tracking-tight text-[#171717] font-heading">
            Tathastu Meet
          </span>
        </Link>

        {/* Desktop Nav Items */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[#686868]">
          <a href="#product" className="hover:text-[#171717] transition-colors">
            Product
          </a>
          <a href="#use-cases" className="hover:text-[#171717] transition-colors">
            Use Cases
          </a>
          <a href="#about" className="hover:text-[#171717] transition-colors">
            About
          </a>
        </nav>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/sign-in"
            className="text-sm font-medium text-[#686868] hover:text-[#171717] px-3 py-1.5 transition-colors"
          >
            Sign in
          </Link>
          <Link href="/sign-up">
            <Button size="sm">Get started</Button>
          </Link>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 rounded-xl text-[#686868] hover:text-[#171717] hover:bg-[#F7F7F3]"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden px-4 pt-3 pb-5 bg-[#FCFCFA] border-b border-[#E9E9E5] space-y-3 animate-in fade-in duration-150">
          <nav className="flex flex-col gap-2.5 text-sm font-medium text-[#171717]">
            <a
              href="#product"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-[#F7F7F3]"
            >
              Product
            </a>
            <a
              href="#use-cases"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-[#F7F7F3]"
            >
              Use Cases
            </a>
            <a
              href="#about"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-[#F7F7F3]"
            >
              About
            </a>
          </nav>
          <div className="pt-2 border-t border-[#E9E9E5] flex flex-col gap-2">
            <Link
              href="/sign-in"
              onClick={() => setMobileMenuOpen(false)}
              className="text-sm font-medium text-center py-2 text-[#686868]"
            >
              Sign in
            </Link>
            <Link href="/sign-up" onClick={() => setMobileMenuOpen(false)}>
              <Button size="sm" className="w-full">
                Get started
              </Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
};
