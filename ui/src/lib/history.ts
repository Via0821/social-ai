/**
 * Chat history that survives navigation and reload.
 *
 * The owner reported losing the whole conversation by switching tabs and
 * coming back — the transcript lived in component state, so unmounting the
 * chat screen threw it away even though SOCIAL still remembered everything
 * server-side. Visible history matters as much as the model's memory.
 *
 * Kept in localStorage: it is per-device, needs no backend, and survives a
 * reload. Every access is guarded — private windows and cleared site data
 * make these throw rather than return empty.
 */

export type ReplyFile = {
  name: string;
  url: string;
  download_url: string;
  kind: "image" | "audio" | "file";
};

export type Msg = {
  role: "user" | "social";
  text: string;
  error?: boolean;
  /** Files SOCIAL produced with this reply — rendered inline, downloadable. */
  files?: ReplyFile[];
  /** What the owner sent up. Carries a URL so it stays openable later. */
  attachment?: { name: string; kind: string; url?: string };
  at?: number;
};

const KEY = "social.chat.v1";
const MAX_MESSAGES = 300;

export function loadHistory(): Msg[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

/**
 * True when a message predates timestamping.
 *
 * Such messages must NOT be treated as "now". Doing so — `new Date(m.at ??
 * Date.now())` — dated them at render time, so every old conversation
 * collapsed into today and the day grouping looked broken. Their real time is
 * unknown and unrecoverable, so they are grouped separately and labelled
 * honestly rather than given an invented date.
 */
export function isUndated(m: Msg): boolean {
  return typeof m.at !== "number" || !Number.isFinite(m.at) || m.at <= 0;
}

/** Local calendar day key. The boundary is the viewer's own midnight. */
export function dayKey(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function saveHistory(messages: Msg[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    // Quota exceeded or storage unavailable — the conversation still works,
    // it just will not survive a reload. Not worth interrupting the owner.
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
