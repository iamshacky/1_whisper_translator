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

  //── Always listen for broadcasts ────────────────────────
  const proto    = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const listenWs = new WebSocket(
    `${proto}//${location.host}/ws?room=${ROOM}&lang=${currentLang}&clientId=${CLIENT_ID}`
  );
  listenWs.binaryType = 'arraybuffer';

  listenWs.addEventListener('open', () => {
    console.log('🔔 [listenWs] connected, listening for others in room:', ROOM);
  });

  // …after you’ve created & opened your `listenWs`…
  listenWs.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.speaker === 'them' && msg.clientId !== CLIENT_ID) {
      const entry = document.createElement('div');
      entry.innerHTML = `
        <hr>
        <p><strong>They said:</strong> ${msg.original}</p>
        <p>
          <strong>Translation:</strong> ${msg.translation}
          <button class="play-btn">🔊</button>
        </p>
      `;
      transcript.append(entry);
      entry.querySelector('.play-btn').addEventListener('click', () => {
        const u = new SpeechSynthesisUtterance(msg.translation);
        u.lang = currentLang;
        const v = pickVoice(currentLang);
        if (v) u.voice = v;
        speechSynthesis.speak(u);
      });
    }
  });
  
  //── Preview → re-translate/Edit ────────────────────────
  retranslateBtn.addEventListener('click', async () => {
    const edited = previewOriginal.value.trim();
    if (!edited) return;
    statusElement('Translating…');
    try {
      const resp = await fetch('/api/translate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: edited, lang: currentLang })
      });
      if (!resp.ok) throw new Error(resp.status);
      const { translation } = await resp.json();
      previewTranslation.innerHTML = `<p><strong>Translation:</strong> ${translation}</p>`;
      statusElement('Preview');
      sendBtn.disabled = false;
    } catch (err) {
      console.error('Translate error', err);
      statusElement('Error');
    }
  });

  //── Delete preview ──────────────────────────────────────
  deleteBtn.addEventListener('click', () => {
    statusElement('Idle');
    previewOriginal.value = '';
    previewTranslation.innerHTML = '';
    retranslateBtn.disabled = true;
    sendBtn.disabled = true;
    deleteBtn.disabled = true;
  });

  //── Send final message ──────────────────────────────────
  //── Send final message (auto-translate if needed) ───────────────────
  sendBtn.addEventListener('click', async () => {
    const original = previewOriginal.value.trim();
    let translation = previewTranslation.textContent
                          .replace(/^Translation:/, '')
                          .trim();
 
    // if the server-side preview didn’t fill it, do one more translate step
    if (!translation) {
      statusElement('Translating…');
      try {
        const resp = await fetch('/api/translate-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: original, lang: currentLang })
        });
        if (!resp.ok) throw new Error(resp.status);
        const { translation: tx } = await resp.json();
        translation = tx;
        previewTranslation.innerHTML = `<p><strong>Translation:</strong> ${translation}</p>`;
      } catch (err) {
        console.error('Translate error', err);
        return statusElement('Error');
      }
    }
 
    // 1) Local echo …
    const entry = document.createElement('div');
    entry.innerHTML = `
      <hr>
      <p><strong>You said:</strong> ${original}</p>
      <p><strong>Translation:</strong> ${translation}</p>
    `;
    transcript.append(entry);
    transcript.scrollTop = transcript.scrollHeight;
 
    // 2) TTS under the click gesture
    speak(translation, () => statusElement('Idle'));
 
    // 3) Broadcast to others
    listenWs.send(JSON.stringify({ original, translation, clientId: CLIENT_ID }));
 
    // 4) Reset preview
    statusElement('Idle');
    previewOriginal.value        = '';
    previewTranslation.innerHTML = '';
    retranslateBtn.disabled      = true;
    sendBtn.disabled             = true;
    deleteBtn.disabled           = true;
  });
 
  //── Inside createUI: only one sendToWhisper ─────────────
  async function sendToWhisper(blob) {
    statusElement('Transcribing…');
    const ws = new WebSocket(
      `${proto}//${location.host}/ws?room=${ROOM}&lang=${currentLang}&clientId=${CLIENT_ID}`
    );
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      console.log('WS open – sending audio blob');
      ws.send(blob);
    });

    /*
    ws.addEventListener('message', ({ data }) => {
      console.log('[sendToWhisper] got preview:', data);
      const msg = JSON.parse(data);
      if (msg.speaker === 'you') {
        // 1) show Whisper’s text
        previewOriginal.value = msg.original;

        // 2) show GPT translation immediately
        previewTranslation.innerHTML =
          `<p><strong>Translation:</strong> ${msg.translation}</p>`;

        // 3) enable buttons only once we have translation
        retranslateBtn.disabled = false;
        sendBtn.disabled       = false;
        deleteBtn.disabled     = false;

        toggleButtons({ start: false, stop: true });
        statusElement('Preview');
        ws.close();
      }
    });
    */
    ws.addEventListener('message', ({ data }) => {
      console.log('[sendToWhisper] got preview:', data);
      const msg = JSON.parse(data);
      if (msg.speaker === 'you') {
        // 1) show Whisper’s text
        previewOriginal.value = msg.original;

        // 2) show GPT translation + Play button
        previewTranslation.innerHTML = `
          <p><strong>Translation:</strong> ${msg.translation}
            <button id="playPreviewBtn" title="Play preview">🔊</button>
          </p>
        `;

        // wire up the preview play button under a click gesture
        previewTranslation
          .querySelector('#playPreviewBtn')
          .addEventListener('click', () => speak(msg.translation));

        // 3) enable buttons now that translation exists
        retranslateBtn.disabled = false;
        sendBtn.disabled       = false;
        deleteBtn.disabled     = false;

        toggleButtons({ start: false, stop: true });
        statusElement('Preview');
        ws.close();
      }
    });



    ws.addEventListener('error', err => {
      console.error('WS error', err);
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
