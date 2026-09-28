import { useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { PluginThreadPanelProps, PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { MAX_TEXT, speechChunks } from "./speech";
import { HistoryList } from "./saved";
import { registerInlinePlayers } from "./inline-player";

const buttonClass = "min-h-11 rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50";
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : "Не удалось выполнить запрос. Попробуйте ещё раз.";
type Reply = { id: string; text: string };
type Timeline = Awaited<ReturnType<PluginBrowserBbSdk["threads"]["timeline"]>>;

function repliesFrom(rows: Timeline["rows"]): Reply[] {
  return rows.flatMap((row): Reply[] => row.kind === "conversation" && row.role === "assistant" && row.text.trim()
    ? [{ id: row.id, text: row.text }]
    : row.kind === "turn" && row.children ? repliesFrom(row.children) : []);
}

function SpeechPanel(props: PluginThreadPanelProps) {
  const supplied = props.params && typeof props.params === "object" && "text" in props.params && typeof props.params.text === "string"
    ? props.params.text : "";
  const messageId = props.params && typeof props.params === "object" && "messageId" in props.params && typeof props.params.messageId === "string" ? props.params.messageId : null;
  return <ReplyPicker key={`${props.threadId}:${supplied}`} threadId={props.threadId} supplied={supplied} suppliedMessageId={messageId} />;
}

function ReplyPicker({ threadId, supplied, suppliedMessageId }: { threadId: string; supplied: string; suppliedMessageId: string | null }) {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const [replies, setReplies] = useState<Reply[]>([]);
  const [selected, setSelected] = useState("");
  const [text, setText] = useState(supplied);
  const [cursor, setCursor] = useState<Timeline["timelinePage"]["olderCursor"]>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{ configured: boolean; voice: string } | null>(null);
  const mounted = useRef(true);
  const loadingRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function refreshStatus() {
    try {
      const next = await rpc.call("status");
      if (mounted.current) { setStatus(next); setError(""); }
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
  }
  async function load(older = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const page = await sdk.threads.timeline({ threadId, segmentLimit: "20", includeNestedRows: "true",
        ...(older && cursor ? { beforeAnchorId: cursor.anchorId, beforeAnchorSeq: String(cursor.anchorSeq) } : {}) });
      if (!mounted.current) return;
      const next = repliesFrom(page.rows).reverse();
      setReplies(previous => older ? [...previous, ...next.filter(item => !previous.some(old => old.id === item.id))] : next);
      setCursor(page.timelinePage.olderCursor);
      if (!older && !supplied) { setSelected(next[0]?.id ?? ""); setText(next[0]?.text ?? ""); }
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { loadingRef.current = false; if (mounted.current) setLoading(false); }
  }
  useEffect(() => { void refreshStatus(); }, [rpc]);
  useEffect(() => { if (status?.configured && !supplied) void load(); }, [sdk, threadId, supplied, status?.configured]);

  const primaryLabel = !supplied && selected === replies[0]?.id && text === replies[0]?.text
    ? "Озвучить последний ответ" : "Озвучить ответ";

  return <div className="min-w-0 space-y-4">
    <h2 className="text-base font-semibold">Слушать ответы</h2>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {status === null ? <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{error ? "Не удалось проверить подключение." : "Проверяю подключение…"}</p>
      {error && <button type="button" className={buttonClass} onClick={() => void refreshStatus()}>Повторить</button>}
    </div> : !status.configured ? <div className="space-y-4">
      <p className="text-sm">Один раз добавьте OpenAI API-ключ с балансом. После этого можно слушать ответы во всех чатах на телефоне и компьютере.</p>
      <a className={`${buttonClass} inline-flex items-center bg-primary font-medium text-primary-foreground`}
        href="/plugins/voice-replies?view=installed&configure=voice-replies">Добавить API-ключ</a>
      <p className="text-sm text-muted-foreground">В настройках заполните только OpenAI API key. Голос уже выбран. Затем вернитесь в чат.</p>
      <button type="button" className="min-h-11 text-sm underline" onClick={() => void refreshStatus()}>Я уже добавил ключ</button>
    </div> : <>
      <p className="line-clamp-3 text-sm text-muted-foreground">{loading ? "Загружаю ответ…" : text || "В этом чате пока нет ответов."}</p>
      <SpeechPlayer key={text} text={text} threadId={threadId} messageId={suppliedMessageId || selected || null} configured={!loading} actionLabel={primaryLabel} />
      <p className="text-xs text-muted-foreground">Нажмите «{primaryLabel}», дождитесь записи и нажмите ▶. Генерация платная, голос создан ИИ.</p>
      <details className="space-y-3" open={text.trim().length > MAX_TEXT || undefined}>
        <summary className="min-h-11 cursor-pointer py-3 text-sm underline">Другой ответ или фрагмент</summary>
        {!supplied && <div className="space-y-2">
          <label htmlFor="voice-reply" className="block text-sm">Ответ для озвучивания</label>
          <select id="voice-reply" className="min-h-11 w-full min-w-0 rounded-md border border-border bg-background p-2 text-sm" value={selected}
            onChange={event => { setSelected(event.target.value); setText(replies.find(reply => reply.id === event.target.value)?.text ?? ""); }}>
            {replies.length === 0 && <option value="">Ответов пока нет</option>}
            {replies.map((reply, index) => <option key={reply.id} value={reply.id}>{index === 0 ? "Последний: " : ""}{reply.text.replace(/\s+/g, " ").slice(0, 90)}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={loading} onClick={() => void load()}>Обновить ответы</button>
            {cursor && <button type="button" className={buttonClass} disabled={loading} onClick={() => void load(true)}>Более ранние ответы</button>}
          </div>
        </div>}
        <div className="space-y-1">
          <label htmlFor="voice-text" className="block text-sm">Текст для озвучивания</label>
          <textarea id="voice-text" rows={4} value={text} onChange={event => setText(event.target.value)}
            className="w-full rounded-md border border-border bg-background p-2 text-sm" />
          <p className="text-xs text-muted-foreground">{text.length.toLocaleString("ru")} / 20 000 символов. Можно оставить только нужный фрагмент.</p>
        </div>
      </details>
    </>}
    <HistoryList threadId={threadId} />
  </div>;
}

function SpeechPlayer({ text, threadId, messageId, configured, actionLabel }: { text: string; threadId: string; messageId: string | null; configured: boolean; actionLabel: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const chunks = speechChunks(text);
  const [audio, setAudio] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const state = useRef({ mounted: true, running: false, stop: false, urls: [] as string[] });
  useEffect(() => {
    const current = state.current;
    current.mounted = true;
    return () => { current.mounted = false; current.stop = true; current.urls.forEach(url => URL.revokeObjectURL(url)); };
  }, []);

  async function generate() {
    const current = state.current;
    if (!configured || current.running || chunks.length === 0 || current.urls.length === chunks.length) return;
    current.running = true;
    current.stop = false;
    setBusy(true); setStopping(false); setError("");
    try {
      const recording = await rpc.call("begin", { threadId, messageId, text });
      if (!current.mounted || current.stop) return;
      for (let index = current.urls.length; index < chunks.length && !current.stop; index++) {
        const result = await rpc.call("synthesize", { threadId, recordingId: recording.id, index });
        if (!current.mounted) return;
        const bytes = Uint8Array.from(atob(result.audioBase64), c => c.charCodeAt(0));
        current.urls.push(URL.createObjectURL(new Blob([bytes], { type: result.mimeType })));
        setAudio([...current.urls]);
      }
    } catch (cause) { if (current.mounted) setError(errorText(cause)); }
    finally { current.running = false; if (current.mounted) { setBusy(false); setStopping(false); } }
  }

  const complete = chunks.length > 0 && audio.length === chunks.length;
  return <div className="space-y-3">
    {chunks.length > 1 && <p className="text-sm text-muted-foreground">Длинный ответ: {chunks.length} частей.</p>}
    {text.trim().length > MAX_TEXT && <p role="alert" className="text-sm text-destructive">Сократите текст до 20 000 символов.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error} Готовые части сохранены. Продолжить можно вручную.</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={`${buttonClass} bg-primary font-medium text-primary-foreground`}
        disabled={busy || !configured || chunks.length === 0 || complete} onClick={() => void generate()}>
        {busy ? `Создаю ${audio.length + 1}/${chunks.length}…` : complete ? "Аудио готово" : audio.length ? "Продолжить создание" : actionLabel}
      </button>
      {busy && <button type="button" className={buttonClass} disabled={stopping} onClick={() => { state.current.stop = true; setStopping(true); }}>Остановить</button>}
    </div>
    {stopping && <p role="status" className="text-sm">Текущая часть завершится; следующие создаваться не будут.</p>}
    {audio.map((src, index) => <div key={src} className="space-y-1">
      <p className="text-xs text-muted-foreground">Часть {index + 1} из {chunks.length}</p>
      <audio aria-label={`Часть ${index + 1}`} controls preload="metadata" src={src} className="w-full" />
      <a href={src} download={`voice-reply-${index + 1}.mp3`} className="inline-block min-h-11 py-2 text-sm underline">Скачать MP3</a>
    </div>)}
  </div>;
}

export default definePluginApp((app) => {
  registerInlinePlayers(app);
  app.slots.threadPanelAction({ id: "speech-player", title: "Слушать ответы", icon: "voice-replies/speaker", component: SpeechPanel });
  app.slots.messageAction({ id: "speak-message", title: "Озвучить ответ", icon: "voice-replies/speaker",
    run: ({ message, selectedText, openPanel }) => {
      openPanel({ actionId: "speech-player", title: "Озвучить ответ", params: { text: (selectedText || message.text).slice(0, MAX_TEXT + 1), messageId: message.id } });
    },
  });
});
