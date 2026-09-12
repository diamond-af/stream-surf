const socket = io();

const els = {
  categoryLabel: document.getElementById('categoryLabel'),
  viewerCount: document.getElementById('viewerCount'),
  yourPoints: document.getElementById('yourPoints'),
  nicknameBtn: document.getElementById('nicknameBtn'),
  nicknameLabel: document.getElementById('nicknameLabel'),
  mockBanner: document.getElementById('mockBanner'),
  mockPlayer: document.getElementById('mockPlayer'),
  mockTitle: document.getElementById('mockTitle'),
  twitchPlayer: document.getElementById('twitchPlayer'),
  streamerName: document.getElementById('streamerName'),
  streamTitle: document.getElementById('streamTitle'),
  streamViewers: document.getElementById('streamViewers'),
  playerHost: document.getElementById('playerHost'),
  resizeHandle: document.getElementById('resizeHandle'),
  countdown: document.getElementById('countdown'),
  fireBtn: document.getElementById('fireBtn'),
  skipBtn: document.getElementById('skipBtn'),
  fireTally: document.getElementById('fireTally'),
  skipTally: document.getElementById('skipTally'),
  skipNeeded: document.getElementById('skipNeeded'),
  voteResult: document.getElementById('voteResult'),
  shareBtn: document.getElementById('shareBtn'),
  leaderboardList: document.getElementById('leaderboardList'),
  chatLog: document.getElementById('chatLog'),
  stickerPanel: document.getElementById('stickerPanel'),
  stickerToggle: document.getElementById('stickerToggle'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
};

const STICKERS = [
  '💀 I\'m deceased',
  '🔥 no cap fr fr',
  '😭 the audacity',
  '✅ understood the assignment',
  '🍿 let him cook',
  '🚩 that\'s a red flag',
  '💚 that\'s a green flag',
  '🧠 core memory unlocked',
  '🤖 npc behavior',
  '🎬 main character energy',
  '📉 that\'s an L',
  '📈 that\'s a W',
  '👀 this you?',
  '⛔ we do not do that here',
  '💅 not me doing this',
  '🎯 it\'s giving chaos',
  '🏆 certified classic',
  '🆓 living rent free',
];

let nextJumpAt = 0;
let hasVotedThisChannel = false;
let currentChannelData = null;

// ---- Nickname (persisted per-browser via localStorage) ---------------------
function getStoredNickname() {
  try {
    return localStorage.getItem('streamsurf_nickname') || '';
  } catch {
    return '';
  }
}
function storeNickname(name) {
  try {
    localStorage.setItem('streamsurf_nickname', name);
  } catch { /* ignore, e.g. private browsing */ }
}

let nickname = getStoredNickname();
if (!nickname) {
  nickname = `Surfer${Math.floor(Math.random() * 9000 + 1000)}`;
  storeNickname(nickname);
}
els.nicknameLabel.textContent = nickname;
socket.emit('set-nickname', nickname);

els.nicknameBtn.addEventListener('click', () => {
  const next = prompt('Pick a nickname (shown in chat and the leaderboard):', nickname);
  if (next && next.trim()) {
    nickname = next.trim().slice(0, 20);
    storeNickname(nickname);
    els.nicknameLabel.textContent = nickname;
    socket.emit('set-nickname', nickname);
  }
});

// ---- Chat --------------------------------------------------------------
function addChatLine({ who, text, system }) {
  const line = document.createElement('div');
  line.className = 'chat-line' + (system ? ' system' : '');

  if (!system) {
    const whoEl = document.createElement('span');
    whoEl.className = 'who';
    whoEl.textContent = who + ':';
    line.appendChild(whoEl);
  }

  line.appendChild(document.createTextNode(text));

  if (!system) {
    const reportBtn = document.createElement('button');
    reportBtn.className = 'report-btn';
    reportBtn.title = 'Report this message';
    reportBtn.textContent = '🚩';
    reportBtn.addEventListener('click', () => {
      socket.emit('report', { who, text });
      reportBtn.textContent = '✅';
      reportBtn.disabled = true;
    });
    line.appendChild(reportBtn);
  }

  els.chatLog.appendChild(line);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

// ---- Stickers ------------------------------------------------------------
for (const sticker of STICKERS) {
  const btn = document.createElement('button');
  btn.className = 'sticker-btn';
  btn.textContent = sticker;
  btn.addEventListener('click', () => {
    socket.emit('chat-message', sticker);
    els.stickerPanel.hidden = true;
  });
  els.stickerPanel.appendChild(btn);
}

els.stickerToggle.addEventListener('click', () => {
  els.stickerPanel.hidden = !els.stickerPanel.hidden;
});

// ---- Channel / player ----------------------------------------------------
function renderChannel({ channel, nextJumpAt: nextAt, mockMode, category }) {
  els.mockBanner.hidden = !mockMode;
  els.categoryLabel.textContent = `Category: ${category}`;
  nextJumpAt = nextAt;
  currentChannelData = channel;
  hasVotedThisChannel = false;
  setVoteButtonsEnabled(true);
  els.voteResult.hidden = true;

  if (!channel) {
    els.streamerName.textContent = 'No live channels right now';
    els.streamTitle.textContent = '';
    els.streamViewers.textContent = '';
    return;
  }

  els.streamerName.textContent = channel.displayName;
  els.streamTitle.textContent = channel.title || '';
  els.streamViewers.textContent = channel.viewers != null ? `${channel.viewers.toLocaleString()} watching` : '';

  if (mockMode) {
    els.twitchPlayer.hidden = true;
    els.mockPlayer.hidden = false;
    els.mockTitle.textContent = `(demo) ${channel.displayName} - ${channel.title}`;
  } else {
    els.mockPlayer.hidden = true;
    els.twitchPlayer.hidden = false;
    const parent = window.location.hostname || 'localhost';
    els.twitchPlayer.src = `https://player.twitch.tv/?channel=${encodeURIComponent(channel.login)}&parent=${parent}&muted=false`;
  }
}

socket.on('channel', renderChannel);

socket.on('system-message', ({ text }) => addChatLine({ text, system: true }));

socket.on('chat-message', ({ id, text }) => addChatLine({ who: id, text }));

// ---- Voting / prediction game --------------------------------------------
function setVoteButtonsEnabled(enabled) {
  els.fireBtn.disabled = !enabled;
  els.skipBtn.disabled = !enabled;
}

socket.on('vote-tally', ({ fire, skip, needed }) => {
  els.fireTally.textContent = fire;
  els.skipTally.textContent = skip;
  els.skipNeeded.textContent = needed;
});

els.fireBtn.addEventListener('click', () => castVote('fire'));
els.skipBtn.addEventListener('click', () => castVote('skip'));

function castVote(choice) {
  if (hasVotedThisChannel) return;
  hasVotedThisChannel = true;
  setVoteButtonsEnabled(false);
  socket.emit('channel-vote', choice);
  els.voteResult.hidden = false;
  els.voteResult.textContent = choice === 'fire'
    ? "You voted 🔥 Keep - if the crowd agrees, you'll score a point!"
    : "You voted 💀 Skip - if the crowd agrees, you'll score a point!";
}

socket.on('your-score', ({ points }) => {
  els.yourPoints.textContent = points;
});

socket.on('leaderboard', (top) => {
  els.leaderboardList.innerHTML = '';
  if (!top.length) {
    els.leaderboardList.innerHTML = '<li class="leaderboard-empty">No scores yet - vote to get on the board</li>';
    return;
  }
  for (const entry of top) {
    const li = document.createElement('li');
    li.textContent = `${entry.nickname} - ${entry.points}`;
    if (entry.nickname === nickname) li.classList.add('is-you');
    els.leaderboardList.appendChild(li);
  }
});

// ---- Share -----------------------------------------------------------------
els.shareBtn.addEventListener('click', async () => {
  const name = currentChannelData ? currentChannelData.displayName : 'a random stream';
  const text = `I just landed on ${name} on StreamSurf - random live streams, shared chat, vote to skip. Come surf with strangers: ${window.location.href}`;
  try {
    await navigator.clipboard.writeText(text);
    els.shareBtn.textContent = '✅ Copied!';
  } catch {
    els.shareBtn.textContent = '⚠️ Copy failed, select manually';
  }
  setTimeout(() => { els.shareBtn.textContent = '🔗 Share this moment'; }, 2000);
});

// ---- Viewer count / chat form ---------------------------------------------
socket.on('viewer-count', ({ count }) => {
  els.viewerCount.textContent = `${count} watching`;
});

els.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', text);
  els.chatInput.value = '';
});

setInterval(() => {
  const secondsLeft = Math.max(0, Math.round((nextJumpAt - Date.now()) / 1000));
  els.countdown.textContent = secondsLeft;
}, 250);

// ---- Resizable video player (both width and height, from the corner) ------
const MIN_PLAYER_HEIGHT = 200;
const MIN_PLAYER_WIDTH = 320;

function applyPlayerSize(width, height) {
  els.playerHost.style.flex = '0 0 auto';
  els.playerHost.style.width = `${width}px`;
  els.playerHost.style.height = `${height}px`;
}

function clearPlayerSize() {
  els.playerHost.style.flex = '';
  els.playerHost.style.width = '';
  els.playerHost.style.height = '';
}

(function restoreSavedPlayerSize() {
  try {
    const savedWidth = localStorage.getItem('streamsurf_player_width');
    const savedHeight = localStorage.getItem('streamsurf_player_height');
    if (savedWidth && savedHeight) applyPlayerSize(Number(savedWidth), Number(savedHeight));
  } catch { /* ignore */ }
})();

let dragging = false;

function startDrag() { dragging = true; document.body.style.cursor = 'nwse-resize'; }
function stopDrag() {
  if (!dragging) return;
  dragging = false;
  document.body.style.cursor = '';
  try {
    const rect = els.playerHost.getBoundingClientRect();
    localStorage.setItem('streamsurf_player_width', String(rect.width));
    localStorage.setItem('streamsurf_player_height', String(rect.height));
  } catch { /* ignore */ }
}
function dragTo(clientX, clientY) {
  if (!dragging) return;
  const { top, left } = els.playerHost.getBoundingClientRect();
  const maxHeight = window.innerHeight * 0.85;
  const maxWidth = els.playerHost.parentElement.getBoundingClientRect().width;
  const height = Math.min(maxHeight, Math.max(MIN_PLAYER_HEIGHT, clientY - top));
  const width = Math.min(maxWidth, Math.max(MIN_PLAYER_WIDTH, clientX - left));
  applyPlayerSize(width, height);
}

els.resizeHandle.addEventListener('mousedown', startDrag);
window.addEventListener('mousemove', (e) => dragTo(e.clientX, e.clientY));
window.addEventListener('mouseup', stopDrag);

els.resizeHandle.addEventListener('touchstart', startDrag, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (dragging && e.touches[0]) dragTo(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });
window.addEventListener('touchend', stopDrag);

els.resizeHandle.addEventListener('dblclick', () => {
  clearPlayerSize();
  try {
    localStorage.removeItem('streamsurf_player_width');
    localStorage.removeItem('streamsurf_player_height');
  } catch { /* ignore */ }
});
