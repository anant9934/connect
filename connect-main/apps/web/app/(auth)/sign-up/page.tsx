import React, { Suspense } from 'react';
import { Metadata } from 'next';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { Loader2 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Sign Up | Tathastu Meet',
  description: 'Create an account on Tathastu Meet to start video meetings and collaborate with teams.',
};

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-[#FCFCFA] flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-8 h-8 text-[#7258E8] animate-spin" />
        </div>
      }>
        <SignUpForm />
      </Suspense>
    </div>
  );
}
