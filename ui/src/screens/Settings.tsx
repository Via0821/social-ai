import { useEffect, useRef, useState } from "react";
import { api, type VoiceSettings } from "../lib/api";

type Status = { ok: boolean; voice: boolean; gateway: boolean; line: boolean };

export default function Settings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [voice, setVoice] = useState<VoiceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    void api.getStatus().then(setStatus);
    void api.getVoiceSettings().then(setVoice);
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, []);

  async function save(nextVoice: string, nextSpeed: number) {
    setSaving(true);
    try {
      setVoice(await api.saveVoiceSettings(nextVoice, nextSpeed));
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    try {
      const blob = await api.speak("こんにちは。SOCIALです。この声でお答えします。");
      new Audio(URL.createObjectURL(blob)).play();
    } catch {
      /* 再生できなくても設定は保存済み */
    }
  }

  return (
    <div className="h-full overflow-y-auto px-5 pb-28 pt-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold">設定</h1>
        <p className="mt-2" style={{ color: "var(--text-dim)" }}>SOCIALの状態を確認できます。</p>

        <div className="card mt-8 divide-y divide-white/10">
          <Row label="SOCIAL 本体" ok={status?.ok} okText="正常" ngText="接続できません" />
          <Row label="音声（聞き取り・読み上げ）" ok={status?.voice} okText="利用できます" ngText="未設定" />
          <Row label="LINE 連携" ok={status?.line} okText="利用できます" ngText="準備中" />
          <Row label="自動実行（定期レポート）" ok={status?.gateway} okText="動作中" ngText="停止中" />
        </div>

        <section className="card mt-6 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">音声</h2>
            {saved && <span className="text-sm text-emerald-400">保存しました</span>}
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
            SOCIALが話すときの声と速さです。すぐに反映されます。
          </p>

          {!voice ? (
            <p className="mt-4 text-sm" style={{ color: "var(--text-dim)" }}>
              読み込んでいます…
            </p>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-2">
                {voice.voices.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => void save(v.id, voice.speed)}
                    disabled={saving}
                    aria-pressed={voice.voice === v.id}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                      voice.voice === v.id
                        ? "border-sky-500 bg-sky-500/10"
                        : "border-white/10 hover:border-white/25"
                    }`}
                  >
                    <span>
                      <span className="block font-medium">{v.label}</span>
                      <span className="block text-sm" style={{ color: "var(--text-dim)" }}>
                        {v.note}
                      </span>
                    </span>
                    {voice.voice === v.id && (
                      <span className="text-sky-400" aria-hidden>●</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm">話す速さ</span>
                  <span className="text-sm" style={{ color: "var(--text-dim)" }}>
                    {voice.speed.toFixed(2)}倍
                  </span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.6}
                  step={0.05}
                  value={voice.speed}
                  onChange={(e) =>
                    setVoice({ ...voice, speed: Number(e.target.value) })
                  }
                  onPointerUp={(e) =>
                    void save(voice.voice, Number((e.target as HTMLInputElement).value))
                  }
                  className="mt-2 w-full accent-sky-500"
                  aria-label="話す速さ"
                />
                <div className="flex justify-between text-xs" style={{ color: "var(--text-dim)" }}>
                  <span>ゆっくり</span><span>標準</span><span>速い</span>
                </div>
              </div>

              <button onClick={() => void preview()} className="btn-ghost mt-5 !py-2 !text-sm">
                🔊 この声で試す
              </button>
            </>
          )}
        </section>

        <div className="card mt-6 p-6">
          <h2 className="font-semibold">困ったときは</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 ">
            <li>返答が遅いときは、調べものをしています。数分お待ちください。</li>
            <li>音声が使えないときは、ブラウザのマイク許可をご確認ください。</li>
            <li>覚えてほしいことは、会話画面で「これ覚えて」と伝えてください。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({
  label, ok, okText, ngText,
}: { label: string; ok?: boolean; okText: string; ngText: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4">
      <span>{label}</span>
      {ok === undefined ? (
        <span >確認中…</span>
      ) : (
        <span className={`inline-flex items-center gap-2 font-medium ${ok ? "text-emerald-700" : ""}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-600"}`} />
          {ok ? okText : ngText}
        </span>
      )}
    </div>
  );
}
