import React from 'react';

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  colorBg?: string;
  colorText?: string;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  size = 'md',
  color,
  colorBg = '#EEE9FF',
  colorText = '#7258E8',
  className = '',
}) => {
  const effectiveBg = color || colorBg;
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const sizeClasses = {
    sm: 'w-7 h-7 text-[11px]',
    md: 'w-9 h-9 text-xs',
    lg: 'w-11 h-11 text-sm font-semibold',
  }[size];

  return (
    <div
      style={{ backgroundColor: effectiveBg, color: color ? '#FFFFFF' : colorText }}
      className={`inline-flex items-center justify-center font-medium rounded-full select-none shrink-0 ${sizeClasses} ${className}`}
      aria-label={name}
    >
      {initials}
    </div>
  );
};
