require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Filter = require('bad-words');

const { fetchLiveChannels, MODE, CATEGORY } = require('./twitch');

const PORT = process.env.PORT || 3000;
const JUMP_INTERVAL_MS = (Number(process.env.JUMP_INTERVAL_SECONDS) || 45) * 1000;
const SKIP_VOTE_RATIO = 0.5; // fraction of connected viewers needed to force an early jump
const LEADERBOARD_SIZE = 8;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const filter = new Filter();

// ---- Room state -----------------------------------------------------------
let channelPool = [];
let currentChannel = null;
let jumpTimer = null;
let nextJumpAt = Date.now() + JUMP_INTERVAL_MS;

const channelVotes = new Map(); // socket.id -> 'fire' | 'skip', for the CURRENT channel only
const nicknames = new Map(); // socket.id -> nickname
const scores = new Map(); // nickname -> points (persists across reconnects, resets on server restart)
const lastMessageAt = new Map(); // socket.id -> timestamp, for basic rate limiting
const RATE_LIMIT_MS = 1200;

function randomNickname(socketId) {
  return `Surfer${socketId.slice(0, 4)}`;
}

function nicknameFor(socketId) {
  return nicknames.get(socketId) || randomNickname(socketId);
}

async function refreshChannelPool() {
  try {
    const channels = await fetchLiveChannels();
    if (channels.length) channelPool = channels;
  } catch (err) {
    console.error('[twitch] failed to refresh channel pool:', err.message);
  }
}

function pickNextChannel() {
  if (!channelPool.length) return null;
  const pool = currentChannel
    ? channelPool.filter((c) => c.login !== currentChannel.login)
    : channelPool;
  const source = pool.length ? pool : channelPool;
  return source[Math.floor(Math.random() * source.length)];
}

function broadcastChannel() {
  io.emit('channel', {
    channel: currentChannel,
    nextJumpAt,
    category: CATEGORY,
  });
}

function voteTally() {
  let fire = 0;
  let skip = 0;
  for (const v of channelVotes.values()) {
    if (v === 'fire') fire++;
    else skip++;
  }
  return { fire, skip };
}

function broadcastVoteTally() {
  const { fire, skip } = voteTally();
  io.emit('vote-tally', {
    fire,
    skip,
    needed: Math.max(1, Math.ceil(io.engine.clientsCount * SKIP_VOTE_RATIO)),
  });
}

function broadcastLeaderboard() {
  const top = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LEADERBOARD_SIZE)
    .map(([nickname, points]) => ({ nickname, points }));
  io.emit('leaderboard', top);
}

function sendScoreTo(socketId) {
  const s = io.sockets.sockets.get(socketId);
  if (!s) return;
  s.emit('your-score', { points: scores.get(nicknameFor(socketId)) || 0 });
}

function settleVotesAndScore() {
  const { fire, skip } = voteTally();
  if (fire === 0 && skip === 0) return;
  const consensus = fire >= skip ? 'fire' : 'skip';
  for (const [socketId, vote] of channelVotes.entries()) {
    if (vote !== consensus) continue;
    const nickname = nicknameFor(socketId);
    scores.set(nickname, (scores.get(nickname) || 0) + 1);
    sendScoreTo(socketId);
  }
  broadcastLeaderboard();
}

function jumpToNextChannel(reason) {
  const next = pickNextChannel();
  if (!next) return;

  settleVotesAndScore();

  currentChannel = next;
  channelVotes.clear();
  nextJumpAt = Date.now() + JUMP_INTERVAL_MS;
  broadcastChannel();
  broadcastVoteTally();
  io.emit('system-message', {
    text: `Jumped to ${next.displayName} (${next.viewers ?? '?'} watching)${reason ? ' - ' + reason : ''}`,
  });
  resetJumpTimer();
}

function resetJumpTimer() {
  if (jumpTimer) clearTimeout(jumpTimer);
  jumpTimer = setTimeout(() => jumpToNextChannel('auto-jump'), JUMP_INTERVAL_MS);
}

// ---- Socket handling --------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('channel', {
    channel: currentChannel,
    nextJumpAt,
    category: CATEGORY,
  });
  broadcastVoteTally();
  io.emit('viewer-count', { count: io.engine.clientsCount });

  socket.on('set-nickname', (raw) => {
    let name = String(raw || '').slice(0, 20).trim();
    if (!name) name = randomNickname(socket.id);
    name = filter.clean(name);
    nicknames.set(socket.id, name);
    if (!scores.has(name)) scores.set(name, 0);
    socket.emit('your-score', { points: scores.get(name) || 0 });
    broadcastLeaderboard();
  });

  socket.on('chat-message', (raw) => {
    const now = Date.now();
    const last = lastMessageAt.get(socket.id) || 0;
    if (now - last < RATE_LIMIT_MS) return; // silently drop, basic spam guard
    lastMessageAt.set(socket.id, now);

    let text = String(raw || '').slice(0, 240).trim();
    if (!text) return;
    text = filter.clean(text);

    io.emit('chat-message', {
      id: nicknameFor(socket.id),
      text,
      at: now,
    });
  });

  socket.on('channel-vote', (choice) => {
    if (choice !== 'fire' && choice !== 'skip') return;
    if (channelVotes.has(socket.id)) return; // one vote per channel per viewer
    channelVotes.set(socket.id, choice);
    broadcastVoteTally();

    const { skip } = voteTally();
    const needed = Math.max(1, Math.ceil(io.engine.clientsCount * SKIP_VOTE_RATIO));
    if (skip >= needed) {
      jumpToNextChannel('crowd voted to skip');
    }
  });

  socket.on('report', (payload) => {
    console.warn('[report]', socket.id, JSON.stringify(payload).slice(0, 300));
  });

  socket.on('disconnect', () => {
    channelVotes.delete(socket.id);
    lastMessageAt.delete(socket.id);
    nicknames.delete(socket.id);
    broadcastVoteTally();
    io.emit('viewer-count', { count: io.engine.clientsCount });
  });
});

// ---- Startup ----------------------------------------------------------------
async function start() {
  await refreshChannelPool();
  currentChannel = pickNextChannel();
  resetJumpTimer();
  setInterval(refreshChannelPool, 5 * 60 * 1000); // keep pool fresh every 5 min

  server.listen(PORT, () => {
    console.log(`stream-surf running at http://localhost:${PORT}`);
    if (MODE === 'mock') {
      console.log('  MOCK mode: no channels.json entries or Twitch API keys found, using fake demo data.');
    } else if (MODE === 'curated') {
      console.log('  CURATED mode: embedding the channel list from channels.json, no Twitch API keys used.');
    } else {
      console.log(`  LIVE mode: pulling from Twitch category "${CATEGORY}" via API.`);
    }
  });
}

start();
