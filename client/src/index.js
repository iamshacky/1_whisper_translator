// client/src/index.js
console.log('Module loaded: /src/index.js');
import { renderLanguageSelector } from './components/LanguageSelector.js';

const params    = new URLSearchParams(location.search);
const ROOM      = params.get('room') || 'default';
const CLIENT_ID = crypto.randomUUID();
console.log('Using room:', ROOM);

let mediaRecorder;
let audioChunks = [];
let currentLang = 'es';
let listenWs;

console.log('Module loaded: /src/index.js');

// ── load available TTS voices once they’re ready
let availableVoices = speechSynthesis.getVoices();
speechSynthesis.addEventListener('voiceschanged', () => {
  availableVoices = speechSynthesis.getVoices();
});


// — better pickVoice with fallback —
function pickVoice(lang) {
  const voices = availableVoices;
  // exact match e.g. 'es-ES'
  let v = voices.find(v => v.lang.toLowerCase() === lang.toLowerCase());
  if (!v) {
    // prefix match: 'es'
    v = voices.find(v => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
  }
  if (!v) {
    // fallback to the browser default voice
    v = voices.find(v => v.default) || voices[0];
    console.warn(`No TTS voice for "${lang}", falling back to "${v.lang}" (${v.name})`);
  }
  return v;
}

// — unified speak() that sets voice.lang correctly —
function speak(text, onend) {
  const utter = new SpeechSynthesisUtterance(text);
  const v = pickVoice(currentLang);
  utter.voice = v;
  // use the voice's actual BCP-47 locale
  utter.lang = v.lang;
  if (typeof onend === 'function') utter.addEventListener('end', onend);
  speechSynthesis.speak(utter);
  return utter;
}

function createUI() {
  const app = document.getElementById('app');

  //── Language selector ───────────────────────────────────
  const langLabel = document.createElement('label');
  langLabel.textContent = 'Target lang: ';
  const langSel = renderLanguageSelector(langLabel);
  app.append(langLabel);
  langSel.addEventListener('language-change', e => {
    currentLang = e.detail;
    console.log('Language set to', currentLang);
  });

  //── Controls: Start / Stop / Status ──────────────────────
  const startBtn = document.createElement('button');
  startBtn.id = 'start';
  startBtn.textContent = 'Start';
  const stopBtn = document.createElement('button');
  stopBtn.id = 'stop';
  stopBtn.textContent = 'Stop';
  stopBtn.disabled = true;
  const status = document.createElement('div');
  status.id = 'status';
  status.textContent = 'Idle';
  app.append(startBtn, stopBtn, status);

  startBtn.addEventListener('click', startTranslating);
  stopBtn.addEventListener('click', stopTranslating);

  //── Transcript area ────────────────────────────────────
  const transcript = document.createElement('div');
  transcript.id = 'transcript';
  app.append(document.createElement('hr'), transcript);

  //── Preview/Edit area ───────────────────────────────────
  const previewOriginal    = document.createElement('textarea');
  const previewTranslation = document.createElement('div');
  const retranslateBtn     = document.createElement('button');
  const sendBtn            = document.createElement('button');
  const deleteBtn          = document.createElement('button');

  previewOriginal.id = 'previewOriginal';
  previewOriginal.rows = 3;
  previewOriginal.style.width = '100%';

  retranslateBtn.id = 'retranslateBtn';
  retranslateBtn.textContent = 'Edit';
  retranslateBtn.disabled = true;

  sendBtn.id = 'sendBtn';
  sendBtn.textContent = 'Send';
  sendBtn.disabled = true;

  deleteBtn.id = 'deleteBtn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.disabled = true;

  previewOriginal.addEventListener('input', () => {
    const txt = previewOriginal.value.trim();
    retranslateBtn.disabled = !txt;
    deleteBtn.disabled     = !txt;
    previewTranslation.innerHTML = '';
    sendBtn.disabled = !txt;  // send available immediately
    statusElement(txt ? 'Preview' : 'Idle');
  });

  sendBtn.onclick = () => {
  const text = previewOriginal.value.trim();
  const html = previewTranslation.innerHTML;
  const match = html.match(/>([^<]+)<\/strong>:\s*(.*?)</);
  const translation = match ? match[2] : '';
  const audioEl = document.getElementById('previewAudio');
  const audio = audioEl ? audioEl.src.split(',')[1] : '';
  sendFinalMessage(text, translation, audio);
  previewOriginal.value = '';
  previewTranslation.innerHTML = '';
  retranslateBtn.disabled = true;
  sendBtn.disabled = true;
  deleteBtn.disabled = true;
  statusElement('Idle');
  };

  const previewContainer = document.createElement('div');
  previewContainer.style.border = '1px solid #ccc';
  previewContainer.style.padding = '8px';
  previewContainer.style.margin = '8px 0';
  previewContainer.append(
    document.createElement('h3'),
    previewOriginal,
    previewTranslation,
    retranslateBtn,
    sendBtn,
    deleteBtn
  );
  previewContainer.querySelector('h3').textContent = 'Preview';
  app.append(previewContainer);

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  listenWs = new WebSocket(
    `${proto}//${location.host}/ws?room=${ROOM}&lang=${currentLang}&clientId=${CLIENT_ID}`
  );

  // we only ever use this one for text broadcasts
  listenWs.binaryType = 'arraybuffer';

  listenWs.addEventListener('open', () => {
    console.log('🔔 [listenWs] connected');
  });

  listenWs.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);

    if (msg.speaker === 'you') {
      previewOriginal.value = msg.original;

      // if we got server-generated audio, wire up the <audio> tag…
      if (msg.audio) {
        previewTranslation.innerHTML = `
          <p>
            <strong>Translation:</strong> ${msg.translation}
            <button id="playPreviewBtn">🔊 Play</button>
            <audio id="previewAudio"
                  src="data:audio/mpeg;base64,${msg.audio}">
            </audio>
          </p>
        `;
        document
          .getElementById('playPreviewBtn')
          .addEventListener('click', () =>
            document.getElementById('previewAudio').play()
          );
      }
      // …otherwise fall back to the browser TTS…
      else {
        previewTranslation.innerHTML = `
          <p>
            <strong>Translation:</strong> ${msg.translation}
            <button id="playPreviewBtn">🔊 Play</button>
          </p>
        `;
        document
          .getElementById('playPreviewBtn')
          .addEventListener('click', () =>
            speak(msg.translation)
          );
      }

      // enable your preview/Edit buttons here…
      retranslateBtn.disabled = false;
      sendBtn.disabled       = false;
      deleteBtn.disabled     = false;
      toggleButtons({ start: false, stop: true });
      statusElement('Preview');
    }


    else if (msg.speaker === 'them' && msg.clientId !== CLIENT_ID) {
      // —— BROADCAST CHAT —— 
      let audioHtml = '';
      if (msg.audio) {
        audioHtml = `
          <button class="play-btn">🔊 Play</button>
          <audio class="chat-audio"
                 src="data:audio/mpeg;base64,${msg.audio}"></audio>
        `;
      }
      const entry = document.createElement('div');
      entry.innerHTML = `
        <hr>
        <p><strong>They said:</strong> ${msg.original}</p>
        <p><strong>Translation:</strong> ${msg.translation}</p>
        ${audioHtml}
      `;
      transcript.append(entry);

      if (msg.audio) {
        entry.querySelector('.play-btn').addEventListener('click', () =>
          entry.querySelector('.chat-audio').play()
        );
      }
    }
  });

  //── Recording → send binary over the same socket ──────────
  /*
  async function sendToWhisper(blob) {
    statusElement('Transcribing…');
    listenWs.send(blob);
  }
  */




   //── Recording → NEW ephemeral socket for preview ───────────
   async function sendToWhisper(blob) {
     statusElement('Transcribing…');
 
     const previewWs = new WebSocket(
       `${proto}//${location.host}/ws?room=${ROOM}&lang=${currentLang}&clientId=${CLIENT_ID}`
     );
     previewWs.binaryType = 'arraybuffer';
 
     previewWs.addEventListener('open', () => {
       console.log('[sendToWhisper] WS open – sending audio blob');
       previewWs.send(blob);
     });
 
     previewWs.addEventListener('message', ({ data }) => {
       const msg = JSON.parse(data);
       if (msg.speaker === 'you') {
          previewOriginal.value = msg.original;

          // if we got server-generated audio, wire up the <audio> tag…
          if (msg.audio) {
            previewTranslation.innerHTML = `
              <p>
                <strong>Translation:</strong> ${msg.translation}
                <button id="playPreviewBtn">🔊 Play</button>
                <audio id="previewAudio"
                      src="data:audio/mpeg;base64,${msg.audio}">
                </audio>
              </p>
            `;
            document
              .getElementById('playPreviewBtn')
              .addEventListener('click', () =>
                document.getElementById('previewAudio').play()
              );
          }
          // …otherwise fall back to the browser TTS…
          else {
            previewTranslation.innerHTML = `
              <p>
                <strong>Translation:</strong> ${msg.translation}
                <button id="playPreviewBtn">🔊 Play</button>
              </p>
            `;
            document
              .getElementById('playPreviewBtn')
              .addEventListener('click', () =>
                speak(msg.translation)
              );
          }

          // enable your preview/Edit buttons here…
          retranslateBtn.disabled = false;
          sendBtn.disabled       = false;
          deleteBtn.disabled     = false;
          toggleButtons({ start: false, stop: true });
          statusElement('Preview');

 
         // done with this socket
         previewWs.close();
       }
     });
 
     previewWs.addEventListener('error', err => {
       console.error('[sendToWhisper] WS error', err);
       statusElement('Error');
     });
   }

  //── Recording controls ──────────────────────────────────
  async function startTranslating() {
    console.log('Start clicked, lang=', currentLang);
    statusElement('Recording…');
    audioChunks = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.addEventListener('dataavailable', e => audioChunks.push(e.data));
      mediaRecorder.addEventListener('stop', () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        sendToWhisper(blob);
      });
      mediaRecorder.start();
      toggleButtons({ start: true, stop: false });
    } catch (err) {
      console.error('Error starting recording', err);
      statusElement('Error');
    }
  }

  function stopTranslating() {
    console.log('Stop clicked');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    statusElement('Transcribing…');
    toggleButtons({ stop: true });
  }
}

function statusElement(txt) {
  document.getElementById('status').textContent = txt;
}
function toggleButtons({ start, stop }) {
  if (start !== undefined) document.getElementById('start').disabled = start;
  if (stop  !== undefined) document.getElementById('stop').disabled  = stop;
}

function sendFinalMessage(text, translation, audio) {
  const msg = {
    type: 'final',
    speaker: 'them',  // optional – just for clarity
    clientId: CLIENT_ID,
    original: text,
    translation,
    audio,
  };
  listenWs.send(JSON.stringify(msg));
  console.log('[sendFinalMessage] Sent final message:', msg);
}

// wait for the voices to be ready before building the UI
window.addEventListener('load', async () => {
  await new Promise(resolve => {
    const vs = speechSynthesis.getVoices();
    if (vs.length) return resolve();
    speechSynthesis.addEventListener('voiceschanged', resolve, { once: true });
  });
  availableVoices = speechSynthesis.getVoices();
  console.log('Available TTS voices:', availableVoices);
  createUI();
});
