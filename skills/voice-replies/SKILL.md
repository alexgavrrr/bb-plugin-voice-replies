---
name: voice-replies
description: Use when the user asks how to enable, configure, or troubleshoot speech playback of bb chat replies through the Voice Replies plugin.
---

# Voice Replies

In any main bb chat, on desktop or phone through BB Remote Access, press the
small speaker icon **Озвучить ответ** under the desired message. It stays
visible without hover on desktop and mobile. Press **Озвучить ответ** in the
panel, then Play when ready. Select an older
answer or edit text under **Другой ответ или фрагмент**, collapsed by default. Play each part using
its audio controls, or download the MP3. No automatic generation or playback.
If an existing remote page still has the old UI, refresh it once.

Set up with **Добавить API-ключ** in the player, or
**Plugins → Installed plugins → Voice Replies → Settings**. Enter `apiKey`
in the secret field and select `voice`, default `marin`. Settings apply to all
chats and devices on this bb server. **Я уже добавил ключ** refreshes status.
Never print, paste, or log the key. Do not request a key unless the user is
ready to configure it. Without a key, show only one-time setup guidance, not the reply picker or player.

Desktop message actions and the assistant text-selection menu also offer
**Озвучить ответ**. The large composer banner has been removed. The sidebar
action **Слушать ответы** still opens the latest answer and saved history.

The model is `gpt-4o-mini-tts`. Generation sends the chosen text to OpenAI
and uses the user's API billing. Text over 20,000 characters must be shortened.
Parts are limited to 1,800 UTF-8 bytes and generated sequentially. The player
shows the number of parts before generating. Failed parts can be retried
manually without regenerating already completed parts. A lost API response
can still have been billed, so retrying it may incur another charge.

Saved recordings appear under **Озвучки этого чата** with answer previews and
dates. A compact native player also appears under the matching chat message.
Only messages with saved audio get a player. It does not autoplay. Replaying
saved MP3s is free of new OpenAI generation and works without an API key.
History persists on the bb server and is shared with Remote Access. Recordings
from before version 0.2.0 were temporary and cannot be recovered.

**Остановить** stops after the current part. Closing the panel stops further
parts, but a request already sent may finish, be saved and be billed.
Identical text/message/voice reuses completed parts. Different versions stay
in sidebar history; the inline player shows the latest saved version.
Delete individual recordings via **Удалить**, then confirm. The library is
capped at 500 recordings / 250 MB; full storage blocks new generation rather
than deleting paid audio. Deleting a thread deletes its recordings.

For troubleshooting, check `bb plugin rpc call voice-replies status --json`,
SDK/build compatibility, and actual screenshots at 390×844. An action in the
accessibility tree alone does not prove mobile visibility. Without a key,
verify the setup flow and that saved history still plays. Never start test
playback with sound unless the user requests it; use muted browser checks. Do not claim real
TTS or physical-phone playback was tested using only mocked responses.
