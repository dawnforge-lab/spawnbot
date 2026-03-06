---
name: text-to-speech
description: "Generate speech audio using Cartesia TTS (Sonic 3). Use when the user asks for voice messages, narration, audio content, text-to-speech, or TTS."
---

# Text-to-Speech with Cartesia

Generate speech audio from text using Cartesia's Sonic 3 model. Outputs MP3 or WAV files.

## When to Use

- Voice messages via Telegram
- Narration, storytelling, announcements
- Reading summaries, emails, or content aloud
- Any time audio is more engaging than text

## API Overview

Cartesia uses a synchronous bytes API — one request, get audio back.

### Authentication

```
CARTESIA_API_KEY=your-key-here
X-API-Key: ${CARTESIA_API_KEY}
```

### Generate Speech

```typescript
const response = await fetch("https://api.cartesia.ai/tts/bytes", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CARTESIA_API_KEY!,
    "Cartesia-Version": "2024-06-10",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model_id: "sonic-3",
    transcript: "Hello world!",
    voice: { mode: "id", id: "f9836c6e-a0bd-460e-9d3c-f7299fa60f94" },
    output_format: { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
    language: "en",
    speed: "normal",
  }),
})
const audioBuffer = await response.arrayBuffer()
// Write to file: await Bun.write("/tmp/speech.mp3", audioBuffer)
```

### List Voices

```typescript
const response = await fetch("https://api.cartesia.ai/voices?limit=20", {
  headers: {
    "X-API-Key": process.env.CARTESIA_API_KEY!,
    "Cartesia-Version": "2024-06-10",
  },
})
const voices = await response.json()
// voices: [{ id, name, description, language }, ...]
```

Search voices by adding `&q=british` query parameter.

## Parameters

- **transcript** (required): Text to speak
- **voice**: `{ mode: "id", id: "voice-uuid" }` — use list voices to find IDs
- **speed**: `"slow"`, `"normal"` (default), `"fast"`
- **language**: ISO 639-1 code (`"en"`, `"fr"`, `"de"`, etc.) — 42 languages supported
- **output_format**: MP3 (default) or WAV

## Emotions

Control emotional tone via `generation_config.emotion`:

```json
{ "generation_config": { "emotion": "excited" } }
```

**Primary emotions** (best results): `neutral`, `angry`, `excited`, `content`, `sad`, `scared`

**Extended emotions** (54 total): `happy`, `enthusiastic`, `elated`, `euphoric`, `triumphant`, `amazed`, `surprised`, `flirtatious`, `joking`, `curious`, `peaceful`, `serene`, `calm`, `grateful`, `affectionate`, `trust`, `sympathetic`, `anticipation`, `mysterious`, `mad`, `outraged`, `frustrated`, `agitated`, `threatened`, `disgusted`, `contempt`, `envious`, `sarcastic`, `ironic`, `dejected`, `melancholic`, `disappointed`, `hurt`, `guilty`, `bored`, `tired`, `rejected`, `nostalgic`, `wistful`, `apologetic`, `hesitant`, `insecure`, `confused`, `resigned`, `anxious`, `panicked`, `alarmed`, `proud`, `confident`, `distant`, `skeptical`, `contemplative`, `determined`

Blend multiple emotions with comma separation: `"nostalgic, melancholic"`

## Inline Tags

Insert directly in the transcript text:

- `[laughter]` — natural laughter sound
- `<speed ratio="1.5"/>` — change speed mid-text (0.6-1.5)
- `<volume ratio="0.5"/>` — change volume mid-text (0.5-2.0)
- `<emotion value="excited"/>` — change emotion mid-text

Example: `"Oh that's hilarious [laughter] I can't stop!"`

## Volume

Control via `generation_config.volume` (float, 0.5 to 2.0):

```json
{ "generation_config": { "emotion": "excited", "volume": 1.5 } }
```

## Voice Tips

- Browse voices with the list endpoint, search with `?q=` parameter
- Best voices for emotion: Leo, Jace, Kyle, Gavin, Maya, Tessa, Dana, Marian
- Save preferred voice IDs in SOUL.md or .env for consistent persona voice
- Match emotion to text content for best results

## Creating the Tool

When you need TTS, use the `create-tool` skill to build a `tts-speak` tool in `.spawnbot/tools/`. The tool should:

1. Read `CARTESIA_API_KEY` from `process.env`
2. Accept `text`, `voice_id` (optional), `speed` (optional), `emotion` (optional), `language` (optional) arguments
3. POST to `https://api.cartesia.ai/tts/bytes` with Sonic 3
4. Save the audio buffer to a temp file (`/tmp/cartesia_tts_*.mp3`)
5. Return the file path
6. To send as voice message, use `tg_send` or `tg_photo` with the audio file path
