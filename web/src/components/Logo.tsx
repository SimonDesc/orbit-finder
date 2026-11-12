import { useId } from 'react'

/** A planet with a tilted orbit and a satellite on it. */
export function LogoMark({ className = 'size-7' }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-planet`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id={`${id}-orbit`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7dd3fc" stopOpacity="0.15" />
          <stop offset="1" stopColor="#7dd3fc" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="7.5" fill={`url(#${id}-planet)`} />
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="5.5"
        transform="rotate(-28 16 16)"
        fill="none"
        stroke={`url(#${id}-orbit)`}
        strokeWidth="1.6"
      />
      <circle cx="27.4" cy="9.6" r="2.4" fill="#fdba74" stroke="#0f172a" strokeWidth="1" />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="font-heading text-[17px] leading-none font-semibold tracking-tight">
        Orbit<span className="text-sky-300">Finder</span>
      </span>
    </span>
  )
}
