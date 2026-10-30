import React from 'react';

export interface BadgeProps {
  variant?: 'online' | 'active' | 'standby' | 'inCall' | 'neutral';
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  children,
  className = '',
  dot = true,
}) => {
  const styles = {
    online: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    active: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
    standby: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    inCall: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
    neutral: 'bg-white/5 text-slate-300 border-white/10',
  }[variant];

  const dotColors = {
    online: 'bg-emerald-400',
    active: 'bg-cyan-400 animate-pulse',
    standby: 'bg-amber-400',
    inCall: 'bg-indigo-400',
    neutral: 'bg-slate-400',
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border backdrop-blur-md ${styles} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColors}`} aria-hidden="true" />}
      {children}
    </span>
  );
};
