import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { speechChunks } from "./speech";

export const MAX_AUDIO_BYTES = 5_000_000;
const MAX_LIBRARY_BYTES = 250_000_000;
const MAX_RECORDINGS = 500;
type Row = { id: string; threadId: string; messageId: string | null; text: string; voice: string; createdAt: number; chunks: string };
export function createHistory(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE recordings (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, message_id TEXT, text TEXT NOT NULL, voice TEXT NOT NULL, created_at INTEGER NOT NULL, chunks TEXT NOT NULL)`,
    `CREATE INDEX recordings_thread ON recordings(thread_id, created_at)`,
    `CREATE TABLE audio_parts (recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE, part_index INTEGER NOT NULL, audio BLOB NOT NULL, PRIMARY KEY(recording_id, part_index))`,
  ]);
  function get(threadId: string, id: string) {
    const row = db.prepare(`SELECT id, thread_id AS threadId, message_id AS messageId, text, voice, created_at AS createdAt, chunks FROM recordings WHERE id = ? AND thread_id = ?`).get(id, threadId) as Row | undefined;
    if (!row) throw new Error("Запись не найдена в этом чате.");
    return row;
  }
  function parts(id: string) {
    return (db.prepare(`SELECT part_index AS n FROM audio_parts WHERE recording_id = ? ORDER BY part_index`).all(id) as { n: number }[]).map(row => row.n);
  }
  function info(row: Row) {
    return { id: row.id, messageId: row.messageId, preview: row.text.replace(/\s+/g, " ").slice(0, 180), voice: row.voice, createdAt: row.createdAt, totalParts: (JSON.parse(row.chunks) as string[]).length, readyParts: parts(row.id) };
  }
  function remove(threadId: string, id: string) {
    get(threadId, id);
    db.transaction(() => {
      db.prepare(`DELETE FROM audio_parts WHERE recording_id = ?`).run(id);
      db.prepare(`DELETE FROM recordings WHERE id = ? AND thread_id = ?`).run(id, threadId);
    })();
  }
  return {
    get, info,
    begin(threadId: string, messageId: string | null, text: string, voice: string) {
      const id = createHash("sha256").update(JSON.stringify([threadId, messageId, text, voice])).digest("hex");
      if (!db.prepare(`SELECT 1 FROM recordings WHERE id = ?`).get(id)) {
        const { count } = db.prepare(`SELECT COUNT(*) AS count FROM recordings`).get() as { count: number };
        if (count >= MAX_RECORDINGS) throw new Error("История заполнена. Удалите ненужные озвучки перед созданием новых.");
        db.prepare(`INSERT INTO recordings VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, threadId, messageId, text, voice, Date.now(), JSON.stringify(speechChunks(text)));
      }
      return info(get(threadId, id));
    },
    list(threadId: string) {
      const rows = db.prepare(`SELECT id, thread_id AS threadId, message_id AS messageId, substr(text, 1, 300) AS text, voice, created_at AS createdAt, chunks FROM recordings WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(threadId, MAX_RECORDINGS) as Row[];
      return rows.map(info);
    },
    read(threadId: string, id: string, index: number) {
      get(threadId, id);
      return (db.prepare(`SELECT audio FROM audio_parts WHERE recording_id = ? AND part_index = ?`).get(id, index) as { audio: Buffer } | undefined)?.audio;
    },
    hasRoom(reservedBytes: number) {
      const { size } = db.prepare(`SELECT COALESCE(SUM(length(audio)), 0) AS size FROM audio_parts`).get() as { size: number };
      return size + reservedBytes <= MAX_LIBRARY_BYTES;
    },
    save(threadId: string, id: string, index: number, audio: Buffer) {
      get(threadId, id); // A deleted recording must never be resurrected by a late response.
      db.prepare(`INSERT INTO audio_parts VALUES (?, ?, ?)`).run(id, index, audio);
    },
    remove,
    removeThread(threadId: string) {
      db.transaction(() => {
        db.prepare(`DELETE FROM audio_parts WHERE recording_id IN (SELECT id FROM recordings WHERE thread_id = ?)`).run(threadId);
        db.prepare(`DELETE FROM recordings WHERE thread_id = ?`).run(threadId);
      })();
    },
  };
}
