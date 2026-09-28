import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBbContext, experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { SavedAudio, useHistory, type Recording } from "./saved";

type Anchor = { element: HTMLDivElement; entry: Recording; threadId: string };

// BB has no message-footer slot. Only this small adapter depends on a DOM
// attribute; the public content-script lifecycle owns all inserted nodes.
// If the attribute changes, saved audio remains available in the sidebar.
export function registerInlinePlayers(app: PluginAppBuilder) {
  let entries: Recording[] = [];
  let threadId: string | null = null;
  let scan = () => {};
  let notify = (_anchors: Anchor[]) => {};
  app.contentScripts.register({
    id: "inline-audio-anchors",
    mount({ signal }) {
      // Keep only our existing message action visible without hover. No extra
      // toolbar or composer row. The icon asset scopes this to Voice Replies.
      const actionStyle = document.createElement("style");
      actionStyle.dataset.voiceRepliesActions = "true";
      actionStyle.textContent = `
        button[aria-label="Озвучить ответ"]:has([data-plugin-icon-asset^="/api/v1/plugins/voice-replies/assets/"]) {
          opacity: 1;
        }
        button[aria-label="Озвучить ответ"]:disabled:has([data-plugin-icon-asset^="/api/v1/plugins/voice-replies/assets/"]) {
          opacity: .4;
        }
      `;
      document.head.append(actionStyle);
      const anchors = new Map<HTMLElement, Anchor>();
      let serial = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      scan = () => {
        if (signal.aborted) return;
        const latest = new Map<string, Recording>();
        for (const entry of entries) if (entry.messageId && entry.readyParts.length && !latest.has(entry.messageId)) latest.set(entry.messageId, entry);
        let changed = false;
        for (const [row, anchor] of anchors) {
          const id = row.getAttribute("data-timeline-row-id");
          if (!row.isConnected || !id || !latest.has(id) || anchor.threadId !== threadId || !row.contains(anchor.element)) {
            anchor.element.remove(); anchors.delete(row); changed = true;
          }
        }
        if (threadId && latest.size) for (const row of Array.from(document.querySelectorAll<HTMLElement>("[data-timeline-row-id]"))) {
          const entry = latest.get(row.getAttribute("data-timeline-row-id") ?? "");
          if (!entry) continue;
          const existing = anchors.get(row);
          if (existing) {
            if (existing.entry !== entry) { existing.entry = entry; changed = true; }
          } else {
            const element = document.createElement("div");
            element.id = `voice-replies-player-${++serial}`;
            element.dataset.voiceRepliesPlayer = "true";
            element.className = "mx-4 mb-3 max-w-full";
            row.append(element);
            anchors.set(row, { element, entry, threadId }); changed = true;
          }
        }
        if (changed) notify([...anchors.values()]);
      };
      const observer = new MutationObserver(() => {
        if (!timer) timer = setTimeout(() => { timer = undefined; scan(); }, 100);
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-timeline-row-id"] });
      scan();
      return () => {
        observer.disconnect(); clearTimeout(timer); actionStyle.remove();
        for (const anchor of anchors.values()) anchor.element.remove();
        anchors.clear(); notify([]); scan = () => {};
      };
    },
  });
  function InlinePlayers() {
    const context = useBbContext();
    const history = useHistory(context.threadId);
    const [anchors, setAnchors] = useState<Anchor[]>([]);
    useEffect(() => { notify = setAnchors; return () => { notify = () => {}; }; }, []);
    useEffect(() => {
      threadId = context.threadId; entries = history.entries; scan();
    }, [context.threadId, history.entries]);
    useEffect(() => () => { entries = []; threadId = null; scan(); }, []);
    return <>{anchors.map(anchor => createPortal(<div className="space-y-2 rounded-md border border-border bg-card p-3" aria-label="Озвучка ответа">
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><Icon name="voice-replies/speaker" className="size-4" />Озвучка ответа</p>
      <SavedAudio entry={anchor.entry} threadId={anchor.threadId} />
    </div>, anchor.element, anchor.element.id))}</>;
  }
  app.slots.experimental_appOverlay({ id: "inline-audio", component: InlinePlayers });
}
