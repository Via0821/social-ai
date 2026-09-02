/**
 * The conversation, kept outside React.
 *
 * It used to live in each screen's `useState`. Sending a message and then
 * switching tabs unmounted the screen mid-turn, so when the reply finally
 * arrived `setState` landed on a dead component: the answer was discarded and
 * never persisted. The owner saw it as "history is not reflected" — the reply
 * had genuinely been thrown away, not merely hidden.
 *
 * Holding the messages and the in-flight run at module scope means a turn
 * completes and is saved regardless of which screen — or no screen — is
 * mounted.
 */

import { api, type ReplyFile } from "./api";
import { loadHistory, saveHistory, clearHistory, type Msg } from "./history";

type Listener = () => void;

let messages: Msg[] = loadHistory();
let busy = false;
let elapsed = 0;
let runId = "";
const listeners = new Set<Listener>();

// useSyncExternalStore compares by reference, so every mutation must produce
// a new array or subscribers will not re-render.
function commit(next: Msg[]) {
  messages = next;
  saveHistory(messages);
  emit();
}

function emit() {
  for (const fn of listeners) fn();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getMessages = (): Msg[] => messages;
export const isBusy = (): boolean => busy;
export const getElapsed = (): number => elapsed;

export function append(msg: Msg): void {
  commit([...messages, { ...msg, at: msg.at ?? Date.now() }]);
}

export function replaceAll(next: Msg[]): void {
  commit(next);
}

export function clearAll(): void {
  clearHistory();
  messages = [];
  emit();
}

/** Phrases that mean "draw me something" rather than "answer me something". */
const IMAGE_INTENT =
  /(画像|イメージ|イラスト|絵|写真|図|图)\s*(を)?\s*(作|生成|描|つく|書|出)|image of|draw me|generate an image/i;

export type SendOptions = {
  /** Raw text sent to SOCIAL — may carry an attachment path the bubble hides. */
  outgoing?: string;
  /** Skip the image fast-path (voice turns should never trigger it). */
  noImageIntent?: boolean;
};

/**
 * Run one turn. Safe to leave: the promise keeps going after the caller
 * unmounts, and results land in the store either way.
 */
export async function send(text: string, opts: SendOptions = {}): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || busy) return;

  busy = true;
  elapsed = 0;
  emit();

  try {
    if (!opts.noImageIntent && !opts.outgoing && IMAGE_INTENT.test(trimmed)) {
      try {
        const url = await api.generateImage(trimmed);
        const name = url.split("/").pop() ?? "image.png";
        append({
          role: "social",
          text: "画像を作成しました。",
          files: [{ name, url, download_url: `/api/file/${name}?download=1`, kind: "image" }],
        });
      } catch {
        append({ role: "social", text: "画像を生成できませんでした。", error: true });
      }
      return;
    }

    runId = crypto.randomUUID();
    await api.sendMessage(opts.outgoing ?? trimmed, {
      onProgress: (s) => { elapsed = s; emit(); },
      onMessage: (t: string, files?: ReplyFile[]) =>
        append({ role: "social", text: t, files }),
      onError: (m: string) => append({ role: "social", text: m, error: true }),
    }, runId);
  } finally {
    busy = false;
    runId = "";
    emit();
  }
}

export async function stop(): Promise<void> {
  if (!runId) return;
  await api.stopMessage(runId);
  append({ role: "social", text: "（停止しました）" });
  busy = false;
  runId = "";
  emit();
}
