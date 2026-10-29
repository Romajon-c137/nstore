const configuredBase = (process.env.NEXT_PUBLIC_DJANGO_API_URL ?? '').trim()
const API_BASE = configuredBase.replace(/\/$/, '')

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    const absolute = new URL(path)
    // DRF pagination can return an absolute URL for the proxied backend.
    // Keep browser requests same-origin unless an explicit API base was configured.
    if (!API_BASE) return `${absolute.pathname}${absolute.search}`
    return path
  }
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${normalized}`
}

function messageFrom(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: unknown }).error
  if (!error || typeof error !== 'object') return fallback
  const details = (error as { details?: unknown }).details
  if (typeof details === 'string') return details
  if (details && typeof details === 'object') {
    const first = Object.values(details).flat().find(value => typeof value === 'string')
    if (typeof first === 'string') return first
  }
  return fallback
}

export class DjangoApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly payload: unknown) {
    super(message)
    this.name = 'DjangoApiError'
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const type = response.headers.get('content-type') ?? ''
  return type.includes('application/json') ? response.json() : response.text()
}

export async function djangoApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...init.headers },
  })
  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new DjangoApiError(response.status, messageFrom(payload, `Ошибка API (${response.status})`), payload)
  }
  return payload as T
}

let csrfToken: Promise<string> | null = null

export async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    csrfToken = djangoApi<{ csrf_token: string }>('/api/v1/auth/csrf/')
      .then(response => response.csrf_token)
      .catch(error => {
        csrfToken = null
        throw error
      })
  }
  return csrfToken
}

export async function djangoJson<T>(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown, headers: HeadersInit = {}): Promise<T> {
  const token = await getCsrfToken()
  return djangoApi<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token, ...headers },
  })
}

