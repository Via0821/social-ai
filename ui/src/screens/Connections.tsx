import { useEffect, useState } from "react";

type Item = {
  id: string; name: string; label: string; connected: boolean; detail: string;
};

export default function Connections() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    fetch("/api/connections")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, []);

  return (
    <div className="h-full overflow-y-auto px-5 pb-28 pt-6">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          SOCIALが連携している外部サービスの一覧です。
        </p>

        {items === null ? (
          <p className="mt-8 text-sm" style={{ color: "var(--text-dim)" }}>
            読み込んでいます…
          </p>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {items.map((it) => (
              <li key={it.id} className="card flex items-start gap-4 px-5 py-4">
                <span
                  aria-hidden
                  className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${
                    it.connected ? "bg-emerald-400" : "bg-slate-600"
                  }`}
                  style={
                    it.connected
                      ? { boxShadow: "0 0 10px rgba(52,211,153,.8)" }
                      : undefined
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{it.name}</span>
                  <span className="mt-0.5 block text-sm" style={{ color: "var(--text-dim)" }}>
                    {it.label}
                  </span>
                  <span className="mt-1 block text-sm" style={{ color: "var(--text-dim)" }}>
                    {it.detail}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-sm font-medium ${
                    it.connected ? "text-emerald-400" : ""
                  }`}
                  style={it.connected ? undefined : { color: "var(--text-dim)" }}
                >
                  {it.connected ? "接続済み" : "未接続"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-8 rounded-2xl bg-white/5 p-4 text-sm"
           style={{ color: "var(--text-dim)" }}>
          連携を追加したい場合はお知らせください。ここに項目が増えていきます。
        </p>
      </div>
    </div>
  );
}
