export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type GetToken = () => Promise<string>;

export async function request<T>(getToken: GetToken | null, method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (getToken) headers.Authorization = `Bearer ${await getToken()}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}
