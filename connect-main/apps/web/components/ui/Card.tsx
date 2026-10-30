import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: 'white' | 'tinted';
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'white',
  className = '',
  ...props
}) => {
  const bg = variant === 'white' ? 'bg-white' : 'bg-[#F7F7F3]';
  return (
    <div
      className={`rounded-2xl border border-[#E9E9E5] p-6 shadow-card transition-all duration-200 ${bg} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
