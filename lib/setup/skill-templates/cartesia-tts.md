# Cartesia TTS — Text-to-Speech

How to create an MCP server for generating speech audio using Cartesia's Sonic model.

## Overview

Cartesia provides fast, expressive text-to-speech via a REST API. Supports multiple voices, emotions, speed/volume control, inline SSML tags, and 42 languages. Outputs MP3 or WAV files.

## Environment Variables

```
CARTESIA_API_KEY — API key from https://play.cartesia.ai/
```

Register when creating the server:
```
tool_create({
  name: "cartesia-tts",
  code: "<full source>",
  env: { CARTESIA_API_KEY: "${CARTESIA_API_KEY}" }
})
```

## When to Use

- Voice messages and narration
- Storytelling (use different voices for characters)
- Reading out summaries, emails, or content
- Any time audio output is more engaging than text

## API Helpers

```js
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const API_KEY = process.env.CARTESIA_API_KEY;
const API_BASE = 'https://api.cartesia.ai';

async function cartesiaRequest(method, path, body = null) {
  const opts = {
    method,
    headers: {
      'X-API-Key': API_KEY,
      'Cartesia-Version': '2024-06-10',
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, opts);
  return res;
}
```

## Generating Speech

The TTS endpoint returns raw audio bytes. Write them to a file.

```js
async function generateSpeech({
  text,
  voiceId = 'a0e99841-438c-4a64-b679-ae501e7d6091', // default voice
  speed = 'normal',
  emotion = null,
  volume = null,
  language = 'en',
  format = 'mp3',
  outputPath = null,
}) {
  // Build output format
  const outputFormat = format === 'wav'
    ? { container: 'wav', encoding: 'pcm_f32le', sample_rate: 44100 }
    : { container: 'mp3', bit_rate: 128000, sample_rate: 44100 };

  // Build request body
  const body = {
    model_id: 'sonic',
    transcript: text,
    voice: { mode: 'id', id: voiceId },
    output_format: outputFormat,
    speed,
    language,
  };

  // Add emotion/volume via generation_config
  if (emotion || volume != null) {
    body.generation_config = {};
    if (emotion) {
      body.generation_config.emotion = Array.isArray(emotion) ? emotion.join(', ') : emotion;
    }
    if (volume != null) {
      body.generation_config.volume = volume;
    }
  }

  const res = await cartesiaRequest('POST', '/tts/bytes', body);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cartesia TTS ${res.status}: ${err}`);
  }

  // Get audio bytes
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Write to file
  const ext = format === 'wav' ? 'wav' : 'mp3';
  const filePath = outputPath || join(tmpdir(), `cartesia_tts_${randomUUID().slice(0, 8)}.${ext}`);
  writeFileSync(filePath, buffer);

  return { path: filePath, size: buffer.length, format: ext };
}
```

## Listing Voices

```js
async function listVoices(query = null, limit = 20) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);

  const res = await cartesiaRequest('GET', `/voices?${params}`);
  if (!res.ok) throw new Error(`Cartesia ${res.status}: ${await res.text()}`);

  const voices = await res.json();
  return voices.slice(0, limit).map(v => ({
    id: v.id,
    name: v.name,
    description: v.description || '',
    language: v.language || '',
  }));
}
```

## Getting a Voice by ID

```js
async function getVoice(voiceId) {
  const res = await cartesiaRequest('GET', `/voices/${voiceId}`);
  if (!res.ok) throw new Error(`Cartesia ${res.status}: ${await res.text()}`);

  const v = await res.json();
  return { id: v.id, name: v.name, description: v.description || '', language: v.language || '' };
}
```

## Resolving Voice by Name

```js
async function resolveVoiceId(voiceName) {
  const voices = await listVoices(voiceName);

  // Exact match first
  const exact = voices.find(v => v.name.toLowerCase() === voiceName.toLowerCase());
  if (exact) return exact.id;

  // Fall back to first result
  if (voices.length > 0) return voices[0].id;

  return null;
}
```

## Emotions

Control emotional tone of the speech. Can use a single emotion or blend multiple.

**Primary emotions** (best results): `neutral`, `angry`, `excited`, `content`, `sad`, `scared`

**Extended emotions** (54 total): `happy`, `enthusiastic`, `elated`, `euphoric`, `triumphant`, `amazed`, `surprised`, `flirtatious`, `joking`, `curious`, `peaceful`, `serene`, `calm`, `grateful`, `affectionate`, `trust`, `sympathetic`, `anticipation`, `mysterious`, `mad`, `outraged`, `frustrated`, `agitated`, `threatened`, `disgusted`, `contempt`, `envious`, `sarcastic`, `ironic`, `dejected`, `melancholic`, `disappointed`, `hurt`, `guilty`, `bored`, `tired`, `rejected`, `nostalgic`, `wistful`, `apologetic`, `hesitant`, `insecure`, `confused`, `resigned`, `anxious`, `panicked`, `alarmed`, `proud`, `confident`, `distant`, `skeptical`, `contemplative`, `determined`

```js
// Single emotion
await generateSpeech({ text: 'We won!', emotion: 'excited' });

// Blended emotions
await generateSpeech({ text: 'I miss those days...', emotion: ['nostalgic', 'melancholic'] });
```

Emotions work best when consistent with the text content.

## Inline Tags

Insert directly in the text for mid-sentence control:

```js
// Laughter
await generateSpeech({ text: 'Oh that is hilarious [laughter] I cannot stop!' });

// Speed change mid-sentence
await generateSpeech({ text: 'Start normal. <speed ratio="1.5"/>Now faster! <speed ratio="0.7"/>Now slower.' });

// Volume change mid-sentence
await generateSpeech({ text: '<volume ratio="1.5"/>THIS IS LOUD! <volume ratio="0.5"/>and this is quiet.' });

// Emotion change mid-sentence
await generateSpeech({ text: '<emotion value="excited"/>Oh my god this is amazing!' });
```

**Supported inline tags:**
- `[laughter]` — inserts natural laughter
- `<speed ratio="X"/>` — change speed mid-text (0.6–1.5)
- `<volume ratio="X"/>` — change volume mid-text (0.5–2.0)
- `<emotion value="X"/>` — change emotion mid-text

## Speed and Volume

**Speed** (API-level, affects entire output): `slow`, `normal`, `fast`

**Volume** (0.5 to 2.0):
```js
await generateSpeech({ text: 'Whisper mode', volume: 0.5 });
await generateSpeech({ text: 'LOUD AND CLEAR', volume: 1.8 });
```

## Languages

42 languages supported via ISO 639-1 codes. Common codes:
`en` (English), `fr` (French), `de` (German), `es` (Spanish), `it` (Italian), `pt` (Portuguese), `ja` (Japanese), `ko` (Korean), `zh` (Chinese), `ru` (Russian), `ar` (Arabic), `hi` (Hindi), `nl` (Dutch), `pl` (Polish), `sv` (Swedish)

```js
await generateSpeech({ text: 'Bonjour le monde!', language: 'fr' });
```

## Output Formats

| Format | Container | Encoding | Sample Rate | Bit Rate |
|--------|-----------|----------|-------------|----------|
| MP3 | mp3 | — | 44100 Hz | 128 kbps |
| WAV | wav | pcm_f32le | 44100 Hz | — |

Files are saved to the system temp directory by default, or a custom path via `outputPath`.

## Complete MCP Server Example

```js
import { McpServer } from '../../lib/mcp/base-server.js';
import { defineTool } from '../../lib/mcp/tool.js';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const API_KEY = process.env.CARTESIA_API_KEY;
const API_BASE = 'https://api.cartesia.ai';

async function cartesiaRequest(method, path, body = null) {
  const opts = {
    method,
    headers: {
      'X-API-Key': API_KEY,
      'Cartesia-Version': '2024-06-10',
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(`${API_BASE}${path}`, opts);
}

const server = new McpServer({ name: 'cartesia-tts', version: '0.1.0' });

server.addTools([
  defineTool({
    name: 'tts_speak',
    description: 'Generate speech audio from text. Returns the file path to the generated audio. Supports emotions, speed, volume, inline tags ([laughter], <speed/>, <volume/>, <emotion/>), and 42 languages.',
    inputSchema: {
      properties: {
        text: { type: 'string', description: 'Text to speak. Supports inline tags: [laughter], <speed ratio="1.5"/>, <volume ratio="0.8"/>, <emotion value="excited"/>' },
        voice_id: { type: 'string', description: 'Cartesia voice UUID (use tts_voices to find voices)' },
        voice_name: { type: 'string', description: 'Voice name to search for (alternative to voice_id)' },
        speed: { type: 'string', description: 'Speed: slow, normal, fast (default: normal)' },
        emotion: { type: 'string', description: 'Emotion(s), comma-separated. Primary: neutral, angry, excited, content, sad, scared. Extended: happy, enthusiastic, melancholic, nostalgic, confident, determined, etc.' },
        volume: { type: 'number', description: 'Volume multiplier 0.5-2.0 (default: 1.0)' },
        language: { type: 'string', description: 'ISO 639-1 language code (default: en)' },
        format: { type: 'string', description: 'Output format: mp3 or wav (default: mp3)' },
        output_path: { type: 'string', description: 'Custom output file path (optional, auto-generated if omitted)' },
      },
      required: ['text'],
    },
    async handler({ text, voice_id, voice_name, speed = 'normal', emotion, volume, language = 'en', format = 'mp3', output_path }) {
      // Resolve voice
      let voiceId = voice_id;
      if (!voiceId && voice_name) {
        const searchRes = await cartesiaRequest('GET', `/voices?q=${encodeURIComponent(voice_name)}`);
        if (searchRes.ok) {
          const voices = await searchRes.json();
          const exact = voices.find(v => v.name.toLowerCase() === voice_name.toLowerCase());
          voiceId = exact ? exact.id : voices[0]?.id;
        }
      }
      if (!voiceId) voiceId = 'a0e99841-438c-4a64-b679-ae501e7d6091'; // default

      // Build output format
      const outputFormat = format === 'wav'
        ? { container: 'wav', encoding: 'pcm_f32le', sample_rate: 44100 }
        : { container: 'mp3', bit_rate: 128000, sample_rate: 44100 };

      // Build request
      const body = {
        model_id: 'sonic',
        transcript: text,
        voice: { mode: 'id', id: voiceId },
        output_format: outputFormat,
        speed,
        language,
      };

      if (emotion || volume != null) {
        body.generation_config = {};
        if (emotion) {
          body.generation_config.emotion = emotion.includes(',')
            ? emotion.split(',').map(e => e.trim()).join(', ')
            : emotion;
        }
        if (volume != null) body.generation_config.volume = volume;
      }

      const res = await cartesiaRequest('POST', '/tts/bytes', body);
      if (!res.ok) throw new Error(`Cartesia TTS ${res.status}: ${await res.text()}`);

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const ext = format === 'wav' ? 'wav' : 'mp3';
      const filePath = output_path || join(tmpdir(), `cartesia_tts_${randomUUID().slice(0, 8)}.${ext}`);
      writeFileSync(filePath, buffer);

      return { path: filePath, size: buffer.length, format: ext };
    },
  }),

  defineTool({
    name: 'tts_voices',
    description: 'List or search available Cartesia voices.',
    inputSchema: {
      properties: {
        query: { type: 'string', description: 'Search query (e.g. "british", "female", "deep")' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    async handler({ query, limit = 20 }) {
      const params = new URLSearchParams();
      if (query) params.set('q', query);

      const res = await cartesiaRequest('GET', `/voices?${params}`);
      if (!res.ok) throw new Error(`Cartesia ${res.status}: ${await res.text()}`);

      const voices = await res.json();
      return {
        voices: voices.slice(0, limit).map(v => ({
          id: v.id,
          name: v.name,
          description: v.description || '',
          language: v.language || '',
        })),
      };
    },
  }),

  defineTool({
    name: 'tts_voice_info',
    description: 'Get details about a specific Cartesia voice by ID.',
    inputSchema: {
      properties: {
        voice_id: { type: 'string', description: 'Cartesia voice UUID' },
      },
      required: ['voice_id'],
    },
    async handler({ voice_id }) {
      const res = await cartesiaRequest('GET', `/voices/${voice_id}`);
      if (!res.ok) throw new Error(`Cartesia ${res.status}: ${await res.text()}`);
      const v = await res.json();
      return { id: v.id, name: v.name, description: v.description || '', language: v.language || '' };
    },
  }),
]);

server.start();
```

## Tips

- **Browse voices first** — use `tts_voices` to find voices that fit your use case
- **Save voice IDs** — once you find voices you like, save their UUIDs for reuse
- **Emotions match text** — "excited" works best with exciting text, "sad" with somber text
- **Inline tags** — great for dynamic narration with mid-sentence speed/volume/emotion changes
- **Storytelling** — use different voice IDs for different characters
- **File management** — generated files go to `/tmp` by default. Download or move them if needed long-term.
- **Cost** — check Cartesia pricing. Charges are per-character based on the model.
