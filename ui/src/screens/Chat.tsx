import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type Msg = {
  role: "user" | "social";
  text: string;
  error?: boolean;
};

/** Shown on an empty chat so the owner can see what SOCIAL is good at
 *  without having to guess. Tapping one sends it. */
const SUGGESTIONS = [
  "今日のAI業界の重要ニュースを教えて",
  "主要な株価市場の動きをまとめて",
  "これ覚えて。毎週月曜に週次レビューをします。",
];

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setBusy(true);
    setElapsed(0);

    await api.sendMessage(trimmed, {
      onProgress: setElapsed,
      onMessage: (t) =>
        setMessages((m) => [...m, { role: "social", text: t }]),
      onError: (msg) =>
        setMessages((m) => [...m, { role: "social", text: msg, error: true }]),
    });

    setBusy(false);
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) return;
        setNotice("音声を認識しています…");
        try {
          const text = await api.transcribe(blob);
          setNotice(null);
          if (text.trim()) await send(text);
          else setNotice("聞き取れませんでした。もう一度お試しください。");
        } catch {
          setNotice("音声を認識できませんでした。");
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setNotice(null);
    } catch {
      setNotice("マイクを使用できません。ブラウザの許可をご確認ください。");
    }
  }

  async function playAloud(text: string) {
    try {
      const blob = await api.speak(text);
      new Audio(URL.createObjectURL(blob)).play();
    } catch {
      setNotice("音声を再生できませんでした。");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4">
          {messages.length === 0 && !busy && (
            <div className="m-auto w-full max-w-lg text-center">
              <p className="text-lg font-medium text-slate-700">
                こんにちは。SOCIALです。
              </p>
              <p className="mt-2 text-slate-500">
                何でも日本語で話しかけてください。
              </p>
              <div className="mt-6 flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="card px-5 py-3 text-left text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <Bubble key={i} msg={m} onSpeak={() => playAloud(m.text)} />
          ))}

          {busy && (
            <div className="self-start rounded-2xl bg-white border border-slate-200 px-5 py-3 text-slate-500">
              <span className="inline-flex items-center gap-2">
                <Dots />
                考えています…
                {elapsed >= 10 && (
                  <span className="text-sm text-slate-400">
                    （{elapsed}秒。調べものは数分かかることがあります）
                  </span>
                )}
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

      <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-3xl items-end gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter makes a new line. IME composition
              // must not be interrupted or Japanese input breaks.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="メッセージを入力…"
            disabled={busy}
            className="flex-1 resize-none rounded-xl border border-slate-300 px-4 py-3
                       text-base focus:border-sky-500 focus:outline-none
                       focus:ring-4 focus:ring-sky-100 disabled:bg-slate-50"
            style={{ maxHeight: "9rem" }}
          />
          <button
            onClick={() => void toggleRecording()}
            disabled={busy}
            aria-label={recording ? "録音を停止" : "音声で話す"}
            className={recording ? "btn bg-red-600 text-white hover:bg-red-700" : "btn-ghost"}
          >
            {recording ? "■ 停止" : "🎤 音声"}
          </button>
          <button
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            className="btn-primary"
          >
            送信
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ msg, onSpeak }: { msg: Msg; onSpeak: () => void }) {
  if (msg.role === "user") {
    return (
      <div className="self-end max-w-[85%] rounded-2xl bg-sky-600 px-5 py-3 text-white whitespace-pre-wrap break-words">
        {msg.text}
      </div>
    );
  }
  return (
    <div
      className={`self-start max-w-[85%] rounded-2xl px-5 py-3 whitespace-pre-wrap break-words ${
        msg.error
          ? "bg-red-50 border border-red-200 text-red-800"
          : "bg-white border border-slate-200"
      }`}
    >
      {msg.text}
      {!msg.error && (
        <button
          onClick={onSpeak}
          className="mt-2 block text-sm text-sky-700 hover:underline"
        >
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
