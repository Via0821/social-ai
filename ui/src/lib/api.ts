/** Thin client for the SOCIAL UI adapter. Same origin in dev and production. */

/** One remembered entry. Hermes keeps two stores; `label` says which. */
export type MemoryItem = {
  id: string;
  store: "memory" | "user";
  label: string;
  text: string;
};

export type StreamHandlers = {
  onProgress?: (elapsedSeconds: number) => void;
  onMessage: (text: string) => void;
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
      else if (event === "message") handlers.onMessage(payload.text ?? "");
      else if (event === "error") handlers.onError(payload.message ?? "エラーが発生しました。");
    }
  }
}

export const api = {
  sendMessage: (message: string, h: StreamHandlers, signal?: AbortSignal) =>
    streamSSE("/api/chat", { message }, h, signal),

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
    fd.append("file", blob, "voice.webm");
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
