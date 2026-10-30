// Thin fetch wrapper shared by every API call.
// - Same-origin by default (/api/v1, proxied by vite in dev, served by FastAPI in prod)
// - Sends the httpOnly session cookie and the CSRF header the backend requires
// - Normalises FastAPI error shapes into ApiError
export const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1'

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const AUTH_EXPIRED_EVENT = 'tk:auth-expired'

interface ErrorBody {
  detail?: string | { message?: string; code?: string } | Array<{ loc?: (string | number)[]; msg?: string }>
  code?: string
}

function messageFrom(body: ErrorBody | null, status: number): { message: string; code?: string } {
  const detail = body?.detail
  if (typeof detail === 'string') return { message: detail, code: body?.code }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    return { message: detail.message ?? `Request failed (${status})`, code: detail.code }
  }
  if (Array.isArray(detail) && detail.length) {
    // Pydantic validation errors
    const first = detail[0]
    const field = Array.isArray(first?.loc) ? first.loc[first.loc.length - 1] : ''
    const msg = String(first?.msg ?? 'Invalid input').replace(/^Value error, /, '')
    return { message: field && field !== 'body' ? `${field}: ${msg}` : msg }
  }
  return { message: `Request failed (${status})` }
}

/** POST a form and report upload progress (0–1), which fetch can't do. */
export function uploadForm<T>(path: string, body: FormData, onProgress: (share: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}${path}`)
    xhr.withCredentials = true
    xhr.responseType = 'json'
    xhr.setRequestHeader('X-Requested-With', 'tejaskrit')
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.upload.onload = () => onProgress(1)
    xhr.onerror = () => reject(new ApiError('Network error — check your connection and try again.', 0))
    xhr.onload = () => {
      if (xhr.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
      if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response as T)
      const { message, code } = messageFrom(xhr.response, xhr.status)
      reject(new ApiError(message, xhr.status, code))
    }
    xhr.send(body)
  })
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const h = new Headers(headers)
  h.set('X-Requested-With', 'tejaskrit')
  let body = rest.body
  if (json !== undefined) {
    h.set('Content-Type', 'application/json')
    body = JSON.stringify(json)
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { ...rest, body, headers: h, credentials: 'include' })
  } catch {
    throw new ApiError('Network error — check your connection and try again.', 0)
  }

  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const { message, code } = messageFrom(data, res.status)
    throw new ApiError(message, res.status, code)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
