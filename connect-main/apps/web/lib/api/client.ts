export interface ApiErrorDetail {
  code: string;
  message: string;
  requestId?: string;
  timestamp?: string;
}

export class ApiError extends Error {
  code: string;
  statusCode: number;
  requestId?: string;

  constructor(statusCode: number, detail: ApiErrorDetail) {
    super(detail.message || 'An unexpected error occurred');
    this.name = 'ApiError';
    this.code = detail.code || 'UNKNOWN_ERROR';
    this.statusCode = statusCode;
    this.requestId = detail.requestId;
  }
}

const getApiBase = (): string => {
  if (typeof window !== 'undefined') {
    // In browser: prefer explicit NEXT_PUBLIC_API_URL if configured; otherwise use same-origin relative URLs to leverage Next.js rewrites proxy
    return process.env.NEXT_PUBLIC_API_URL || '';
  }
  return process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || (process.env.VERCEL ? 'https://connect-a2fi.onrender.com' : 'http://localhost:8080');
};

export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const base = getApiBase();
  const url = endpoint.startsWith('http') ? endpoint : `${base}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Mandatory for __Host-tc_session and tc_session cookies
  });

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    let errorDetail: ApiErrorDetail = {
      code: `HTTP_${res.status}`,
      message: res.statusText || 'Request failed',
    };

    if (isJson) {
      try {
        const body = await res.json();
        if (body.error) {
          errorDetail = body.error;
        }
      } catch {
        // Fallback to generic message
      }
    }

    throw new ApiError(res.status, errorDetail);
  }

  if (isJson) {
    return (await res.json()) as T;
  }

  return {} as T;
}
