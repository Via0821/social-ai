import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { isRecordingSupported, startRecording, type Recording } from "../lib/recorder";

type Phase = "idle" | "listening" | "thinking" | "speaking";

const LABEL: Record<Phase, string> = {
  idle: "タップして話しかけてください",
  listening: "聞いています…",
  thinking: "考えています…",
  speaking: "お答えしています",
};

/**
 * Hands-free voice conversation.
 *
 * The owner expected talking to SOCIAL and being answered aloud, not
 * speaking and reading a reply. So this screen never shows the text: it
 * records, transcribes, asks, speaks the answer, and returns to listening.
 */
export default function VoiceMode({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");

  const recordingRef = useRef<Recording | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      recordingRef.current?.cancel();
      audioRef.current?.pause();
    };
  }, []);

  async function startListening() {
    setError(null);
    setCaption("");
    if (!isRecordingSupported()) {
      setError("このブラウザは音声入力に対応していません。SafariかChromeの最新版でお試しください。");
      return;
    }
    try {
      recordingRef.current = await startRecording(handleRecording);
      setPhase("listening");
    } catch (err) {
      const denied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(
        denied
          ? "マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。"
          : "マイクを使用できませんでした。",
      );
      setPhase("idle");
    }
  }

  function stopListening() {
    recordingRef.current?.stop();
    setPhase("thinking");
  }

  async function handleRecording(blob: Blob) {
    if (blob.size < 1200) {
      setPhase("idle");
      return;
    }
    try {
      const text = await api.transcribe(blob);
      if (!text.trim()) {
        setError("聞き取れませんでした。もう一度お試しください。");
        setPhase("idle");
        return;
      }
      setCaption(text);

      let answer = "";
      await api.sendMessage(text, {
        onMessage: (t) => { answer = t; },
        onError: (m) => { setError(m); },
      });
      if (cancelledRef.current) return;
      if (!answer) {
        setPhase("idle");
        return;
      }

      setPhase("speaking");
      const audio = new Audio(URL.createObjectURL(await api.speak(answer)));
      audioRef.current = audio;
      audio.onended = () => { if (!cancelledRef.current) setPhase("idle"); };
      await audio.play();
    } catch {
      setError("音声のやり取りに失敗しました。");
      setPhase("idle");
    }
  }

  function onOrbClick() {
    if (phase === "idle") void startListening();
    else if (phase === "listening") stopListening();
    else if (phase === "speaking") {
      audioRef.current?.pause();
      setPhase("idle");
    }
  }

  const active = phase === "listening";
  const busy = phase === "thinking";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900 px-6">
      <button
        onClick={onClose}
        aria-label="音声モードを終了"
        className="absolute right-5 top-5 rounded-full bg-white/10 px-4 py-2 text-white hover:bg-white/20"
      >
        ✕ 終了
      </button>

      <button
        onClick={onOrbClick}
        disabled={busy}
        aria-label={LABEL[phase]}
        className={`relative flex h-52 w-52 items-center justify-center rounded-full
          transition-all duration-300 disabled:cursor-wait
          ${active ? "bg-sky-400 scale-110" : "bg-sky-600 hover:bg-sky-500"}`}
      >
        {active && (
          <span className="absolute inset-0 animate-ping rounded-full bg-sky-400 opacity-60" />
        )}
        {busy && (
          <span className="absolute inset-0 animate-pulse rounded-full bg-sky-500 opacity-50" />
        )}
        <span className="relative text-6xl" aria-hidden>
          {phase === "speaking" ? "🔊" : "🎤"}
        </span>
      </button>

      <p className="mt-10 text-lg text-white">{LABEL[phase]}</p>

      {caption && (
        <p className="mt-4 max-w-md text-center text-sm text-slate-400">
          「{caption}」
        </p>
      )}

      {error && (
        <p className="mt-6 max-w-md rounded-xl bg-red-500/15 px-5 py-3 text-center text-red-200">
          {error}
        </p>
      )}

      <p className="mt-10 text-sm text-slate-500">
        {phase === "listening" ? "話し終えたら、もう一度タップ" : "会話は文字でも残ります"}
      </p>
    </div>
  );
}
