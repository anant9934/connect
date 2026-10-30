import { cn } from '@/lib/utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'soft' | 'white';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  disabled,
  ...props
}) => {
  const baseStyles =
    'relative inline-flex items-center justify-center font-medium transition-all duration-150 ' +
    'rounded-xl select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7258E8] ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-[#FCFCFA] disabled:opacity-40 disabled:cursor-not-allowed ' +
    'active:scale-[0.98]';

  const sizeStyles = {
    sm: 'text-xs px-3.5 py-1.5 gap-1.5',
    md: 'text-sm px-4 py-2.5 gap-2',
    lg: 'text-base px-5 py-3 gap-2.5',
  }[size];

  const variantStyles = {
    primary:
      'bg-[#171717] hover:bg-[#2B2B2B] text-white shadow-soft',
    secondary:
      'bg-white hover:bg-[#F7F7F3] text-[#171717] border border-[#E9E9E5] shadow-soft',
    ghost:
      'bg-transparent hover:bg-[#F7F7F3] text-[#686868] hover:text-[#171717]',
    soft:
      'bg-[#EEE9FF] hover:bg-[#E3DCFF] text-[#7258E8]',
    white:
      'bg-white hover:bg-[#F7F7F3] text-[#171717] shadow-md border-0',
  }[variant];

  return (
    <button
      className={cn(baseStyles, sizeStyles, variantStyles, className)}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
