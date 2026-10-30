import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
  interactive?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  glow = false,
  interactive = false,
  className = '',
  ...props
}) => {
  return (
    <div
      className={`
        relative rounded-2xl p-6 bg-slate-900/60 border border-white/10
        backdrop-blur-xl shadow-xl transition-all duration-300
        ${glow ? 'shadow-indigo-500/10 hover:border-indigo-500/30' : ''}
        ${interactive ? 'hover:-translate-y-1 hover:shadow-2xl cursor-pointer' : ''}
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  );
};
