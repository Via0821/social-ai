import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Brief() {
  const [text, setText] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.getBrief().then((b) => {
      setText(b.text);
      setDate(b.date);
    });
  }, []);

  async function run() {
    setRunning(true);
    setElapsed(0);
    setError(null);
    await api.runBrief({
      onProgress: setElapsed,
      onMessage: (t) => {
        setText(t);
        setDate(new Date().toISOString().slice(0, 10));
      },
      onError: setError,
    });
    setRunning(false);
  }

  return (
    <div className="h-full overflow-y-auto px-5 pb-28 pt-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">デイリーブリーフ</h1>
            <p className="mt-2" style={{ color: "var(--text-dim)" }}>
              市場・ニュース・AI・採用市場のまとめです。
            </p>
          </div>
          <button onClick={() => void run()} disabled={running} className="btn-primary">
            {running ? "作成中…" : "今すぐ作成"}
          </button>
        </div>

        {running && (
          <div className="card mt-6 p-5 ">
            最新情報を調べています… （{elapsed}秒）
            <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
              6項目を調査するため、数分かかります。この画面は開いたままで大丈夫です。
            </p>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
            {error}
          </div>
        )}

        {text ? (
          <article className="card mt-6 p-6">
            {date && (
              <p className="mb-4 text-sm" style={{ color: "var(--text-dim)" }}>最終更新: {date}</p>
            )}
            <pre className="whitespace-pre-wrap break-words font-sans text-base leading-8">
              {text}
            </pre>
          </article>
        ) : (
          !running && (
            <div className="card mt-6 p-8 text-center ">
              まだブリーフがありません。「今すぐ作成」を押してください。
            </div>
          )
        )}
      </div>
    </div>
  );
}
