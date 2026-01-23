import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
};

const textSizeClasses = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-2xl',
  xl: 'text-3xl',
};

export function Logo({ size = 'md', showText = true, className }: LogoProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Shield Icon with Vatican style */}
      <div
        className={cn(
          'relative flex items-center justify-center',
          'bg-gradient-to-br from-gold-400 via-gold-500 to-gold-600',
          'rounded-xl shadow-gold',
          sizeClasses[size]
        )}
      >
        {/* Inner shield design */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-3/5 w-3/5 text-white"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 2L4 6V12C4 16.4183 7.58172 20 12 20C16.4183 20 20 16.4183 20 12V6L12 2Z"
            fill="currentColor"
            fillOpacity="0.2"
          />
          <path
            d="M12 2L4 6V12C4 16.4183 7.58172 20 12 20C16.4183 20 20 16.4183 20 12V6L12 2Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 8V14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M9 11H15"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>

        {/* Decorative corner accents */}
        <div className="absolute -top-0.5 -left-0.5 w-2 h-2 border-t-2 border-l-2 border-gold-300 rounded-tl" />
        <div className="absolute -top-0.5 -right-0.5 w-2 h-2 border-t-2 border-r-2 border-gold-300 rounded-tr" />
        <div className="absolute -bottom-0.5 -left-0.5 w-2 h-2 border-b-2 border-l-2 border-gold-300 rounded-bl" />
        <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 border-b-2 border-r-2 border-gold-300 rounded-br" />
      </div>

      {showText && (
        <div className="flex flex-col">
          <span
            className={cn(
              'font-display font-bold tracking-wider',
              'bg-gradient-to-r from-gold-600 via-gold-500 to-gold-600',
              'bg-clip-text text-transparent',
              textSizeClasses[size]
            )}
          >
            SHUGO
          </span>
          <span className="text-xs text-gray-500 tracking-widest uppercase">
            Gestion de Gardes
          </span>
        </div>
      )}
    </div>
  );
}

// Icon only version
export function LogoIcon({ size = 'md', className }: Omit<LogoProps, 'showText'>) {
  return <Logo size={size} showText={false} className={className} />;
}
