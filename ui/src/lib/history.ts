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

export type Msg = {
  role: "user" | "social";
  text: string;
  error?: boolean;
  imageUrl?: string;
  attachment?: { name: string; kind: string };
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
