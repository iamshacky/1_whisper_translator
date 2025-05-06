
import { transcribeAudio, translateText } from '../services/openaiService.js';

/**
 * Given an audio buffer and desired language, return both original text and translation
 * @param {Buffer} audioBuffer
 * @param {string} targetLang
 * @returns {Promise<{ text: string, translation: string }>}
 */
export async function translateController(audioBuffer, targetLang = 'es') {
  // 1) Transcribe
  const text = await transcribeAudio(audioBuffer);

  // 2) Translate
  const translation = await translateText(text, targetLang);

  return { text, translation };
}
