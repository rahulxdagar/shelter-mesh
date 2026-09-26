// localStorage for per-device conveniences only (language, demo role, last map snapshot).
// Every access is guarded: storage can be unavailable in private windows or blocked.
const PREFIX = 'coldgrid:';

export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
