import { useEffect, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { InterviewApp } from './InterviewApp'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { SettingsPage } from './pages/SettingsPage'
import { LogoMark } from './components/brand/Logo'
import { useAuth } from './lib/auth'
import { navigate, useLocation } from './lib/router'

function Splash() {
  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center gap-5">
      <LogoMark className="w-11 h-11 animate-pulse-glow" />
      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const { pathname, search } = useLocation()
  useEffect(() => {
    if (!loading && !user) navigate(`/login?next=${encodeURIComponent(pathname + search)}`, { replace: true })
  }, [loading, user, pathname, search])
  if (loading || !user) return <Splash />
  return <>{children}</>
}

export default function App() {
  const { pathname } = useLocation()
  const { loading } = useAuth()

  useEffect(() => {
    const titles: Record<string, string> = {
      '/': 'tejaskrit — AI interview practice',
      '/login': 'Sign in · tejaskrit',
      '/app': 'Practice interview · tejaskrit',
      '/settings': 'Settings · tejaskrit',
    }
    document.title = titles[pathname] ?? titles['/']
  }, [pathname])

  switch (pathname) {
    case '/login':
      return loading ? <Splash /> : <LoginPage />
    case '/app':
      return <RequireAuth><InterviewApp /></RequireAuth>
    case '/settings':
      return <RequireAuth><SettingsPage /></RequireAuth>
    default:
      return <LandingPage />
  }
}
