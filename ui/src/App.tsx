import { useEffect, useState } from "react";
import Chat from "./screens/Chat";
import Memory from "./screens/Memory";
import Brief from "./screens/Brief";
import Settings from "./screens/Settings";

type TabId = "chat" | "memory" | "brief" | "settings";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "chat", label: "会話", icon: "💬" },
  { id: "memory", label: "記憶", icon: "🧠" },
  { id: "brief", label: "ブリーフ", icon: "📰" },
  { id: "settings", label: "設定", icon: "⚙️" },
];

const IDS = TABS.map((t) => t.id);

/** Hash routing keeps the browser back button and reloads working, without
 *  pulling in a router dependency for four screens. */
function currentTab(): TabId {
  const id = window.location.hash.replace(/^#\/?/, "") as TabId;
  return IDS.includes(id) ? id : "chat";
}

export default function App() {
  const [tab, setTab] = useState<TabId>(currentTab);

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function go(id: TabId) {
    window.location.hash = `#/${id}`;
    setTab(id);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-8">
        <span className="text-lg font-bold tracking-wide">SOCIAL</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-48 shrink-0 border-r border-slate-200 bg-white p-3 sm:block">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition ${
                tab === t.id
                  ? "bg-sky-50 font-semibold text-sky-800"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        <main className="min-h-0 flex-1">
          {tab === "chat" && <Chat />}
          {tab === "memory" && <Memory />}
          {tab === "brief" && <Brief />}
          {tab === "settings" && <Settings />}
        </main>
      </div>

      <nav className="flex border-t border-slate-200 bg-white sm:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
              tab === t.id ? "font-semibold text-sky-700" : "text-slate-500"
            }`}
          >
            <span aria-hidden className="text-lg">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}