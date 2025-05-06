# Voice Translator

A minimal demo of real-time voice translation using OpenAI’s Whisper and GPT models over WebSockets. Records your speech in the browser, sends it to a Node.js server for transcription and translation, and plays back the translated text.

## Features
- **Record & translate**: speak until you click **Stop**, then receive translation
- **Transcription**: uses Whisper (`whisper-1`)
- **Translation**: uses GPT (`gpt-4o-mini`)
- **Speech output**: browser SpeechSynthesis API
- **Language selector**: choose target language from `config/languages.json`

## Getting Started
1. Clone the repo and install dependencies:
   ```bash
   npm install

# Voice Translator

Overview of the project...

# from your project root
`npm install`: install deps (if you just cloned or pulled changes)
`npm run dev`: for development with auto-reload
# or…
`npm start`: to run without auto-reload

---

Your PWA will be served at http://localhost:3000 and /ws will be listening for audio chunks.
"# 1_whisper_translator" 
