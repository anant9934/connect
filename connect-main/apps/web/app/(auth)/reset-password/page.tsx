import React from 'react';
import { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Reset Password | Tathastu Meet',
  description: 'Set a new Tathastu Meet password with a one-time reset code.',
  robots: { index: false },
};

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-[#FCFCFA] flex items-center justify-center p-4">
      <ResetPasswordForm />
    </div>
  );
}
