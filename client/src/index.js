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
  listenWs.addEventListener('message', ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); }
    catch (e) { return console.error('Bad JSON', e, 'data:', data); }

    if (msg.speaker === 'them' && msg.clientId !== CLIENT_ID) {
      const entry = document.createElement('div');
      entry.innerHTML = `
        <hr>
        <p><strong>They said:</strong> ${msg.original}</p>
        <p><strong>Translation:</strong> ${msg.translation}</p>
      `;
      transcript.append(entry);
      transcript.scrollTop = transcript.scrollHeight;

      const utt = new SpeechSynthesisUtterance(msg.translation);
      utt.lang = currentLang;
      speechSynthesis.speak(utt);
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
  sendBtn.addEventListener('click', () => {
    const original    = previewOriginal.value.trim();
    const translation = previewTranslation
                          .textContent
                          .replace(/^Translation:/, '')
                          .trim();

    // Local echo
    const entry = document.createElement('div');
    entry.innerHTML = `
      <hr>
      <p><strong>You said:</strong> ${original}</p>
      <p><strong>Translation:</strong> ${translation}</p>
    `;
    transcript.append(entry);
    transcript.scrollTop = transcript.scrollHeight;

    // Speak
    const utt = new SpeechSynthesisUtterance(translation);
    utt.onend = () => statusElement('Idle');
    speechSynthesis.speak(utt);

    // Broadcast
    console.log('📡 Broadcasting:', { original, translation, clientId: CLIENT_ID });
    listenWs.send(JSON.stringify({ original, translation, clientId: CLIENT_ID }));

    // Reset preview
    statusElement('Idle');
    previewOriginal.value = '';
    previewTranslation.innerHTML = '';
    retranslateBtn.disabled = true;
    sendBtn.disabled = true;
    deleteBtn.disabled = true;
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

    ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.speaker === 'you') {
        previewOriginal.value = msg.original;
        previewTranslation.innerHTML = '';
        retranslateBtn.disabled = false;
        sendBtn.disabled = true;
        deleteBtn.disabled = false;
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

window.addEventListener('load', createUI);
