import { Link } from '@/lib/router'

export function LogoMark({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <div className={`${className} relative rounded-xl bg-gradient-to-br from-primary to-[#1c8fa8] flex items-center justify-center shadow-[0_6px_24px_-6px_color-mix(in_oklab,var(--primary)_70%,transparent)]`}>
      <svg viewBox="0 0 24 24" className="w-[55%] h-[55%]" fill="none" aria-hidden>
        <path d="M5 7h14M12 7v11" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="18" cy="16.5" r="2" fill="white" fillOpacity=".85" />
      </svg>
    </div>
  )
}

export function Logo({ href = '/', size = 'md' }: { href?: string; size?: 'sm' | 'md' }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 group" aria-label="tejaskrit home">
      <LogoMark className={size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'} />
      <span className={`font-serif leading-none tracking-tight ${size === 'sm' ? 'text-base' : 'text-lg'}`}>
        tejaskrit
      </span>
    </Link>
  )
}
