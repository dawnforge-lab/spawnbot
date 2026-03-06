# Fal.ai Image Generation

How to create an MCP server for generating images using the Fal.ai API.

## Overview

Fal.ai provides fast image generation via a queue-based API. Submit a request, poll for status, then fetch the result. Supports multiple models, sizes, and optional LoRA customization layers.

## Environment Variables

```
FAL_API_KEY  — API key from fal.ai (get one at https://fal.ai/dashboard/keys)
```

Register when creating the server:
```
tool_create({
  name: "fal-image",
  code: "<full source>",
  env: { FAL_API_KEY: "${FAL_API_KEY}" }
})
```

## API Pattern: Queue-Based Generation

Fal.ai uses a 3-step queue pattern:

1. **Submit** — POST request to queue endpoint, get a `request_id`
2. **Poll** — GET status URL until `COMPLETED` or `FAILED`
3. **Result** — GET response URL to fetch the generated image

## API Helpers

```js
const FAL_API_KEY = process.env.FAL_API_KEY;
const POLL_INTERVAL = 3000; // 3 seconds
const TIMEOUT = 180000;     // 3 minutes

async function falRequest(method, url, body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Fal API ${res.status}: ${err}`);
  }
  return res.json();
}

async function submitJob(model, input) {
  const url = `https://queue.fal.run/${model}`;
  return await falRequest('POST', url, input);
}

async function pollStatus(statusUrl) {
  return await falRequest('GET', statusUrl);
}

async function getResult(responseUrl) {
  return await falRequest('GET', responseUrl);
}

async function generateImage(model, input) {
  // Submit
  const job = await submitJob(model, input);

  // Poll until complete
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT) {
    const status = await pollStatus(job.status_url);

    if (status.status === 'COMPLETED') {
      const result = await getResult(job.response_url);
      return result;
    }

    if (status.status === 'FAILED') {
      throw new Error(status.error || 'Generation failed');
    }

    // Wait before next poll
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error('Generation timed out');
}
```

## Models

### Fast Generation (Turbo)

```js
// fal-ai/flux/schnell — fast, good quality
const result = await generateImage('fal-ai/flux/schnell', {
  prompt: 'A sunset over mountains, photorealistic',
  image_size: 'landscape_4_3',
  num_inference_steps: 4,
  num_images: 1,
});
const imageUrl = result.images[0].url;
```

### High Quality

```js
// fal-ai/flux/dev — slower, higher quality
const result = await generateImage('fal-ai/flux/dev', {
  prompt: 'A sunset over mountains, photorealistic',
  image_size: 'landscape_4_3',
  num_inference_steps: 28,
  num_images: 1,
});
```

### With LoRA (Custom Styles/Characters)

```js
// fal-ai/flux/dev/lora — with custom LoRA weights
const result = await generateImage('fal-ai/flux/dev/lora', {
  prompt: 'portrait of a character, studio lighting',
  image_size: 'portrait_4_3',
  num_inference_steps: 28,
  num_images: 1,
  loras: [
    {
      path: 'https://example.com/my-lora-weights.safetensors',
      scale: 1.0,
    },
  ],
});
```

### Image Sizes

Available `image_size` values:
- `square` (512x512)
- `square_hd` (1024x1024)
- `landscape_4_3`
- `landscape_16_9`
- `portrait_4_3`
- `portrait_16_9`

## Complete MCP Server Example

```js
import { McpServer } from '../../lib/mcp/base-server.js';
import { defineTool } from '../../lib/mcp/tool.js';

const FAL_API_KEY = process.env.FAL_API_KEY;
const POLL_INTERVAL = 3000;
const TIMEOUT = 180000;

async function falRequest(method, url, body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Fal API ${res.status}: ${err}`);
  }
  return res.json();
}

async function generateImage(model, input) {
  const job = await falRequest('POST', `https://queue.fal.run/${model}`, input);
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT) {
    const status = await falRequest('GET', job.status_url);
    if (status.status === 'COMPLETED') return await falRequest('GET', job.response_url);
    if (status.status === 'FAILED') throw new Error(status.error || 'Generation failed');
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error('Generation timed out');
}

const server = new McpServer({ name: 'fal-image', version: '0.1.0' });

server.addTools([
  defineTool({
    name: 'image_generate',
    description: 'Generate an image from a text prompt using Fal.ai. Returns the image URL.',
    inputSchema: {
      properties: {
        prompt: { type: 'string', description: 'Image description' },
        size: {
          type: 'string',
          description: 'Image size: square, square_hd, landscape_4_3, landscape_16_9, portrait_4_3, portrait_16_9',
        },
        model: {
          type: 'string',
          description: 'Model: fal-ai/flux/schnell (fast), fal-ai/flux/dev (quality). Default: fal-ai/flux/schnell',
        },
        steps: { type: 'number', description: 'Inference steps (schnell: 1-4, dev: 20-50). Default: 4' },
      },
      required: ['prompt'],
    },
    async handler({ prompt, size = 'landscape_4_3', model = 'fal-ai/flux/schnell', steps = 4 }) {
      const result = await generateImage(model, {
        prompt,
        image_size: size,
        num_inference_steps: steps,
        num_images: 1,
      });
      return {
        url: result.images[0].url,
        width: result.images[0].width,
        height: result.images[0].height,
        model,
      };
    },
  }),

  defineTool({
    name: 'image_generate_lora',
    description: 'Generate an image with a custom LoRA style/character applied.',
    inputSchema: {
      properties: {
        prompt: { type: 'string', description: 'Image description' },
        lora_url: { type: 'string', description: 'URL to LoRA weights (.safetensors file)' },
        lora_scale: { type: 'number', description: 'LoRA influence strength (0.0-2.0, default 1.0)' },
        size: { type: 'string', description: 'Image size (default: portrait_4_3)' },
        steps: { type: 'number', description: 'Inference steps (default: 28)' },
      },
      required: ['prompt', 'lora_url'],
    },
    async handler({ prompt, lora_url, lora_scale = 1.0, size = 'portrait_4_3', steps = 28 }) {
      const result = await generateImage('fal-ai/flux/dev/lora', {
        prompt,
        image_size: size,
        num_inference_steps: steps,
        num_images: 1,
        loras: [{ path: lora_url, scale: lora_scale }],
      });
      return {
        url: result.images[0].url,
        width: result.images[0].width,
        height: result.images[0].height,
      };
    },
  }),
]);

server.start();
```

## Tips

- **Speed vs quality**: `flux/schnell` generates in ~5s with 4 steps. `flux/dev` takes 30-60s with 28 steps but produces higher quality.
- **Queue position**: During high load, jobs queue. The poll status includes `queue_position`.
- **Timeout**: 3 minutes is generous. Most generations complete in under 60 seconds.
- **Image URLs**: Generated image URLs are temporary (hosted on Fal CDN). Download or re-host if you need them long-term.
- **LoRA**: Custom LoRA weights must be publicly accessible `.safetensors` files. Use for consistent character/style generation.
- **Safety**: Fal.ai has an optional safety checker. Add `enable_safety_checker: true` to the input if needed.
- **Multiple images**: Set `num_images` to generate multiple images in one request.
- **Cost**: Check fal.ai pricing — charges are per-generation based on model and resolution.
