// Cloudflare Turnstile widget (explicit rendering). Tokens are single-use, so
// remount the component (change its `key`) to get a fresh one after each use.
import { useEffect, useRef } from 'react'

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable')))
      script.onerror = () => {
        scriptPromise = null
        reject(new Error('Could not load the verification check'))
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

export function Turnstile({ siteKey, onToken, onError }: {
  siteKey: string
  onToken: (token: string | null) => void
  onError?: (message: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Callbacks change every render; the widget should only be created once.
  const callbacks = useRef({ onToken, onError })
  useEffect(() => { callbacks.current = { onToken, onError } })

  useEffect(() => {
    let widgetId: string | null = null
    let cancelled = false
    loadTurnstile()
      .then(api => {
        if (cancelled || !ref.current) return
        widgetId = api.render(ref.current, {
          sitekey: siteKey,
          theme: 'dark',
          size: 'flexible',
          callback: (token: string) => callbacks.current.onToken(token),
          'expired-callback': () => callbacks.current.onToken(null),
          'error-callback': () => {
            callbacks.current.onToken(null)
            callbacks.current.onError?.('The verification check failed to load. Please refresh and try again.')
          },
        })
      })
      .catch(e => callbacks.current.onError?.(e.message))
    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey])

  return <div ref={ref} className="min-h-[65px]" />
}
