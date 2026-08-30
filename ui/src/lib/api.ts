/** Thin client for the SOCIAL UI adapter. Same origin in dev and production. */

import { extensionFor } from "./recorder";

/** One remembered entry. Hermes keeps two stores; `label` says which. */
export type MemoryItem = {
  id: string;
  store: "memory" | "user";
  label: string;
  text: string;
};

/** A file SOCIAL produced or the owner uploaded, served back over HTTP. */
export type ReplyFile = {
  name: string;
  url: string;
  download_url: string;
  kind: "image" | "audio" | "file";
};

export type StreamHandlers = {
  onProgress?: (elapsedSeconds: number) => void;
  onMessage: (text: string, files?: ReplyFile[]) => void;
  onError: (message: string) => void;
};

/**
 * Read a Server-Sent Events stream from `path`.
 *
 * Turns can legitimately run for minutes when SOCIAL uses tools, so the
 * server emits periodic `progress` events and the caller shows elapsed time
 * rather than assuming the request has hung.
 */
async function streamSSE(
  path: string,
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });

  if (!res.ok || !res.body) {
    handlers.onError("サーバーに接続できませんでした。");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
      }
      if (!dataLines.length) continue;

      let payload: any;
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }

      if (event === "progress") handlers.onProgress?.(payload.elapsed ?? 0);
      else if (event === "message")
        handlers.onMessage(payload.text ?? "", payload.attachments ?? []);
      else if (event === "error") handlers.onError(payload.message ?? "エラーが発生しました。");
    }
  }
}

export type Attachment = {
  path: string;
  name: string;
  kind: "image" | "audio" | "file";
  size: number;
};

export const api = {
  sendMessage: (
    message: string,
    h: StreamHandlers,
    runId?: string,
    signal?: AbortSignal,
  ) => streamSSE("/api/chat", { message, run_id: runId }, h, signal),

  /** Kill a turn server-side. Closing the stream alone leaves Hermes running. */
  async stopMessage(runId: string): Promise<void> {
    await fetch("/api/chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId }),
    }).catch(() => {});
  },

  async upload(file: File): Promise<Attachment> {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    if (!r.ok) {
      throw new Error(
        r.status === 413 ? "ファイルが大きすぎます（上限25MB）"
                         : "ファイルを送信できませんでした。",
      );
    }
    return r.json();
  },

  async generateImage(prompt: string): Promise<string> {
    const r = await fetch("/api/image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!r.ok) throw new Error("画像を生成できませんでした。");
    return (await r.json()).url;
  },

  runBrief: (h: StreamHandlers, signal?: AbortSignal) =>
    streamSSE("/api/brief/run", {}, h, signal),

  async getMemory(): Promise<MemoryItem[]> {
    const r = await fetch("/api/memory");
    if (!r.ok) return [];
    return (await r.json()).items ?? [];
  },

  async deleteMemory(id: string): Promise<boolean> {
    const r = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return r.ok;
  },

  async getBrief(): Promise<{ text: string | null; date: string | null }> {
    const r = await fetch("/api/brief");
    if (!r.ok) return { text: null, date: null };
    return r.json();
  },

  async transcribe(blob: Blob): Promise<string> {
    const fd = new FormData();
    // Name it after what the browser actually recorded — Safari produces
    // audio/mp4, and sending it as .webm makes the API reject the bytes.
    fd.append("file", blob, `voice.${extensionFor(blob)}`);
    const r = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
    if (!r.ok) throw new Error("音声を認識できませんでした。");
    return (await r.json()).text ?? "";
  },

  async speak(text: string): Promise<Blob> {
    const r = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error("音声を生成できませんでした。");
    return r.blob();
  },

  async getStatus(): Promise<{
    ok: boolean; voice: boolean; gateway: boolean; line: boolean;
  }> {
    const r = await fetch("/api/status");
    if (!r.ok) return { ok: false, voice: false, gateway: false, line: false };
    return r.json();
  },
};
