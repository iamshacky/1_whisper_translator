import OpenAI from "openai";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import os from "os";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Transcribe raw audio buffer via Whisper
 * @param {Buffer} audioBuffer
 * @returns {Promise<string>}
 */
export async function transcribeAudio(audioBuffer) {
  // 1) Write buffer to a temp .webm file
  const tempDir = os.tmpdir();
  const filename = `audio-${Date.now()}.webm`;
  const filepath = path.join(tempDir, filename);
  await fs.promises.writeFile(filepath, audioBuffer);

  try {
    // 2) Stream the file into the multipart form
    const resp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filepath),
      model: "whisper-1",
    });
    // The v4 SDK returns an object with a `.text` property
    return resp.text;
  } finally {
    // 3) Clean up the temp file
    fs.promises.unlink(filepath).catch(() => {});
  }
}

/**
 * Translate text to the target language
 * @param {string} text
 * @param {string} targetLang  e.g. "es", "de"
 * @returns {Promise<string>}
 */
export async function translateText(text, targetLang) {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Translate the following to ${targetLang} (preserve meaning).`,
      },
      { role: "user", content: text },
    ],
  });
  return resp.choices[0].message.content;
}


// at the bottom of server/src/services/openaiService.js
/**
 * Turn text into an audio file via OpenAI TTS (gpt-4o-mini-tts)
 * @param {string} text
 * @returns {Promise<string>}  base64-encoded MP3
 */
export async function textToSpeech(text) {
  const resp = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",          // pick any supported voice
    input: text,
  });
  // `.data` is a base64 string of the MP3
  return resp.data;
}

