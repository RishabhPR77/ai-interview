import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LogOut, Settings, Video } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { useAuth } from '@/lib/auth'
import { Link, navigate, useLocation } from '@/lib/router'

export function UserMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!user) return null
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase()

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 text-primary text-sm font-semibold flex items-center justify-center hover:bg-primary/30 transition"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 rounded-xl border border-border bg-popover shadow-2xl p-1.5 z-50 animate-fade-in">
          <div className="px-3 py-2.5 border-b border-border mb-1">
            <div className="text-sm font-medium truncate">{user.name || 'Your account'}</div>
            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
          </div>
          <MenuItem icon={Video} label="Practice interview" onClick={() => { setOpen(false); navigate('/app') }} />
          <MenuItem icon={Settings} label="Settings & API keys" onClick={() => { setOpen(false); navigate('/settings') }} />
          <MenuItem
            icon={LogOut}
            label="Sign out"
            onClick={async () => { setOpen(false); await logout(); navigate('/') }}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick }: { icon: typeof Video; label: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition text-left"
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  )
}

const NAV = [
  { href: '/app', label: 'Practice' },
  { href: '/settings', label: 'Settings' },
]

export function AppHeader({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-xl border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        <Logo size="sm" />
        <nav className="hidden sm:flex items-center gap-1 ml-2">
          {NAV.map(n => (
            <Link
              key={n.href}
              href={n.href}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                pathname === n.href ? 'text-foreground bg-secondary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1 flex justify-center min-w-0">{children}</div>
        <UserMenu />
      </div>
    </header>
  )
}
