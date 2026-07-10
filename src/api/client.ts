/**
 * Central API client — single source of truth for the backend location.
 *
 * The backend host/port lives here and nowhere else. Override at build time
 * with VITE_BACKEND_URL (see vite.config.ts, which allows VITE_-prefixed env
 * vars) — e.g. VITE_BACKEND_URL=http://127.0.0.1:9000 npm run dev.
 */

export const BACKEND: string =
  (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") ??
  "http://127.0.0.1:7842";

/** Build an absolute backend URL from a path (leading slash optional). */
export function apiUrl(path: string): string {
  return `${BACKEND}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The SSE stream URL for a job. One place owns this endpoint convention. */
export function jobStreamUrl(jobId: string): string {
  return `${BACKEND}/api/jobs/${jobId}/stream`;
}

/** GET JSON with a thrown error on non-2xx. */
export async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), init);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** POST JSON with a thrown error on non-2xx. */
export async function postJSON<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
