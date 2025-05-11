// client/src/index.js
console.log('Module loaded: /src/index.js');
import { renderLanguageSelector } from './components/LanguageSelector.js';

// ── Join the same “room” across devices ───────────────────────────────────
//const params = new URLSearchParams(window.location.search);
//const ROOM   = params.get('room') || 'default';

const params = new URLSearchParams(location.search);
const ROOM   = params.get('room') || 'default';
// a stable per-page UUID. Modern browsers support this:
const CLIENT_ID = crypto.randomUUID();


console.log('Using room:', ROOM);

let mediaRecorder;
let audioChunks = [];
let currentLang = 'es';

function createUI() {
  const app = document.getElementById('app');

  // --- Language selector ---
  const langLabel = document.createElement('label');
  langLabel.textContent = 'Target lang: ';
  const langSel = renderLanguageSelector(langLabel);
  app.append(langLabel);
  langSel.addEventListener('language-change', e => {
    currentLang = e.detail;
    console.log('Language set to', currentLang);
  });

  // --- Controls: Start / Stop / Status ---
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

  // --- Transcript area ---
  const transcriptContainer = document.createElement('div');
  transcriptContainer.id = 'transcriptContainer';
  const transcriptTitle = document.createElement('h3');
  transcriptTitle.textContent = 'Transcript';
  const transcript = document.createElement('div');
  transcript.id = 'transcript';
  transcriptContainer.append(transcriptTitle, transcript);
  app.append(transcriptContainer);

  // --- Preview area ---
  const previewContainer = document.createElement('div');
  previewContainer.id = 'previewContainer';
  previewContainer.style.border = '1px solid #ccc';
  previewContainer.style.padding = '8px';
  previewContainer.style.margin = '8px 0';

  const previewTitle = document.createElement('h3');
  previewTitle.textContent = 'Preview';
  const previewOriginal = document.createElement('textarea');
  previewOriginal.id = 'previewOriginal';
  previewOriginal.rows = 3;
  previewOriginal.style.width = '100%';


  // --- allow manual edits to kick off re-translate/delete ---
  previewOriginal.addEventListener('input', () => {
    const txt = previewOriginal.value.trim();
    retranslateBtn.disabled = !txt;
    deleteBtn.disabled     = !txt;
    // clear any old translation, disable final Send
    previewTranslation.innerHTML = '';
    sendBtn.disabled = true;
    // update status so user knows they can re-translate
    document.getElementById('status').textContent = txt ? 'Preview' : 'Idle';
 });
  const previewTranslation = document.createElement('div');
  previewTranslation.id = 'previewTranslation';

  const retranslateBtn = document.createElement('button');
  retranslateBtn.id = 'retranslateBtn';
  retranslateBtn.textContent = 'Re-Translate';
  retranslateBtn.disabled = true;

  const sendBtn = document.createElement('button');
  sendBtn.id = 'sendBtn';
  sendBtn.textContent = 'Send';
  sendBtn.disabled = true;

  const deleteBtn = document.createElement('button');
  deleteBtn.id = 'deleteBtn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.disabled = true;

  previewContainer.append(
    previewTitle,
    previewOriginal,
    previewTranslation,
    retranslateBtn,
    sendBtn,
    deleteBtn
  );
  app.append(previewContainer);

  // ── Always listen for others in the same room ───────────────────────────────────────────────────
  const proto   = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const listenWs = new WebSocket(
    `${proto}//${location.host}/ws`
    + `?room=${ROOM}&lang=${currentLang}&clientId=${CLIENT_ID}`
  );

  // (A) Confirm it really opened
  listenWs.addEventListener('open', () => {
    console.log('🔔 [listenWs] connected, listening for others in room:', ROOM);
  });
  listenWs.addEventListener('close', () => {
    console.warn('🔔 [listenWs] closed; please refresh to rejoin');
  });

  // (B) Log EVERYTHING we get, then parse & render
  listenWs.addEventListener('message', ({ data }) => {
    console.log('[DEBUG][listenWs] raw data:', data);

    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.error('[DEBUG][listenWs] parse error:', e, '– data was:', data);
      return;
    }
    console.log('[DEBUG][listenWs] parsed msg:', msg);

    if (msg.speaker === 'them' && msg.clientId !== CLIENT_ID) {
      const transcriptDiv = document.getElementById('transcript');
      const entry = document.createElement('div');
      entry.innerHTML = `
        <hr>
        <p><strong>They said:</strong> ${msg.original}</p>
        <p><strong>Translation:</strong> ${msg.translation}</p>
      `;
      transcriptDiv.append(entry);
      transcriptDiv.scrollTop = transcriptDiv.scrollHeight;

      const utter = new SpeechSynthesisUtterance(msg.translation);
      utter.lang = currentLang;
      speechSynthesis.speak(utter);
    }
  });


  retranslateBtn.addEventListener('click', async () => {
    const edited = previewOriginal.value.trim();
    console.log('[DEBUG] Re-translate clicked, text=', edited);
    if (!edited) return;
    status.textContent = 'Translating…';
    try {
      const resp = await fetch('/api/translate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: edited, lang: currentLang })
      });
      if (!resp.ok) {
        console.error('[DEBUG] /api/translate-text HTTP error', resp.status);
        status.textContent = 'Error';
        return;
      }
      const { translation } = await resp.json();
      console.log('[DEBUG] Translation received:', translation);
      previewTranslation.innerHTML = `<p><strong>Translation:</strong> ${translation}</p>`;
      status.textContent = 'Preview';
      console.log('[DEBUG] Enabling Send button');
      // force-enable it two ways
      sendBtn.disabled = false;
      sendBtn.removeAttribute('disabled');
    } catch (err) {
      console.error('[DEBUG] Translate API error', err);
      status.textContent = 'Error';
    }
  });

  // ── SENDER — transcribe → preview via a separate WS ───────────────────
  async function sendToWhisper(blob) {
    statusElement('Transcribing…');
    const ws = new WebSocket(
      `${proto}//${location.host}/ws`
      + `?room=${ROOM}&lang=${currentLang}&clientId=${CLIENT_ID}`
    );
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      console.log('WS open – sending audio blob');
      ws.send(blob);
    });

    ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.speaker === 'you') {
        showPreview(msg.original);
        ws.close();
      }
    });

    ws.addEventListener('error', err => {
      console.error('WS error', err);
      statusElement('Error');
    });
  }

  sendBtn.addEventListener('click', () => {
    const original    = previewOriginal.value.trim();
    const translation = previewTranslation.textContent.replace(/^Translation:/, '').trim();

    // 1) Append local entry
    const entry = document.createElement('div');
    entry.innerHTML = `
      <hr>
      <p><strong>You said:</strong> ${original}</p>
      <p><strong>Translation:</strong> ${translation}</p>
    `;
    transcript.append(entry);
    transcript.scrollTop = transcript.scrollHeight;

    // 2) Speak it out
    const utter = new SpeechSynthesisUtterance(translation);
    utter.onend = () => { status.textContent = 'Idle'; };
    speechSynthesis.speak(utter);

    // 3) BROADCAST to the room via your listening WS
    console.log('[DEBUG] Broadcasting via listenWs:', {
      original, translation, clientId: CLIENT_ID
    });
    listenWs.send(JSON.stringify({
      original,
      translation,
      clientId: CLIENT_ID
    }));

    // 4) Reset preview UI
    previewOriginal.value     = '';
    previewTranslation.innerHTML = '';
    retranslateBtn.disabled   = true;
    sendBtn.disabled          = true;
    deleteBtn.disabled        = true;
  });


  deleteBtn.addEventListener('click', () => {
    status.textContent = 'Idle';
    previewOriginal.value = '';
    previewTranslation.innerHTML = '';
    retranslateBtn.disabled = true;
    sendBtn.disabled = true;
    deleteBtn.disabled = true;
  });
}

async function startTranslating() {
  console.log('Start clicked, lang=', currentLang);
  statusElement('Recording…');
  audioChunks = [];

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener('dataavailable', e => {
      audioChunks.push(e.data);
    });
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

function sendToWhisper(blob) {
  statusElement('Transcribing…');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(
   `${proto}//${location.host}/ws?room=${ROOM}&lang=${currentLang}&clientId=${CLIENT_ID}`
  );

  console.log('🔊 [sendToWhisper] connecting to', ws.url);

  console.log('Opening send WS to:', ws.url);

  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    console.log('WS open – sending audio blob');
    console.log('🔔 Listening for others in room:', ROOM);
    ws.send(blob);
  });

  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    // If it's your own transcription, go into preview/edit mode
    if (msg.speaker === 'you') {
      showPreview(msg.original);
      ws.close();
      return;
    }
  });

  ws.addEventListener('error', err => {
    console.error('WS error', err);
    statusElement('Error');
  });
}

function showPreview(originalText) {
  statusElement('Preview');
  document.getElementById('previewOriginal').value = originalText;
  document.getElementById('previewTranslation').innerHTML = '';
  document.getElementById('retranslateBtn').disabled = false;
  document.getElementById('sendBtn').disabled = true;
  document.getElementById('deleteBtn').disabled = false;
  toggleButtons({ start: false, stop: true });
}

function statusElement(text) {
  document.getElementById('status').textContent = text;
}

function toggleButtons({ start, stop }) {
  if (start !== undefined) document.getElementById('start').disabled = start;
  if (stop  !== undefined) document.getElementById('stop').disabled  = stop;
}

window.addEventListener('load', createUI);
