import { useEffect, useRef, useState } from "react";
import { api, type Attachment } from "../lib/api";
import { type Msg } from "../lib/history";
import * as chat from "../lib/chatStore";
import { useChat } from "../lib/useChat";

export default function Chat() {
  const { messages, busy, elapsed } = useChat();
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Attachment | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && !pending) || busy) return;

    const attachment = pending;
    // The agent reads local paths, so hand it the path and keep the
    // friendly filename for display only.
    const outgoing = attachment
      ? `${trimmed || "このファイルの内容を教えて。"}\n\n[添付ファイル: ${attachment.path}]`
      : undefined;

    chat.append({
      role: "user",
      text: trimmed || `（${attachment?.name} を送信）`,
      attachment: attachment
        ? {
            name: attachment.name,
            kind: attachment.kind,
            // Uploads are served back by filename, so the owner can reopen
            // what they sent from anywhere in the transcript.
            url: `/api/file/${attachment.path.split("/").pop()}`,
          }
        : undefined,
    });
    setInput("");
    setPending(null);

    // Not awaited on purpose: the turn belongs to the store, so leaving this
    // screen mid-answer no longer throws the reply away.
    void chat.send(trimmed || "このファイルの内容を教えて。", { outgoing });
  }

  async function stop() {
    await chat.stop();
  }

  async function pickFile(file: File) {
    setNotice("ファイルを送信しています…");
    try {
      setPending(await api.upload(file));
      setNotice(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "ファイルを送信できませんでした。");
    }
  }

  async function playAloud(text: string) {
    try {
      new Audio(URL.createObjectURL(await api.speak(text))).play();
    } catch {
      setNotice("音声を再生できませんでした。");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-2 px-4 py-1 sm:px-8">
        {messages.length > 0 && (
          <button
            onClick={() => {
              if (confirm("この画面の会話履歴を消します。SOCIALの記憶は消えません。")) {
                chat.clearAll();
              }
            }}
            className="text-sm" style={{ color: "var(--text-dim)" }}
          >
            履歴を消す
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4">
          {messages.length === 0 && !busy && (
            <div className="m-auto text-center">
              <p className="text-lg font-medium">
                こんにちは。<span style={{ color: "var(--accent-soft)" }}>SOCIAL</span>です。
              </p>
              <p className="mt-2" style={{ color: "var(--text-dim)" }}>
                何でも日本語で話しかけてください。
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <Bubble key={i} msg={m} onSpeak={() => playAloud(m.text)} />
          ))}

          {busy && (
            <div className="card self-start px-5 py-3" style={{ color: "var(--text-dim)" }}>
              <span className="inline-flex items-center gap-2">
                <Dots />
                考えています…
                {elapsed >= 10 && (
                  <span className="text-sm text-slate-400">（{elapsed}秒）</span>
                )}
                <button
                  onClick={() => void stop()}
                  className="btn-ghost ml-2 !rounded-lg !px-3 !py-1 !text-sm"
                >
                  ■ 停止
                </button>
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {notice && (
        <div className="px-4 py-3 text-center text-sm text-amber-300"
             style={{ background: "rgba(245,158,11,.1)" }}>
          {notice}
        </div>
      )}

      {pending && (
        <div className="flex items-center gap-3 px-4 py-3 sm:px-8"
             style={{ borderTop: "1px solid var(--line)" }}>
          <span className="text-sm" style={{ color: "var(--text-dim)" }}>
            添付：{pending.name}
          </span>
          <button
            onClick={() => setPending(null)}
            className="text-sm text-red-400 hover:text-red-300"
          >
            取り消す
          </button>
        </div>
      )}

      <div className="px-4 py-3 sm:px-8" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="mx-auto flex max-w-3xl items-end gap-1.5 sm:gap-2">
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/*,audio/*,.pdf,.txt,.csv,.docx,.xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickFile(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label="ファイルを添付"
            className="btn-ghost shrink-0 !px-3 !py-3 sm:!px-4"
          >
            ＋
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="メッセージを入力…"
            disabled={busy}
            className="field min-w-0 flex-1 resize-none px-4 py-3 text-base
                       disabled:opacity-50"
            style={{ maxHeight: "9rem" }}
          />
          <button
            onClick={() => void send(input)}
            disabled={busy || (!input.trim() && !pending)}
            aria-label="送信"
            className="btn-primary shrink-0 !px-3 !py-3 sm:!px-5"
          >
            <span className="hidden sm:inline">送信</span>
            <span className="sm:hidden" aria-hidden>➤</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ msg, onSpeak }: { msg: Msg; onSpeak: () => void }) {
  if (msg.role === "user") {
    return (
      <div className="self-end max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-sky-600 px-5 py-3 text-white">
        {msg.text}
        {msg.attachment && (
          msg.attachment.url ? (
            <a
              href={msg.attachment.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-sm text-sky-100 underline underline-offset-2"
            >
              📎 {msg.attachment.name}
            </a>
          ) : (
            <span className="mt-1 block text-sm text-sky-100">
              📎 {msg.attachment.name}
            </span>
          )
        )}
      </div>
    );
  }
  return (
    <div
      className={`self-start max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-5 py-3 ${
        msg.error
          ? "border border-red-500/30 bg-red-500/10 text-red-300"
          : "card"
      }`}
    >
      {msg.text}

      {msg.files?.map((f) =>
        f.kind === "image" ? (
          <figure key={f.name} className="mt-3">
            <img
              src={f.url}
              alt="SOCIALが生成した画像"
              className="max-w-full rounded-xl border border-slate-200"
            />
            <figcaption className="mt-2 flex gap-3">
              <a
                href={f.download_url}
                download={f.name}
                className="text-sm text-sky-700 hover:underline"
              >
                ⬇ 画像を保存
              </a>
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm hover:underline" style={{ color: "var(--text-dim)" }}
              >
                別タブで開く
              </a>
            </figcaption>
          </figure>
        ) : f.kind === "audio" ? (
          <audio key={f.name} controls src={f.url} className="mt-3 w-full" />
        ) : (
          <a
            key={f.name}
            href={f.download_url}
            download={f.name}
            className="mt-3 block text-sm text-sky-700 hover:underline"
          >
            ⬇ {f.name}
          </a>
        ),
      )}

      {!msg.error && !msg.files?.length && (
        <button onClick={onSpeak} className="mt-2 block text-sm text-sky-700 hover:underline">
          🔊 読み上げる
        </button>
      )}
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1">
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="h-2 w-2 animate-bounce rounded-full bg-sky-400"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}
