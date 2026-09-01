import { useEffect, useState } from "react";
import Chat from "./screens/Chat";
import Talk from "./screens/Talk";
import Menu, { type MenuTarget } from "./screens/Menu";
import History from "./screens/History";
import Memory from "./screens/Memory";
import Brief from "./screens/Brief";
import Connections from "./screens/Connections";
import Settings from "./screens/Settings";

type Route =
  | "chat" | "talk" | "menu"
  | "history" | "memory" | "brief" | "connections" | "settings";

const ROUTES: Route[] = [
  "chat", "talk", "menu", "history", "memory", "brief", "connections", "settings",
];

/** Screens reached through MENU show a back arrow instead of a nav highlight. */
const SUB_TITLES: Partial<Record<Route, string>> = {
  history: "HISTORY", memory: "MEMORY", brief: "BRIEF",
  connections: "CONNECTIONS", settings: "SETTINGS",
};

function currentRoute(): Route {
  const id = window.location.hash.replace(/^#\/?/, "") as Route;
  return ROUTES.includes(id) ? id : "chat";
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function go(next: Route) {
    window.location.hash = `#/${next}`;
    setRoute(next);
  }

  async function onMenu(target: MenuTarget) {
    if (target === "logout") {
      if (!confirm("ログアウトしますか？次回また合言葉が必要になります。")) return;
      await fetch("/api/logout", { method: "POST" }).catch(() => {});
      window.location.href = "/login";
      return;
    }
    go(target);
  }

  const isSub = route in SUB_TITLES;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-5 py-3">
        {isSub ? (
          <button
            onClick={() => go("menu")}
            aria-label="メニューに戻る"
            className="text-xl"
            style={{ color: "var(--text-dim)" }}
          >
            ‹
          </button>
        ) : (
          <Mark />
        )}
        <div className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold tracking-[.2em]">
            {isSub ? SUB_TITLES[route] : "SOCIAL"}
          </span>
          {!isSub && (
            <span className="flex items-center gap-1.5 text-[11px] tracking-widest text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              ONLINE
            </span>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {route === "chat" && <Chat />}
        {route === "talk" && <Talk />}
        {route === "menu" && <Menu onSelect={onMenu} />}
        {route === "history" && <History />}
        {route === "memory" && <Memory />}
        {route === "brief" && <Brief />}
        {route === "connections" && <Connections />}
        {route === "settings" && <Settings />}
      </main>

      <BottomNav route={route} onGo={go} />
    </div>
  );
}

function Mark() {
  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center" aria-hidden>
      <span
        className="absolute inset-0 rounded-full"
        style={{ background: "radial-gradient(circle at 35% 30%, #7db9ff, #0a1836 70%)" }}
      />
      <span
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: "0 0 14px rgba(47,128,255,.7)" }}
      />
    </span>
  );
}

function BottomNav({ route, onGo }: { route: Route; onGo: (r: Route) => void }) {
  // MENU stays lit while any of its sub-screens is open, so the owner can see
  // where they are rather than the highlight vanishing.
  const menuActive = route === "menu" || route in SUB_TITLES;

  return (
    <nav className="px-4 pb-4 pt-1">
      <div
        className="mx-auto flex max-w-md items-center justify-around rounded-full px-2 py-2"
        style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
      >
        <NavItem
          label="CHAT" icon="💬"
          active={route === "chat"} onClick={() => onGo("chat")}
        />

        <button
          onClick={() => onGo("talk")}
          aria-label="TALK"
          aria-current={route === "talk" ? "page" : undefined}
          className="relative -mt-7 flex flex-col items-center"
        >
          <span
            className="grid h-16 w-16 place-items-center rounded-full transition"
            style={{
              background: route === "talk"
                ? "linear-gradient(160deg,#4a9bff,#1550c8)"
                : "linear-gradient(160deg,#1d4ed8,#0b1f45)",
              boxShadow: route === "talk"
                ? "0 0 26px rgba(47,128,255,.85), inset 0 0 14px rgba(255,255,255,.25)"
                : "0 0 16px rgba(47,128,255,.45)",
              border: "1px solid rgba(147,197,253,.5)",
            }}
          >
            <WaveIcon />
          </span>
          <span
            className="mt-1 text-[11px] font-semibold tracking-widest"
            style={{ color: route === "talk" ? "var(--accent-soft)" : "var(--text-dim)" }}
          >
            TALK
          </span>
        </button>

        <NavItem
          label="MENU" icon="⠿"
          active={menuActive} onClick={() => onGo("menu")}
        />
      </div>
    </nav>
  );
}

function NavItem({
  label, icon, active, onClick,
}: { label: string; icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="flex w-24 flex-col items-center gap-0.5 py-1"
      style={{ color: active ? "var(--accent-soft)" : "var(--text-dim)" }}
    >
      <span className="text-lg" aria-hidden>{icon}</span>
      <span className="text-[11px] font-semibold tracking-widest">{label}</span>
    </button>
  );
}

function WaveIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
      {[
        { x: 4,  h: 6  }, { x: 8,  h: 12 }, { x: 12, h: 18 },
        { x: 16, h: 12 }, { x: 20, h: 6  },
      ].map(({ x, h }) => (
        <rect
          key={x} x={x - 1} y={12 - h / 2} width="2" height={h}
          rx="1" fill="#fff" opacity=".95"
        />
      ))}
    </svg>
  );
}
