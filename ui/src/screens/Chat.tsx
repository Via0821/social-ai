import { useEffect, useRef, useState } from "react";
import { api, type Attachment } from "../lib/api";
import { loadHistory, saveHistory, clearHistory, type Msg } from "../lib/history";
import VoiceMode from "./VoiceMode";

/**
 * A fast path for obvious image requests — it skips an agent round-trip.
 * Only an optimisation: when it misses, the agent generates the image itself
 * and the server turns the resulting path into a rendered attachment, so the
 * outcome is the same either way.
 */
const IMAGE_INTENT =
  /(画像|イメージ|イラスト|絵|写真|図|图)\s*(を)?\s*(作|生成|描|つく|書|出)|image of|draw me|generate an image/i;

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>(loadHistory);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Attachment | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const runIdRef = useRef<string>("");

  // Persist on every change, so navigating away and back keeps the thread.
  useEffect(() => { saveHistory(messages); }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  function push(msg: Msg) {
    setMessages((m) => [...m, { ...msg, at: Date.now() }]);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && !pending) || busy) return;

    const attachment = pending;
    // The agent reads local paths, so hand it the path and keep the
    // friendly filename for display only.
    const outgoing = attachment
      ? `${trimmed || "このファイルの内容を教えて。"}\n\n[添付ファイル: ${attachment.path}]`
      : trimmed;

    push({
      role: "user",
      text: trimmed || `（${attachment?.name} を送信）`,
      attachment: attachment ? { name: attachment.name, kind: attachment.kind } : undefined,
    });
    setInput("");
    setPending(null);
    setBusy(true);
    setElapsed(0);

    // Image requests go straight to the image endpoint — routing them
    // through the agent just produces a description of a picture.
    if (!attachment && IMAGE_INTENT.test(trimmed)) {
      try {
        const url = await api.generateImage(trimmed);
        const name = url.split("/").pop() ?? "image.png";
        push({
          role: "social",
          text: "画像を作成しました。",
          files: [{
            name,
            url,
            download_url: `/api/file/${name}?download=1`,
            kind: "image",
          }],
        });
      } catch {
        push({ role: "social", text: "画像を生成できませんでした。", error: true });
      }
      setBusy(false);
      return;
    }

    const runId = crypto.randomUUID();
    runIdRef.current = runId;

    await api.sendMessage(outgoing, {
      onProgress: setElapsed,
      onMessage: (t, files) => push({ role: "social", text: t, files }),
      onError: (msg) => push({ role: "social", text: msg, error: true }),
    }, runId);

    setBusy(false);
  }

  async function stop() {
    if (!runIdRef.current) return;
    await api.stopMessage(runIdRef.current);
    setBusy(false);
    push({ role: "social", text: "（停止しました）" });
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

  if (voiceMode) return <VoiceMode onClose={() => setVoiceMode(false)} />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-slate-200 bg-white px-4 py-2 sm:px-8">
        {messages.length > 0 && (
          <button
            onClick={() => {
              if (confirm("この画面の会話履歴を消します。SOCIALの記憶は消えません。")) {
                clearHistory();
                setMessages([]);
              }
            }}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            履歴を消す
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4">
          {messages.length === 0 && !busy && (
            <div className="m-auto text-center">
              <p className="text-lg font-medium text-slate-700">こんにちは。SOCIALです。</p>
              <p className="mt-2 text-slate-500">何でも日本語で話しかけてください。</p>
            </div>
          )}

          {messages.map((m, i) => (
            <Bubble key={i} msg={m} onSpeak={() => playAloud(m.text)} />
          ))}

          {busy && (
            <div className="self-start rounded-2xl border border-slate-200 bg-white px-5 py-3 text-slate-500">
              <span className="inline-flex items-center gap-2">
                <Dots />
                考えています…
                {elapsed >= 10 && (
                  <span className="text-sm text-slate-400">（{elapsed}秒）</span>
                )}
                <button
                  onClick={() => void stop()}
                  className="ml-2 rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
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
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-center text-amber-900">
          {notice}
        </div>
      )}

      {pending && (
        <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-8">
          <span className="text-sm text-slate-600">
            添付：{pending.name}
          </span>
          <button
            onClick={() => setPending(null)}
            className="text-sm text-slate-500 hover:text-red-600"
          >
            取り消す
          </button>
        </div>
      )}

      <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-8">
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
            className="min-w-0 flex-1 resize-none rounded-xl border border-slate-300
                       px-3 py-3 text-base focus:border-sky-500 focus:outline-none
                       focus:ring-4 focus:ring-sky-100 disabled:bg-slate-50 sm:px-4"
            style={{ maxHeight: "9rem" }}
          />
          <button
            onClick={() => setVoiceMode(true)}
            disabled={busy}
            aria-label="音声で会話する"
            className="btn-ghost shrink-0 !px-3 !py-3 sm:!px-4"
          >
            🎤
          </button>
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
          <span className="mt-1 block text-sm text-sky-100">📎 {msg.attachment.name}</span>
        )}
      </div>
    );
  }
  return (
    <div
      className={`self-start max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-5 py-3 ${
        msg.error
          ? "border border-red-200 bg-red-50 text-red-800"
          : "border border-slate-200 bg-white"
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
                className="text-sm text-slate-500 hover:underline"
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
          className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}
