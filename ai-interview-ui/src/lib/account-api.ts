// Auth + account endpoints (typed wrappers around api()).
import { api } from './api'

export interface User {
  id: string
  email: string
  name: string
  created_at: string
}

export const getAuthConfig = () => api<{ turnstile_site_key: string | null }>('/auth/config')

export const requestOtp = (email: string, turnstileToken?: string | null) =>
  api<{ ok: true; expires_in_seconds: number; resend_after_seconds: number }>('/auth/request-otp', {
    method: 'POST', json: { email, turnstile_token: turnstileToken ?? undefined },
  })

export const verifyOtp = (email: string, code: string) =>
  api<{ user: User; is_new: boolean }>('/auth/verify-otp', { method: 'POST', json: { email, code } })

export const updateProfile = (name: string) =>
  api<{ user: User }>('/auth/me', { method: 'PATCH', json: { name } })

export const deleteAccount = () => api<{ ok: true }>('/account', { method: 'DELETE' })

export type ProviderId = 'anthropic' | 'openai' | 'groq' | 'gemini' | 'openrouter'

export interface ProviderInfo {
  id: ProviderId
  label: string
  key_url: string
  supports_stt: boolean
  suggested_llm: string[]
  suggested_fast: string
  suggested_stt: string[]
  connected: boolean
  key_hint: string | null
  updated_at: string | null
}

export interface AiSelection {
  eval_provider: ProviderId | null
  eval_model: string | null
  fast_provider: ProviderId | null
  fast_model: string | null
  stt_provider: ProviderId | null
  stt_model: string | null
}

export interface AiSettings {
  providers: ProviderInfo[]
  selection: AiSelection
  ready: boolean
}

export const getAiSettings = () => api<AiSettings>('/account/ai')
export const saveAiSelection = (s: AiSelection) => api<AiSettings>('/account/ai', { method: 'PUT', json: s })
export const saveProviderKey = (p: ProviderId, apiKey: string) =>
  api<AiSettings>(`/account/keys/${p}`, { method: 'PUT', json: { api_key: apiKey } })
export const removeProviderKey = (p: ProviderId) => api<AiSettings>(`/account/keys/${p}`, { method: 'DELETE' })
export const listProviderModels = (p: ProviderId) =>
  api<{ provider: ProviderId; llm: string[]; stt: string[] }>(`/account/models/${p}`)
