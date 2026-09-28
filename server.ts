import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MAX_TEXT, speechInstructions } from "./speech";
import { createHistory, MAX_AUDIO_BYTES } from "./history";

const voiceSchema = z.enum(["marin", "cedar", "coral", "nova"]);
const threadIdSchema = z.string().min(1).max(200);
const targetSchema = z.object({ threadId: threadIdSchema, recordingId: z.string().length(64) }).strict();
const partSchema = targetSchema.extend({ index: z.number().int().min(0).max(100) }).strict();
const audioSchema = z.object({ audioBase64: z.string(), mimeType: z.literal("audio/mpeg") });
const recordingSchema = z.object({ id: z.string(), messageId: z.string().nullable(), preview: z.string(), voice: z.string(), createdAt: z.number(), totalParts: z.number(), readyParts: z.array(z.number()) });
export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: z.object({ configured: z.boolean(), voice: voiceSchema }) },
  begin: {
    input: z.object({ threadId: threadIdSchema, messageId: z.string().max(1000).nullable(), text: z.string().trim().min(1).max(MAX_TEXT) }).strict(),
    output: recordingSchema,
  },
  history: { input: z.object({ threadId: threadIdSchema }).strict(), output: z.array(recordingSchema) },
  audio: { input: partSchema, output: audioSchema },
  remove: { input: targetSchema, output: z.object({ ok: z.literal(true) }) },
  synthesize: { input: partSchema, output: audioSchema },
});

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    apiKey: { type: "string", label: "OpenAI API key", secret: true },
    voice: { type: "select", label: "Voice", options: ["marin", "cedar", "coral", "nova"], default: "marin" },
  });
  const history = createHistory(bb);
  const pending = new Map<string, Promise<{ audioBase64: string; mimeType: "audio/mpeg" }>>();
  const encoded = (bytes: Buffer) => ({ audioBase64: bytes.toString("base64"), mimeType: "audio/mpeg" as const });
  bb.events.on("thread.deleted", ({ thread }) => history.removeThread(thread.id));
  let activeRequests = 0;
  const lifetime = new AbortController();
  bb.onDispose(() => lifetime.abort());
  bb.http.route("GET", "/audio", context => {
    const input = partSchema.safeParse({ threadId: context.req.query("threadId"), recordingId: context.req.query("recordingId"), index: Number(context.req.query("index")) });
    if (!input.success) return new Response("Invalid audio request", { status: 400 });
    try {
      const bytes = history.read(input.data.threadId, input.data.recordingId, input.data.index);
      if (!bytes) return new Response("Audio not found", { status: 404 });
      const headers = new Headers({ "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" });
      const range = context.req.header("Range");
      let start = 0, end = bytes.length - 1;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}` } });
        if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
        else start = Math.max(0, bytes.length - Number(match[2]));
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}` } });
        headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
      }
      headers.set("Content-Length", String(end - start + 1));
      return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: range ? 206 : 200, headers });
    } catch { return new Response("Audio not found", { status: 404 }); }
  }, { auth: "local" });
  bb.rpc.register(rpcContract, {
    async status() {
      const { apiKey, voice } = await settings.get();
      return { configured: Boolean(apiKey?.trim()), voice: voiceSchema.parse(voice) };
    },
    async begin({ threadId, messageId, text }) {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.deletedAt) throw new Error("Чат удалён.");
      const { voice } = await settings.get();
      return history.begin(threadId, messageId, text, voiceSchema.parse(voice));
    },
    async history({ threadId }) { return history.list(threadId); },
    async audio({ threadId, recordingId, index }) {
      const bytes = history.read(threadId, recordingId, index);
      if (!bytes) throw new Error("Эта часть ещё не создана.");
      return encoded(bytes);
    },
    async remove({ threadId, recordingId }) {
      if ([...pending.keys()].some(key => key.startsWith(recordingId + ":"))) throw new Error("Дождитесь завершения текущей части перед удалением.");
      history.remove(threadId, recordingId);
      bb.realtime.publish("history", { threadId });
      return { ok: true as const };
    },
    async synthesize({ threadId, recordingId, index }) {
      const row = history.get(threadId, recordingId);
      const text = (JSON.parse(row.chunks) as string[])[index];
      if (!text) throw new Error("Часть не найдена.");
      const cached = history.read(threadId, recordingId, index);
      if (cached) return encoded(cached);
      const key = `${recordingId}:${index}`;
      if (pending.has(key)) return pending.get(key)!;
      if (activeRequests >= 2) throw new Error("Сейчас уже создаются две записи. Повторите попытку позже.");
      if (!history.hasRoom((activeRequests + 1) * MAX_AUDIO_BYTES)) throw new Error("Хранилище озвучек заполнено. Удалите ненужные записи. Новый запрос не отправлен.");
      activeRequests += 1;
      const work = (async () => {
      try {
        const { apiKey } = await settings.get();
        if (!apiKey?.trim()) throw new Error("Добавьте OpenAI API key в настройках плагина Voice Replies.");
        const voice = voiceSchema.parse(row.voice);
        const response = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini-tts", voice: voiceSchema.parse(voice), input: text, response_format: "mp3",
            instructions: speechInstructions,
          }),
          signal: AbortSignal.any([AbortSignal.timeout(90_000), lifetime.signal]),
        }).catch(() => { throw new Error("Не удалось связаться с OpenAI или истекло время ожидания. Повторите вручную."); });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401) throw new Error("OpenAI отклонил API-ключ. Проверьте ключ в настройках плагина.");
          if (response.status === 429) throw new Error("OpenAI ограничил запросы или на аккаунте закончился доступный баланс.");
          throw new Error(`OpenAI не создал аудио (HTTP ${response.status}).`);
        }
        // Base64 must fit within an 8 MiB JSON transport envelope.
        const reader = response.body?.getReader();
        if (!reader) throw new Error("OpenAI вернул пустое аудио.");
        const parts: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > MAX_AUDIO_BYTES) throw new Error("OpenAI вернул слишком большое аудио.");
            parts.push(value);
          }
        } catch {
          await reader.cancel().catch(() => {});
          throw new Error("Аудио не получено полностью или превышает допустимый размер. Повторите вручную.");
        } finally { reader.releaseLock(); }
        const bytes = Buffer.concat(parts);
        if (!bytes.length) throw new Error("OpenAI вернул пустое аудио.");
        if (lifetime.signal.aborted) throw new Error("Плагин перезагружен. Откройте историю ещё раз.");
        history.save(threadId, recordingId, index, bytes);
        bb.realtime.publish("history", { threadId });
        return encoded(bytes);
      } finally { activeRequests -= 1; }
      })();
      pending.set(key, work);
      try { return await work; } finally { pending.delete(key); }
    },
  });
}
