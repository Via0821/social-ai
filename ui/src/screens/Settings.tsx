import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Status = { ok: boolean; voice: boolean; gateway: boolean; line: boolean };

export default function Settings() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    void api.getStatus().then(setStatus);
  }, []);

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
