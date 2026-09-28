# Voice Replies for bb

Press the small speaker icon **Озвучить ответ** under a message, then
**Озвучить ответ** in the panel. The icon stays visible without hovering. When it is ready, press Play. The speaker icon is shipped as an SVG
and works in both desktop bb and BB Remote Access.

An answer with saved audio also gets a compact native player directly under
the message. No player is added to other messages. Audio never autoplays.
The sidebar's **Озвучки этого чата** lists saved recordings by answer preview,
date and voice. Open a recording to listen or download it. Replaying saved
audio does not call OpenAI or require an API key. Use **Удалить** and confirm
to remove a recording.

## Install on another computer

Requires BB 0.44 or later. Run in a terminal on the computer running BB:

```sh
bb plugin install https://github.com/alexgavrrr/bb-plugin-voice-replies
```

Confirm the displayed source. The repository includes the built plugin;
no manual clone, npm install, or build is needed. BB manages its installed
copy. Future updates:

```sh
bb plugin update voice-replies
```

Then open a chat and press the speaker icon under a message. Add your OpenAI
API key once in the plugin settings. Each separate BB server has its own
settings and recordings. Remote Access to the same BB server shares both.
The repository contains code and build artifacts, not credentials or audio.

## One-time setup

1. Install using the command above.
2. Press the speaker icon, then **Добавить API-ключ**, or open
   **Plugins → Installed plugins → Voice Replies → Settings**.
3. Enter an OpenAI API key in the secret field. Leave voice at `marin` unless
   you prefer another voice. Settings apply to every chat/device on this bb.
4. Return to the chat. **Я уже добавил ключ** refreshes configuration status.

Only an explicit generation sends text to OpenAI and uses API billing.
The key stays in bb secret storage. It is never placed in plugin frontend
code, history, media URLs or logs. A ChatGPT subscription is separate from
API billing.

## Choosing text and long answers

The message icon selects that answer. The sidebar action **Слушать ответы**
defaults to the latest answer and also provides the chat recording history.
**Другой ответ или фрагмент** opens the
older-answer selector and text editor. Desktop message actions and the
assistant selection menu also offer **Озвучить ответ**.

Answers up to 20,000 UTF-16 characters are split without breaking Unicode.
Each part is at most 1,800 UTF-8 bytes, a conservative byte-level token bound
within the model's 2,000-input-token limit including instructions. See the
[model documentation](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts).
Parts are generated sequentially and saved as soon as each succeeds. A failed
later part leaves the earlier parts in history. **Продолжить создание**
continues manually. Repeating the same text, message and voice reuses saved
parts; an in-flight duplicate shares the same request. Changing the text or
voice creates a separate recording. A lost response from OpenAI before bb
receives and saves it can still be billed; no automatic retries are made.

**Остановить** stops after the current part. Closing the player or changing
its text prevents the client from requesting more parts. The server still
saves an in-flight result if it finishes; that request may be billed.

## Storage and playback

History and MP3s live in the plugin's SQLite database managed by
`bb.storage.database()`. They survive page reloads, plugin reloads and bb
restarts, and are shared across devices through the same bb server. Each
recording belongs to one thread and retains its source message id, chosen
text, voice and creation date. A selected fragment is attached to its source
message; if several recordings belong to a message, its inline player shows
the most recent one with audio. All versions remain in the sidebar history.

Recordings made before version 0.2.0 were not persisted and cannot be
recovered after their old player closed.

The library holds up to 500 recordings and 250 MB of audio in total. At most
two new speech requests run at once, with a 90-second timeout and 5 MB maximum
per part. Capacity is reserved before a paid request. When full, creation
stops with a request to delete old recordings; nothing is silently evicted.
Deleting a thread removes its recordings. SQLite may retain freed pages for
reuse. Plugin reload aborts outstanding requests.

Saved media uses a same-origin, `auth: local` HTTP route behind bb/Remote
Access, with no secret in its URL. Native controls request MP3 byte ranges
for seeking. `preload=none` avoids downloading every visible recording.

The public SDK currently has no message-footer slot. Inline players use a
public content script to add owned DOM nodes beneath exact
`data-timeline-row-id` matches, and an app overlay renders React portals into
them. A mutation observer handles virtualized rows. All nodes, observers and
timers are disposed on unload. The text and host message DOM are untouched.
If bb changes that DOM attribute, history remains available in the sidebar;
recheck the small adapter in `inline-player.tsx` after a bb upgrade. The same
content script owns a scoped style that keeps the existing speaker action
visible without hover; it removes the style on unload. No composer banner.

## Development and checks

`npm ci --include=dev`, `npm run check`, `npm test`, `npm run build`.
Keep the SDK version matched with `bb plugin types`.

Tests use the public SDK harness, real temporary SQLite and mocked OpenAI;
no real key is needed. They cover persistence/reload, deduplication, thread
isolation, deletion, failed parts, range responses and inline DOM cleanup.
Live checks use an isolated browser at 390×844 and 1280×900; test metadata is
intercepted only in that session and generation is blocked. No test sound or
paid OpenAI generation is necessary.
