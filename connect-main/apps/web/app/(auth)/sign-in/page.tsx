import React, { Suspense } from 'react';
import { Metadata } from 'next';
import { SignInForm } from '@/components/auth/SignInForm';
import { Loader2 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Sign In | Tathastu Meet',
  description: 'Sign in to Tathastu Meet to start and manage secure video meetings.',
};

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#FCFCFA] flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-8 h-8 text-[#7258E8] animate-spin" />
        </div>
      }>
        <SignInForm />
      </Suspense>
    </div>
  );
}
