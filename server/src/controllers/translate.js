
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

  // 3) Generate TTS MP3 (base64), but don’t crash if it fails
   let audio;
   try {
     audio = await textToSpeech(translation);
   } catch (err) {
     console.error('❌ [translateController] textToSpeech failed:', err);
     audio = null;
   }
 
   console.log('→ [translateController] text:', text);
   console.log('→ [translateController] translation:', translation);
   if (typeof audio === 'string') {
     console.log('→ [translateController] audio length:', audio.length);
   } else {
     console.warn('⚠️ [translateController] no audio returned from TTS');
   }

  return { text, translation, audio };
}