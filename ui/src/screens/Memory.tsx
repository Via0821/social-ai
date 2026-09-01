import { useEffect, useState } from "react";
import { api, type MemoryItem } from "../lib/api";

/**
 * Hermes keeps two memory stores — notes it made, and things it learned about
 * the owner. They are shown as separate groups so "記憶" means one obvious
 * thing to a non-technical reader.
 */
const GROUPS: { store: MemoryItem["store"]; title: string; blurb: string }[] = [
  {
    store: "user",
    title: "あなたのこと",
    blurb: "好みや進め方など、SOCIALが覚えているあなたの情報です。",
  },
  {
    store: "memory",
    title: "メモ",
    blurb: "仕事の前提や決めたことなど、SOCIALが書き留めた内容です。",
  },
];

export default function Memory() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function load() {
    setItems(await api.getMemory());
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(id: string) {
    setConfirming(null);
    if (await api.deleteMemory(id)) await load();
  }

  return (
    <div className="h-full overflow-y-auto px-5 pb-28 pt-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold">記憶</h1>
        <p className="mt-2" style={{ color: "var(--text-dim)" }}>
          SOCIALが長く覚えている内容です。会話の中で「これ覚えて」と伝えると増えます。
        </p>

        {loading ? (
          <p className="mt-8" style={{ color: "var(--text-dim)" }}>読み込んでいます…</p>
        ) : items.length === 0 ? (
          <div className="card mt-8 p-8 text-center">
            <p style={{ color: "var(--text-dim)" }}>まだ記憶はありません。</p>
            <p className="mt-2 text-sm" style={{ color: "var(--text-dim)" }}>
              会話画面で「これ覚えて。〇〇です。」と伝えてみてください。
            </p>
          </div>
        ) : (
          GROUPS.map((g) => {
            const group = items.filter((i) => i.store === g.store);
            if (!group.length) return null;
            return (
              <section key={g.store} className="mt-8">
                <h2 className="font-semibold">{g.title}</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>{g.blurb}</p>
                <ul className="mt-3 flex flex-col gap-3">
                  {group.map((item) => (
                    <li key={item.id} className="card flex items-start gap-4 p-5">
                      <p className="flex-1 whitespace-pre-wrap break-words">
                        {item.text}
                      </p>
                      {confirming === item.id ? (
                        <span className="flex shrink-0 items-center gap-2">
                          <button
                            onClick={() => void remove(item.id)}
                            className="btn-danger !px-4 !py-2 !text-sm"
                          >
                            削除する
                          </button>
                          <button
                            onClick={() => setConfirming(null)}
                            className="btn-ghost !px-4 !py-2 !text-sm"
                          >
                            やめる
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirming(item.id)}
                          className="btn-ghost shrink-0 !px-4 !py-2 !text-sm"
                          aria-label="この記憶を削除"
                        >
                          削除
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}

        <p className="mt-8 rounded-2xl bg-white/5 p-4 text-sm" style={{ color: "var(--text-dim)" }}>
          パスワードやAPIキーなどの認証情報は、ここには保存されません。
        </p>
      </div>
    </div>
  );
}
