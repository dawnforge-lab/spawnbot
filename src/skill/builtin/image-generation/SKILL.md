---
name: image-generation
description: "Generate images using fal.ai API. Use when the user asks you to create, generate, or make an image, picture, photo, illustration, or visual content."
---

# Image Generation with fal.ai

Generate images using fal.ai's API. Supports multiple models including fast turbo generation.

## API Overview

fal.ai uses a queue-based API: submit a request, poll for status, fetch the result.

### Endpoint

```
POST https://queue.fal.run/{model-id}
```

Popular models:
- `fal-ai/flux/schnell` — Fast, high quality (recommended default)
- `fal-ai/flux/dev` — Higher quality, slower
- `fal-ai/flux-pro/v1.1-ultra` — Ultra high quality, slowest

### Authentication

Use the `FAL_API_KEY` environment variable:
```
Authorization: Key ${FAL_API_KEY}
```

### Submit Request

```typescript
const response = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
  method: "POST",
  headers: {
    "Authorization": `Key ${process.env.FAL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: "a cat sitting on a windowsill at sunset",
    image_size: "landscape_4_3",
    num_inference_steps: 4,
  }),
})
const { request_id, status_url, response_url } = await response.json()
```

### Poll for Completion

```typescript
const status = await fetch(status_url, {
  headers: { "Authorization": `Key ${process.env.FAL_API_KEY}` },
}).then(r => r.json())
// status.status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
```

Poll every 2-3 seconds. Timeout after 180 seconds.

### Fetch Result

```typescript
const result = await fetch(response_url, {
  headers: { "Authorization": `Key ${process.env.FAL_API_KEY}` },
}).then(r => r.json())
const imageUrl = result.images[0].url
```

## Image Sizes

- `landscape_4_3` (default)
- `landscape_16_9`
- `square_hd`
- `square`
- `portrait_4_3`
- `portrait_16_9`

## LoRA Support

To use a custom LoRA model, add to the request body:
```json
{
  "loras": [{ "path": "https://url-to-lora-weights.safetensors", "scale": 1.0 }]
}
```

The agent owner may configure a LoRA URL in their SOUL.md or .env for consistent character/style generation.

## Prompting Tips

- Be specific and descriptive: lighting, mood, style, composition
- Specify art style when relevant: "digital art", "oil painting", "photograph", "watercolor"
- Include technical details for photos: "shot on 35mm", "shallow depth of field", "golden hour"
- Keep prompts under 200 words for best results

## Creating the Tool

When you need image generation, use the `create-tool` skill to build a `fal-generate` tool in `.spawnbot/tools/`. The tool should:

1. Read `FAL_API_KEY` from `process.env`
2. Accept `prompt`, `size` (optional), and `model` (optional) arguments
3. Submit to fal.ai queue API
4. Poll until complete (2s interval, 180s timeout)
5. Return the image URL
6. If sending to Telegram, use `tg_photo` with the returned URL
