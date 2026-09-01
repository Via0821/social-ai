import { useMemo, useState } from "react";
import { loadHistory, saveHistory, clearHistory, type Msg } from "../lib/history";

/** Group the transcript into days — the owner asked for per-day at minimum. */
function byDay(messages: Msg[]): { day: string; items: Msg[] }[] {
  const groups = new Map<string, Msg[]>();
  for (const m of messages) {
    const d = new Date(m.at ?? Date.now());
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, items]) => ({ day, items }));
}

function label(day: string): string {
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (day === iso(today)) return "今日";
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (day === iso(y)) return "昨日";
  const [, mm, dd] = day.split("-");
  return `${Number(mm)}月${Number(dd)}日`;
}

export default function History() {
  const [messages, setMessages] = useState<Msg[]>(loadHistory);
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const days = useMemo(() => byDay(messages), [messages]);

  function toggle(day: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(day) ? next.delete(day) : next.add(day);
      return next;
    });
  }

  function removeSelected() {
    if (!selected.size) return;
    if (!confirm(`選択した${selected.size}日分の履歴を消します。SOCIALの記憶は消えません。`)) return;
    const keep = messages.filter((m) => {
      const d = new Date(m.at ?? Date.now());
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return !selected.has(key);
    });
    setMessages(keep);
    saveHistory(keep);
    setSelected(new Set());
    setPicking(false);
  }

  function removeAll() {
    if (!confirm("すべての会話履歴を消します。SOCIALの記憶は消えません。")) return;
    clearHistory();
    setMessages([]);
    setSelected(new Set());
    setPicking(false);
  }

  return (
    <div className="h-full overflow-y-auto px-5 pb-28 pt-6">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap items-center justify-end gap-3">
          {messages.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => { setPicking((v) => !v); setSelected(new Set()); }}
                className="btn-ghost !px-4 !py-2 !text-sm"
              >
                {picking ? "選択をやめる" : "選んで削除"}
              </button>
              {!picking && (
                <button onClick={removeAll} className="btn-danger !px-4 !py-2 !text-sm">
                  すべて削除
                </button>
              )}
            </div>
          )}
        </div>

        <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>
          この端末に残っている会話です。SOCIALの記憶とは別物で、消しても忘れません。
        </p>

        {picking && (
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={removeSelected}
              disabled={!selected.size}
              className="btn-danger !px-4 !py-2 !text-sm"
            >
              選択した{selected.size}日分を削除
            </button>
          </div>
        )}

        {days.length === 0 ? (
          <div className="card mt-8 p-8 text-center" style={{ color: "var(--text-dim)" }}>
            まだ会話がありません。
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {days.map(({ day, items }) => (
              <li key={day} className="card overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4">
                  {picking && (
                    <input
                      type="checkbox"
                      checked={selected.has(day)}
                      onChange={() => toggle(day)}
                      className="h-5 w-5 shrink-0 accent-sky-500"
                      aria-label={`${label(day)}を選択`}
                    />
                  )}
                  <button
                    onClick={() => setOpen(open === day ? null : day)}
                    className="flex min-w-0 flex-1 items-center justify-between text-left"
                  >
                    <span>
                      <span className="font-semibold">{label(day)}</span>
                      <span className="ml-3 text-sm" style={{ color: "var(--text-dim)" }}>
                        {items.length}件
                      </span>
                    </span>
                    <span aria-hidden style={{ color: "var(--text-dim)" }}>
                      {open === day ? "▾" : "›"}
                    </span>
                  </button>
                </div>

                {open === day && (
                  <div className="flex flex-col gap-2 border-t px-5 py-4"
                       style={{ borderColor: "var(--line)" }}>
                    {items.map((m, i) => (
                      <div
                        key={i}
                        className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-[15px] ${
                          m.role === "user"
                            ? "self-end bg-[var(--accent)] text-white"
                            : "self-start bg-white/5"
                        }`}
                      >
                        {m.text}
                        {m.files?.map((f) => (
                          <a
                            key={f.name}
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block text-sm underline"
                          >
                            📎 {f.name}
                          </a>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
