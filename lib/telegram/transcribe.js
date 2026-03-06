/**
 * Voice transcription via OpenAI Whisper API.
 *
 * Optional — if OPENAI_API_KEY is not set, transcription is unavailable
 * and voice messages are described as text instead.
 */

/**
 * Check if Whisper transcription is available.
 * @returns {boolean}
 */
export function isWhisperEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Transcribe audio buffer using OpenAI Whisper API.
 * @param {Buffer} audioBuffer - Audio file data (OGG, MP3, WAV, etc.)
 * @param {string} filename - Original filename (e.g. "voice.ogg")
 * @returns {Promise<string>} Transcribed text
 */
export async function transcribeAudio(audioBuffer, filename) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set — voice transcription unavailable');
  }

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer]), filename);
  formData.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper API error: ${response.status} ${error}`);
  }

  const result = await response.json();
  return result.text;
}
