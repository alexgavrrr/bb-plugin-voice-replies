import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc, useRealtime, useRealtimeConnectionState, experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
export type Recording = { id: string; messageId: string | null; preview: string; voice: string; createdAt: number; totalParts: number; readyParts: number[] };
export function useHistory(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [entries, setEntries] = useState<Recording[]>([]);
  const [error, setError] = useState("");
  const request = useRef(0);
  const connection = useRealtimeConnectionState();
  const refresh = useCallback(async () => {
    const version = ++request.current;
    if (!threadId) { setEntries([]); return; }
    try {
      const next = await rpc.call("history", { threadId });
      if (version === request.current) { setEntries(next); setError(""); }
    } catch { if (version === request.current) setError("Не удалось загрузить историю озвучек."); }
  }, [rpc, threadId]);
  useEffect(() => {
    setEntries([]);
    void refresh();
    return () => { request.current++; };
  }, [refresh]);
  useEffect(() => { if (connection === "connected") void refresh(); }, [connection, refresh]);
  useEffect(() => { const focus = () => { void refresh(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
  useRealtime("history", (data) => { if (data && typeof data === "object" && "threadId" in data && data.threadId === threadId) void refresh(); });
  return { entries, error, refresh };
}

export function SavedAudio({ entry, threadId, download = false }: { entry: Recording; threadId: string; download?: boolean }) {
  const pluginId = experimental_usePluginId();
  const [part, setPart] = useState(entry.readyParts[0] ?? 0);
  const index = entry.readyParts.includes(part) ? part : entry.readyParts[0];
  const [error, setError] = useState(false);
  if (index === undefined) return <p className="text-xs text-muted-foreground">Аудио пока не создано.</p>;
  const src = `/api/v1/plugins/${encodeURIComponent(pluginId)}/http/audio?${new URLSearchParams({ threadId, recordingId: entry.id, index: String(index) })}`;
  return <div className="min-w-0 space-y-2">
    {entry.totalParts > 1 && <label className="flex items-center gap-2 text-xs text-muted-foreground">Часть
      <select aria-label="Часть озвучки" className="min-h-11 rounded-md border border-border bg-background px-2" value={index} onChange={event => { setPart(Number(event.target.value)); setError(false); }}>
        {entry.readyParts.map(n => <option key={n} value={n}>{n + 1} из {entry.totalParts}</option>)}
      </select>
      {entry.readyParts.length < entry.totalParts && <span>Создано {entry.readyParts.length} из {entry.totalParts}</span>}
    </label>}
    <audio key={src} aria-label="Сохранённая озвучка" controls preload="none" src={src} className="w-full" onError={() => setError(true)} />
    {error && <p role="alert" className="text-xs text-destructive">Не удалось открыть запись. Обновите историю.</p>}
    {download && <a className="inline-block min-h-11 py-2 text-xs underline" href={src} download={`voice-reply-${entry.id.slice(0, 8)}-${index + 1}.mp3`}>Скачать MP3</a>}
  </div>;
}

export function HistoryList({ threadId }: { threadId: string }) {
  const { entries, error, refresh } = useHistory(threadId);
  const rpc = useRpc<typeof rpcContract>();
  const [limit, setLimit] = useState(5);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  async function remove(id: string) {
    try { await rpc.call("remove", { threadId, recordingId: id }); setConfirm(null); await refresh(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : "Не удалось удалить запись."); }
  }
  return <section className="space-y-3 border-t border-border pt-4" aria-label="Озвучки этого чата">
    <h3 className="text-sm font-semibold">Озвучки этого чата</h3>
    {(error || failure) && <p role="alert" className="text-sm text-destructive">{error || failure}</p>}
    {!entries.length && !error && <p className="text-sm text-muted-foreground">Здесь появятся сохранённые записи. Их можно слушать снова без оплаты.</p>}
    {entries.slice(0, limit).map(entry => <article key={entry.id} className="space-y-2 rounded-md border border-border p-3">
      <p className="line-clamp-2 text-sm">{entry.preview}</p>
      <p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {entry.voice}{entry.readyParts.length < entry.totalParts ? ` · ${entry.readyParts.length}/${entry.totalParts} частей` : ""}</p>
      {selected === entry.id ? <SavedAudio entry={entry} threadId={threadId} download /> : entry.readyParts.length > 0 && <button type="button" className="min-h-11 text-sm underline" onClick={() => setSelected(entry.id)}>Слушать запись</button>}
      <div className="flex flex-wrap gap-4 text-xs">
        {confirm === entry.id ? <><button type="button" className="min-h-11 text-destructive" onClick={() => void remove(entry.id)}>Да, удалить запись</button><button type="button" className="min-h-11" onClick={() => setConfirm(null)}>Отмена</button></> : <button type="button" className="min-h-11 text-muted-foreground" onClick={() => { setFailure(""); setConfirm(entry.id); }}>Удалить</button>}
      </div>
    </article>)}
    {entries.length > limit && <button type="button" className="min-h-11 text-sm underline" onClick={() => setLimit(limit + 5)}>Показать ещё</button>}
  </section>;
}
