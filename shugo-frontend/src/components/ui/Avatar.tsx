import { forwardRef } from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn, getInitials } from '@/lib/utils';

const avatarVariants = cva(
  'relative flex shrink-0 overflow-hidden rounded-full',
  {
    variants: {
      size: {
        xs: 'h-6 w-6 text-xs',
        sm: 'h-8 w-8 text-xs',
        md: 'h-10 w-10 text-sm',
        lg: 'h-12 w-12 text-base',
        xl: 'h-16 w-16 text-lg',
        '2xl': 'h-20 w-20 text-xl',
      },
      ring: {
        none: '',
        gold: 'ring-2 ring-gold-400 ring-offset-2 ring-offset-marble-100',
        white: 'ring-2 ring-white ring-offset-2 ring-offset-marble-100',
      },
    },
    defaultVariants: {
      size: 'md',
      ring: 'none',
    },
  }
);

export interface AvatarProps
  extends VariantProps<typeof avatarVariants> {
  src?: string;
  alt?: string;
  name?: string;
  className?: string;
}

const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, size, ring, src, alt, name, ...props }, ref) => {
    const initials = name ? getInitials(name) : '?';

    return (
      <AvatarPrimitive.Root
        ref={ref}
        className={cn(avatarVariants({ size, ring }), className)}
        {...props}
      >
        <AvatarPrimitive.Image
          src={src}
          alt={alt || name}
          className="aspect-square h-full w-full object-cover"
        />
        <AvatarPrimitive.Fallback
          className={cn(
            'flex h-full w-full items-center justify-center',
            'bg-gradient-to-br from-gold-400 to-gold-600 text-white font-semibold'
          )}
        >
          {initials}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
    );
  }
);

Avatar.displayName = 'Avatar';

// Avatar Group for stacking avatars
interface AvatarGroupProps {
  children?: React.ReactNode;
  users?: Array<{ name: string; avatar?: string }>;
  max?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

function AvatarGroup({ children, users, max = 4, size = 'sm', className }: AvatarGroupProps) {
  // Support users prop for easier usage
  if (users && users.length > 0) {
    const visibleUsers = users.slice(0, max);
    const remainingCount = users.length - max;

    return (
      <div className={cn('flex -space-x-2', className)}>
        {visibleUsers.map((user, index) => (
          <Avatar
            key={index}
            src={user.avatar}
            name={user.name}
            size={size}
            className="ring-2 ring-white"
          />
        ))}
        {remainingCount > 0 && (
          <div
            className={cn(
              'flex items-center justify-center rounded-full',
              'bg-marble-200 text-xs font-medium text-gray-600',
              'ring-2 ring-white',
              size === 'sm' ? 'h-8 w-8' : size === 'xs' ? 'h-6 w-6' : 'h-10 w-10'
            )}
          >
            +{remainingCount}
          </div>
        )}
      </div>
    );
  }

  // Support children prop for flexibility
  const childArray = Array.isArray(children) ? children : [children];
  const visibleAvatars = childArray.slice(0, max);
  const remainingCount = childArray.length - max;

  return (
    <div className={cn('flex -space-x-3', className)}>
      {visibleAvatars}
      {remainingCount > 0 && (
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full',
            'bg-marble-200 text-sm font-medium text-gray-600',
            'ring-2 ring-white'
          )}
        >
          +{remainingCount}
        </div>
      )}
    </div>
  );
}

export { Avatar, AvatarGroup, avatarVariants };
