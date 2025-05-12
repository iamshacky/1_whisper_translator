
import { transcribeAudio, translateText } from '../services/openaiService.js';

/**
 * Given an audio buffer and desired language, return both original text and translation
 * @param {Buffer} audioBuffer
 * @param {string} targetLang
 * @returns {Promise<{ text: string, translation: string, audio: string }>}
 */

import { textToSpeech } from '../services/openaiService.js';

export async function translateController(audioBuffer, targetLang = 'es') {
  // 1) Transcribe
  const text = await transcribeAudio(audioBuffer);

  // 2) Translate
  const translation = await translateText(text, targetLang);

  // 3) Generate TTS MP3 (base64)
  const audio = await textToSpeech(translation);

  console.log('→ [translateController] text:', text);
  console.log('→ [translateController] translation:', translation);
  console.log('→ [translateController] audio length:', audio.length);

  return { text, translation, audio };
}