﻿import OpenAI from "openai";
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

export async function textToSpeech(text) {
  try {
    const resp = await openai.audio.speech.create({
      model: "tts-1",             // ✅ FIXED: use valid TTS model
      voice: "alloy",             // other options: echo, fable, onyx, nova, shimmer
      input: text,
      response_format: "base64"   // get MP3 in base64 format
    });

    if (!resp.data) {
      console.warn("⚠️ textToSpeech returned no data:", resp);
      return "";
    }

    return resp.data;  // base64-encoded MP3
  } catch (err) {
    console.error("❌ textToSpeech error:", err);
    return "";
  }
}
