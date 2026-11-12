import { Popover } from '@base-ui/react/popover'
import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * A "?" that explains on hover or tap: the details you read once, out of the way the rest of
 * the time.
 */
export function Hint({
  children,
  label = 'More info',
  className,
}: {
  children: ReactNode
  label?: string
  className?: string
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        aria-label={label}
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          className,
        )}
      >
        <CircleHelp className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} collisionPadding={8} className="z-50">
          <Popover.Popup className="max-w-72 rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-xl outline-none [&_a]:text-sky-300 [&_a]:hover:underline [&_p+p]:mt-1.5">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
