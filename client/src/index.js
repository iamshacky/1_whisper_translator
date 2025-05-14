console.log('Module loaded: /src/index.js');
import { renderLanguageSelector } from './components/LanguageSelector.js';

const params = new URLSearchParams(location.search);
const ROOM = params.get('room') || 'default';
const CLIENT_ID = crypto.randomUUID();
console.log('Using room:', ROOM);

let mediaRecorder;
let audioChunks = [];
let currentLang = 'es';
let listenWs;

let previewOriginal, previewTranslation, retranslateBtn, sendBtn, deleteBtn;

let availableVoices = speechSynthesis.getVoices();
speechSynthesis.addEventListener('voiceschanged', () => {
  availableVoices = speechSynthesis.getVoices();
});

function pickVoice(lang) {
  const voices = availableVoices;
  let v = voices.find(v => v.lang.toLowerCase() === lang.toLowerCase());
  if (!v) {
    v = voices.find(v => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
  }
  if (!v) {
    v = voices.find(v => v.default) || voices[0];
    console.warn(`No TTS voice for "${lang}", falling back to "${v.lang}" (${v.name})`);
  }
  return v;
}

function speak(text, onend) {
  const utter = new SpeechSynthesisUtterance(text);
  const v = pickVoice(currentLang);
  utter.voice = v;
  utter.lang = v.lang;
  if (typeof onend === 'function') utter.addEventListener('end', onend);
  speechSynthesis.speak(utter);
  return utter;
}

function sendFinalMessage(text, translation, audio) {
  if (!listenWs || listenWs.readyState !== WebSocket.OPEN) {
    console.warn('[sendFinalMessage] WebSocket not open');
    return;
  }

  const finalMsg = {
    type: 'final',
    speaker: 'you',
    clientId: CLIENT_ID,
    original: text,
    translation,
    audio: audio || ''
  };

  listenWs.send(JSON.stringify(finalMsg));
  console.log('[sendFinalMessage] Sent final message:', finalMsg);
}

function createUI() {
  const app = document.getElementById('app');

  const langLabel = document.createElement('label');
  langLabel.textContent = 'Target lang: ';
  const langSel = renderLanguageSelector(langLabel);
  app.append(langLabel);
  langSel.addEventListener('language-change', e => {
    currentLang = e.detail;
    console.log('Language set to', currentLang);
  });

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

  const transcript = document.createElement('div');
  transcript.id = 'transcript';
  app.append(document.createElement('hr'), transcript);

  previewOriginal = document.createElement('textarea');
  previewTranslation = document.createElement('div');
  retranslateBtn = document.createElement('button');
  sendBtn = document.createElement('button');
  deleteBtn = document.createElement('button');

  previewOriginal.id = 'previewOriginal';
  previewOriginal.rows = 3;
  previewOriginal.style.width = '100%';
  previewOriginal.placeholder = 'Speak or type a message...';

  retranslateBtn.id = 'retranslateBtn';
  retranslateBtn.textContent = 'Re-Translate';
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
    deleteBtn.disabled = !txt;
    sendBtn.disabled = !txt;

    if (!txt) previewTranslation.innerHTML = '';
    statusElement(txt ? 'Preview' : 'Idle');
  });

  retranslateBtn.onclick = async () => {
    const newText = previewOriginal.value.trim();
    if (!newText) return;

    statusElement('Re-translating…');
    retranslateBtn.disabled = true;
    sendBtn.disabled = true;

    try {
      const response = await fetch('/api/translate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText, targetLang: currentLang })
      });
      const { translation, audio } = await response.json();

      renderPreviewTranslation(translation, audio);

      sendBtn.disabled = false;
      deleteBtn.disabled = false;
      retranslateBtn.disabled = false;

      statusElement('Preview');
    } catch (err) {
      console.error('Error re-translating:', err);
      statusElement('Error');
    }
  };

  sendBtn.onclick = () => {
    const text = previewOriginal.value.trim();
    const translationText = previewTranslation.querySelector('strong')
      ? previewTranslation.querySelector('strong').nextSibling.textContent.trim()
      : '';
    const audioEl = document.getElementById('previewAudio');
    const audio = audioEl ? audioEl.src.split(',')[1] : '';
    sendFinalMessage(text, translationText, audio);
    resetPreview();
  };

  const previewContainer = document.createElement('div');
  previewContainer.id = 'previewContainer';
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
  listenWs.binaryType = 'arraybuffer';

  listenWs.addEventListener('open', () => {
    console.log('🔔 [listenWs] connected');
  });

  listenWs.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);

    const entry = document.createElement('div');
    const transcript = document.getElementById('transcript');

    let audioHtml = '';
    if (msg.audio) {
      audioHtml = `
        <button class="play-btn">🔊 Play</button>
        <audio class="chat-audio" src="data:audio/mpeg;base64,${msg.audio}"></audio>
      `;
    }

    if (msg.speaker === 'you' && msg.clientId === CLIENT_ID) {
      entry.innerHTML = `
        <hr>
        <p><strong>You said:</strong> ${msg.original}</p>
        <p><strong>Translation:</strong> ${msg.translation}</p>
        ${audioHtml}
      `;
      transcript.append(entry);
      if (msg.audio) {
        entry.querySelector('.play-btn').addEventListener('click', () =>
          entry.querySelector('.chat-audio').play()
        );
      }
      resetPreview();
    } else if (msg.speaker === 'them' && msg.clientId !== CLIENT_ID) {
      console.log('[listenWs] Incoming message from other client:', msg);
      entry.innerHTML = `
        <hr>
        <p><strong>They said:</strong> ${msg.translation}</p>
        <p><em>(Original: ${msg.original})</em></p>
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
}

function renderPreviewTranslation(translation, audio) {
  if (audio) {
    previewTranslation.innerHTML = `
      <p>
        <strong>Translation:</strong> ${translation}
        <button id="playPreviewBtn">🔊 Play</button>
        <audio id="previewAudio" src="data:audio/mpeg;base64,${audio}"></audio>
      </p>
    `;
    document
      .getElementById('playPreviewBtn')
      .addEventListener('click', () =>
        document.getElementById('previewAudio').play()
      );
  } else {
    previewTranslation.innerHTML = `
      <p>
        <strong>Translation:</strong> ${translation}
        <button id="playPreviewBtn">🔊 Play</button>
      </p>
    `;
    document
      .getElementById('playPreviewBtn')
      .addEventListener('click', () => speak(translation));
  }
}

function resetPreview() {
  previewOriginal.value = '';
  previewTranslation.innerHTML = '';
  retranslateBtn.disabled = true;
  sendBtn.disabled = true;
  deleteBtn.disabled = true;
  statusElement('Idle');
}

function statusElement(txt) {
  document.getElementById('status').textContent = txt;
}

function toggleButtons({ start, stop }) {
  if (start !== undefined) document.getElementById('start').disabled = start;
  if (stop !== undefined) document.getElementById('stop').disabled = stop;
}

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

async function sendToWhisper(blob) {
  statusElement('Transcribing…');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
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
      renderPreviewTranslation(msg.translation, msg.audio);
      retranslateBtn.disabled = false;
      sendBtn.disabled = false;
      deleteBtn.disabled = false;
      toggleButtons({ start: false, stop: true });
      statusElement('Preview');
    }
    previewWs.close();
  });

  previewWs.addEventListener('error', err => {
    console.error('[sendToWhisper] WS error', err);
    statusElement('Error');
  });
}

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
