export type MenuTarget =
  | "history" | "memory" | "brief" | "connections" | "settings" | "logout";

const ITEMS: {
  id: MenuTarget; en: string; ja: string; desc: string; icon: string;
}[] = [
  { id: "history",     en: "HISTORY",     ja: "履歴",   icon: "🕘",
    desc: "過去の会話を日付ごとに見返せます" },
  { id: "memory",      en: "MEMORY",      ja: "記憶",   icon: "🧠",
    desc: "SOCIALが覚えている内容の確認・削除" },
  { id: "brief",       en: "BRIEF",       ja: "ブリーフ", icon: "📰",
    desc: "毎朝のレポートの確認・再作成" },
  { id: "connections", en: "CONNECTIONS", ja: "連携",   icon: "🔗",
    desc: "外部サービスとの連携状況" },
  { id: "settings",    en: "SETTINGS",    ja: "設定",   icon: "⚙️",
    desc: "動作状況の確認" },
  { id: "logout",      en: "LOG OUT",     ja: "ログアウト", icon: "🚪",
    desc: "この端末からログアウトします" },
];

export default function Menu({ onSelect }: { onSelect: (t: MenuTarget) => void }) {
  return (
    <div className="h-full overflow-y-auto px-5 pb-28 pt-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold tracking-wide">MENU</h1>

        <ul className="mt-6 flex flex-col gap-3">
          {ITEMS.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onSelect(item.id)}
                className={`card flex w-full items-center gap-4 px-5 py-4 text-left transition
                  hover:border-sky-500/50 ${item.id === "logout" ? "opacity-80" : ""}`}
              >
                <span className="text-2xl" aria-hidden>{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold tracking-wide">
                    {item.en}
                    <span className="ml-2 text-sm font-normal"
                          style={{ color: "var(--text-dim)" }}>
                      {item.ja}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm"
                        style={{ color: "var(--text-dim)" }}>
                    {item.desc}
                  </span>
                </span>
                <span aria-hidden style={{ color: "var(--text-dim)" }}>›</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
