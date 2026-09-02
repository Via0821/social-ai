import { useEffect, useRef, useState } from "react";
import Orb, { type OrbState } from "../components/Orb";
import { api } from "../lib/api";
import { isRecordingSupported, pickMimeType } from "../lib/recorder";
import { startVoiceLoop, type VoiceLoop } from "../lib/voiceLoop";
import * as chat from "../lib/chatStore";
import { useChat } from "../lib/useChat";

const LABEL: Record<OrbState, string> = {
  idle: "タップして会話をはじめる",
  listening: "どうぞ、お話しください",
  thinking: "考えています…",
  speaking: "お答えしています",
};

export default function Talk() {
  const [state, setState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { messages } = useChat();
  const [showChat, setShowChat] = useState(true);

  const loopRef = useRef<VoiceLoop | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const liveRef = useRef(false);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => teardown(), []);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, state]);

  function teardown() {
    liveRef.current = false;
    loopRef.current?.stop();
    loopRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
  }

  async function begin() {
    setError(null);
    if (!isRecordingSupported()) {
      setError("このブラウザは音声入力に対応していません。SafariかChromeの最新版でお試しください。");
      return;
    }
    try {
      liveRef.current = true;
      loopRef.current = await startVoiceLoop(
        { onLevel: setLevel, onSpeechEnd: handleTurn, onError: setError },
        pickMimeType,
      );
      setState("listening");
    } catch (err) {
      liveRef.current = false;
      const denied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(
        denied
          ? "マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。"
          : "マイクを使用できませんでした。",
      );
      setState("idle");
    }
  }

  function end() {
    teardown();
    setState("idle");
    setLevel(0);
  }

  async function handleTurn(audio: Blob) {
    if (!liveRef.current) return;
    // Stop capturing while we answer, or SOCIAL hears its own voice.
    loopRef.current?.pause();
    setState("thinking");

    try {
      const said = await api.transcribe(audio);
      if (!said.trim()) {
        await resumeListening();
        return;
      }
      chat.append({ role: "user", text: said });

      // Voice turns never take the image fast-path — the owner asked a
      // question aloud and expects an answer aloud.
      const before = chat.getMessages().length;
      await chat.send(said, { noImageIntent: true });
      const produced = chat.getMessages().slice(before);
      const answer = produced.filter((m) => m.role === "social" && !m.error)
                             .map((m) => m.text).join("\n");
      if (!liveRef.current) return;
      if (!answer) {
        await resumeListening();
        return;
      }

      setState("speaking");
      const audioEl = new Audio(URL.createObjectURL(await api.speak(answer)));
      audioRef.current = audioEl;
      // Reopen the mic the moment SOCIAL stops talking — that hand-back is
      // what makes it a conversation rather than a sequence of commands.
      audioEl.onended = () => void resumeListening();
      audioEl.onerror = () => void resumeListening();
      await audioEl.play();
    } catch {
      setError("音声のやり取りに失敗しました。");
      await resumeListening();
    }
  }

  async function resumeListening() {
    if (!liveRef.current) return;
    setState("listening");
    await loopRef.current?.resume();
  }

  const live = state !== "idle";

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col items-center justify-center px-6 pt-2">
        <button
          onClick={() => (live ? end() : void begin())}
          aria-label={live ? "会話を終了" : "会話をはじめる"}
          className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          <Orb state={state} level={level} size={290} />
        </button>

        <p className="mt-4 text-lg">{LABEL[state]}</p>

        {live ? (
          <button onClick={end} className="btn-ghost mt-4 !py-2 !text-sm">
            会話を終了
          </button>
        ) : (
          <p className="mt-2 text-sm" style={{ color: "var(--text-dim)" }}>
            話し終わりは自動で判定します。ボタン操作は不要です。
          </p>
        )}

        {error && (
          <p className="mt-5 max-w-sm rounded-2xl bg-red-500/10 px-5 py-3 text-center text-sm text-red-300">
            {error}
          </p>
        )}
      </div>

      <div className="mt-5 flex shrink-0 items-center justify-between px-5">
        <span className="text-sm" style={{ color: "var(--text-dim)" }}>会話ログ</span>
        <button
          onClick={() => setShowChat((v) => !v)}
          className="text-sm"
          style={{ color: "var(--text-dim)" }}
        >
          {showChat ? "隠す ▾" : "表示 ▴"}
        </button>
      </div>

      {showChat && (
        <div ref={feedRef} className="mt-2 min-h-0 flex-1 overflow-y-auto px-5 pb-24">
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {messages.length === 0 && (
              <p className="py-8 text-center text-sm" style={{ color: "var(--text-dim)" }}>
                まだ会話がありません。
              </p>
            )}
            {messages.slice(-40).map((m, i) => (
              <div
                key={i}
                className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] ${
                  m.role === "user"
                    ? "self-end bg-[var(--accent)] text-white"
                    : m.error
                      ? "card self-start text-red-300"
                      : "card self-start"
                }`}
              >
                {m.text}
              </div>
            ))}
            {state === "thinking" && (
              <div className="card self-start px-4 py-2.5 text-sm"
                   style={{ color: "var(--text-dim)" }}>
                考えています…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
