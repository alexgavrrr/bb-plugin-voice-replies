// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
const slots: ReturnType<typeof renderSlot>[] = [];
beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test-${Math.random()}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => { slots.splice(0).forEach(slot => slot.lifecycle.unmount()); vi.restoreAllMocks(); });
function mount(text: string, synthesize: () => unknown, configured = true) {
  const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thread-test", params: { text } }, {
    rpc: { status: () => ({ configured, voice: "marin" }), history: () => [], begin: () => ({ id: "a".repeat(64) }), synthesize },
  });
  slots.push(slot);
  return slot;
}
it("does not generate on open or without a key", async () => {
  const synthesize = vi.fn();
  const slot = mount("Привет", synthesize, false);
  await slot.findByRole("link", { name: "Добавить API-ключ" });
  expect(slot.queryByRole("textbox")).toBeNull();
  expect(slot.queryByRole("button", { name: "Озвучить ответ" })).toBeNull();
  expect(synthesize).not.toHaveBeenCalled();
});
it("keeps completed parts and retries only the failed part", async () => {
  const synthesize = vi.fn().mockResolvedValueOnce({ audioBase64: "AQID", mimeType: "audio/mpeg" })
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValue({ audioBase64: "AQID", mimeType: "audio/mpeg" });
  const slot = mount("a".repeat(3600), synthesize);
  const button = await slot.findByRole("button", { name: "Озвучить ответ" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(synthesize).not.toHaveBeenCalled();
  fireEvent.click(button);
  await slot.findByText(/Temporary failure/);
  expect(slot.getAllByText("Скачать MP3")).toHaveLength(1);
  fireEvent.click(slot.getByRole("button", { name: "Продолжить создание" }));
  await slot.findByRole("button", { name: "Аудио готово" });
  expect(synthesize).toHaveBeenCalledTimes(3);
  expect(slot.getAllByText("Скачать MP3")).toHaveLength(2);
  fireEvent.click(slot.getByText("Другой ответ или фрагмент"));
  fireEvent.change(slot.getByLabelText("Текст для озвучивания"), { target: { value: "Другой ответ" } });
  expect(slot.queryByText("Скачать MP3")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it("does not start another paid part after unmount", async () => {
  let resolve!: (result: unknown) => void;
  const synthesize = vi.fn(() => new Promise(done => { resolve = done; }));
  const slot = mount("a".repeat(3600), synthesize);
  const button = await slot.findByRole("button", { name: "Озвучить ответ" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));
  slot.lifecycle.unmount(); slots.splice(slots.indexOf(slot), 1);
  resolve({ audioBase64: "AQID", mimeType: "audio/mpeg" });
  await new Promise(done => setTimeout(done, 20));
  expect(synthesize).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("defaults to the latest reply with advanced controls collapsed", async () => {
  const synthesize = vi.fn();
  const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thread-test", params: null }, {
    rpc: { status: () => ({ configured: true, voice: "marin" }), history: () => [], begin: () => ({ id: "a".repeat(64) }), synthesize },
    sdk: { threads: { timeline: async () => ({ rows: [
      { id: "old", kind: "conversation", role: "assistant", text: "Старый ответ" },
      { id: "new", kind: "conversation", role: "assistant", text: "Последний ответ" },
    ], timelinePage: { olderCursor: null } }) } },
  });
  slots.push(slot);
  await slot.findByRole("button", { name: "Озвучить последний ответ" });
  const summary = slot.getByText("Другой ответ или фрагмент");
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(false);
  expect(slot.getByLabelText("Текст для озвучивания").getAttribute("id")).toBe("voice-text");
  expect(synthesize).not.toHaveBeenCalled();
});
it("adds a silent native player only beneath the matching saved message and cleans up", async () => {
  const { mountPluginContentScripts } = await import("@get-bb/plugin-sdk/testing/app");
  const rows = document.createElement("div");
  rows.innerHTML = '<div data-timeline-row-id="message-saved"></div><div data-timeline-row-id="message-other"></div>';
  document.body.append(rows);
  const scripts = await mountPluginContentScripts(app, { pluginId: "voice-replies", generation: 1 });
  const synthesize = vi.fn();
  const entry = { id: "a".repeat(64), messageId: "message-saved", preview: "Saved answer", voice: "marin", createdAt: 1, totalParts: 1, readyParts: [0] };
  const slot = renderSlot(app.appOverlays[0]!, {}, { pluginId: "voice-replies", context: { threadId: "thread-test", projectId: null }, rpc: { history: () => [entry], synthesize } });
  slots.push(slot);
  try {
    await waitFor(() => expect(rows.querySelectorAll("audio")).toHaveLength(1));
    expect(rows.children[1].querySelector("audio")).toBeNull();
    const audio = rows.querySelector("audio")!;
    expect(audio.preload).toBe("none"); expect(audio.autoplay).toBe(false);
    expect(audio.src).toContain("threadId=thread-test");
    expect(synthesize).not.toHaveBeenCalled();
    rows.firstElementChild!.remove();
    const replacement = document.createElement("div"); replacement.dataset.timelineRowId = "message-saved"; rows.append(replacement);
    await waitFor(() => expect(replacement.querySelector("audio")).not.toBeNull());
    await scripts.lifecycle.dispose();
    expect(rows.querySelectorAll("[data-voice-replies-player]")).toHaveLength(0);
    expect(document.querySelector("[data-voice-replies-actions]")).toBeNull();
  } finally { await scripts.lifecycle.dispose(); rows.remove(); }
});
