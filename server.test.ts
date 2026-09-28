import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
function setup(apiKey = "") {
  const host = createFakePluginHost({ pluginId: "voice-replies", settings: { apiKey, voice: "marin" }, sdk: { threads: { get: async ({ threadId }) => makeThreadResponse({ id: threadId }) } } });
  hosts.push(host); plugin(host.bb); return host.harness;
}
type Harness = ReturnType<typeof setup>;
async function start(harness: Harness, text = "Привет", threadId = "thread-one") {
  const row = await harness.behavior.callRpc("begin", { threadId, messageId: "message-one", text }) as { id: string };
  return { threadId, recordingId: row.id, index: 0 };
}
const history = (h: Harness, threadId = "thread-one") => h.behavior.callRpc("history", { threadId });
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.harness.lifecycle.dispose())); vi.unstubAllGlobals(); });
describe("speech and durable history", () => {
  it("does not generate on begin or without a key", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const h = setup(); const part = await start(h);
    expect(await h.behavior.callRpc("status", null)).toEqual({ configured: false, voice: "marin" });
    await expect(h.behavior.callRpc("synthesize", part)).rejects.toThrow(/API key/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects invalid input before fetch", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const h = setup("test-only");
    for (const text of ["", "a".repeat(20001)]) await expect(start(h, text)).rejects.toThrow();
    const part = await start(h);
    await expect(h.behavior.callRpc("synthesize", { ...part, index: 20 })).rejects.toThrow(/не найдена/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("persists audio across plugin reload and replays without a key or another charge", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))); vi.stubGlobal("fetch", fetch);
    let h = setup("test-only"); const part = await start(h);
    await h.behavior.callRpc("synthesize", part);
    const replacement = await h.lifecycle.reload(plugin); hosts.push(replacement); h = replacement.harness;
    await h.behavior.setSettings({ apiKey: "" });
    expect(await h.behavior.callRpc("synthesize", part)).toEqual({ audioBase64: "AQID", mimeType: "audio/mpeg" });
    expect(await history(h)).toMatchObject([{ id: part.recordingId, preview: "Привет", readyParts: [0], totalParts: 1 }]);
    expect((await start(h)).recordingId).toBe(part.recordingId);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.logEntries)).not.toContain("test-only");
  });
  it("isolates thread histories and deletion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]))));
    const h = setup("test-only"); const part = await start(h);
    await h.behavior.callRpc("synthesize", part);
    expect(await history(h, "thread-two")).toEqual([]);
    await expect(h.behavior.callRpc("audio", { ...part, threadId: "thread-two" })).rejects.toThrow(/не найдена/);
    await expect(h.behavior.callRpc("remove", { threadId: "thread-two", recordingId: part.recordingId })).rejects.toThrow();
    await h.behavior.callRpc("remove", { threadId: part.threadId, recordingId: part.recordingId });
    expect(await history(h)).toEqual([]);
    await expect(h.behavior.callRpc("audio", part)).rejects.toThrow();
  });
  it("deduplicates simultaneous generation and caps concurrency", async () => {
    let finish!: () => void; const wait = new Promise<void>(resolve => { finish = resolve; });
    const fetch = vi.fn(async () => { await wait; return new Response(new Uint8Array([1])); }); vi.stubGlobal("fetch", fetch);
    const h = setup("test-only");
    const one = await start(h, "one"), two = await start(h, "two"), three = await start(h, "three");
    const first = h.behavior.callRpc("synthesize", one);
    const duplicate = h.behavior.callRpc("synthesize", one);
    const second = h.behavior.callRpc("synthesize", two);
    await expect(h.behavior.callRpc("synthesize", three)).rejects.toThrow(/две записи/);
    await expect(h.behavior.callRpc("remove", { threadId: one.threadId, recordingId: one.recordingId })).rejects.toThrow(/Дождитесь/);
    finish(); await Promise.all([first, duplicate, second]); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps completed parts across failure and pins the recording voice", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([1])))
      .mockResolvedValueOnce(new Response("secret body", { status: 429 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([2])));
    vi.stubGlobal("fetch", fetch); const h = setup("test-only"); const part = await start(h, "a".repeat(3600));
    await h.behavior.callRpc("synthesize", part);
    await h.behavior.setSettings({ voice: "cedar" });
    await expect(h.behavior.callRpc("synthesize", { ...part, index: 1 })).rejects.toThrow(/баланс/);
    expect(await history(h)).toMatchObject([{ readyParts: [0], totalParts: 2 }]);
    await h.behavior.callRpc("synthesize", { ...part, index: 1 });
    expect(JSON.parse(fetch.mock.calls[2][1].body).voice).toBe("marin");
    expect(await history(h)).toMatchObject([{ readyParts: [0, 1] }]);
  });
  it("sanitizes upstream errors, bounds audio and releases slots", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("secret body", { status: 401 }))
      .mockRejectedValueOnce(new Error("test-only must not escape"))
      .mockResolvedValueOnce(new Response(new Uint8Array(5_000_001)))
      .mockResolvedValueOnce(new Response(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetch); const h = setup("test-only"); const part = await start(h);
    await expect(h.behavior.callRpc("synthesize", part)).rejects.toThrow(/отклонил API/);
    await expect(h.behavior.callRpc("synthesize", part)).rejects.toThrow(/связаться/);
    await expect(h.behavior.callRpc("synthesize", part)).rejects.toThrow(/размер/);
    await expect(h.behavior.callRpc("synthesize", part)).resolves.toBeDefined();
  });
  it("serves saved MP3 with range support for native mobile controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1,2,3,4]))));
    const h = setup("test-only"); const part = await start(h); await h.behavior.callRpc("synthesize", part);
    const url = `/audio?${new URLSearchParams({ threadId: part.threadId, recordingId: part.recordingId, index: "0" })}`;
    const response = await h.behavior.fetchHttp("GET", url, { headers: { Range: "bytes=1-2" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 1-2/4");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2,3]);
    const bad = await h.behavior.fetchHttp("GET", url, { headers: { Range: "bytes=9-" } }); expect(bad.status).toBe(416);
  });
  it("cleans up audio when its thread is deleted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]))));
    const h = setup("test-only"); const part = await start(h); await h.behavior.callRpc("synthesize", part);
    await h.behavior.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: part.threadId }) });
    expect(await history(h)).toEqual([]);
  });
});
it("bounds metadata growth and allows creation again after deletion", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const h = setup("test-only");
  let first: Awaited<ReturnType<typeof start>> | undefined;
  for (let n = 0; n < 500; n++) { const entry = await start(h, `Answer ${n}`); first ??= entry; }
  await expect(start(h, "Overflow")).rejects.toThrow(/История заполнена/);
  await h.behavior.callRpc("remove", { threadId: first!.threadId, recordingId: first!.recordingId });
  await expect(start(h, "New answer")).resolves.toBeDefined();
  expect(fetch).not.toHaveBeenCalled();
});
