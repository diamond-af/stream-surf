const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const CATEGORY = process.env.TWITCH_CATEGORY || 'Just Chatting';

const HAS_API_KEYS = !!(CLIENT_ID && CLIENT_SECRET);

function loadChannelsJson() {
  try {
    const file = path.join(__dirname, 'channels.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function loadCuratedNames(data, key) {
  return (data[key] || []).filter((n) => n && !n.startsWith('example_'));
}

const CHANNELS_JSON = loadChannelsJson();
const CURATED_CHANNELS = loadCuratedNames(CHANNELS_JSON, 'twitch');
const KICK_CHANNELS = loadCuratedNames(CHANNELS_JSON, 'kick');
const HAS_CURATED_CHANNELS = CURATED_CHANNELS.length > 0;

function fetchKickChannels() {
  // Kick has no public "what's live" API, only an official embed player -
  // so Kick channels are always a hand-picked list, never auto-discovered.
  return KICK_CHANNELS.map((login) => ({
    id: `kick:${login}`,
    login,
    displayName: login,
    title: null,
    viewers: null,
    platform: 'kick',
  }));
}

// 'live'    = real Twitch API discovery (needs API keys)
// 'curated' = direct embed of a hand-picked list, no API needed
// 'mock'    = fake demo data, nothing configured yet
const MODE = HAS_API_KEYS ? 'live' : HAS_CURATED_CHANNELS ? 'curated' : 'mock';

const MOCK_CHANNELS = [
  { id: 'mock1', login: 'chillbeats_radio', displayName: 'ChillBeatsRadio', title: 'lofi & chatting - come hang out', viewers: 812, platform: 'mock' },
  { id: 'mock2', login: 'pixel_pete', displayName: 'Pixel_Pete', title: 'speedrunning until I rage quit', viewers: 214, platform: 'mock' },
  { id: 'mock3', login: 'sundaydrawsstuff', displayName: 'SundayDrawsStuff', title: 'drawing your pfp requests', viewers: 96, platform: 'mock' },
  { id: 'mock4', login: 'lategamelarry', displayName: 'LateGameLarry', title: 'ranked grind (send help)', viewers: 431, platform: 'mock' },
  { id: 'mock5', login: 'kitchen_with_kay', displayName: 'Kitchen_With_Kay', title: 'cooking disasters live', viewers: 58, platform: 'mock' },
];

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAppAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Twitch auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function twitchGet(path, token) {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: {
      'Client-Id': CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`Twitch API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getCategoryId(token) {
  const data = await twitchGet(`games?name=${encodeURIComponent(CATEGORY)}`, token);
  if (!data.data || !data.data.length) {
    throw new Error(`Twitch category "${CATEGORY}" not found`);
  }
  return data.data[0].id;
}

async function fetchTwitchChannels() {
  if (MODE === 'mock') {
    return MOCK_CHANNELS.map((c) => ({ ...c, viewers: c.viewers + Math.floor(Math.random() * 20) }));
  }

  if (MODE === 'curated') {
    return CURATED_CHANNELS.map((login) => ({
      id: login,
      login,
      displayName: login,
      title: null,
      viewers: null,
      platform: 'twitch',
    }));
  }

  const token = await getAppAccessToken();
  const gameId = await getCategoryId(token);
  const data = await twitchGet(`streams?game_id=${gameId}&first=20`, token);

  return (data.data || []).map((s) => ({
    id: s.id,
    login: s.user_login,
    displayName: s.user_name,
    title: s.title,
    viewers: s.viewer_count,
    platform: 'twitch',
  }));
}

async function fetchLiveChannels() {
  const twitchChannels = await fetchTwitchChannels();
  // Kick channels are hand-picked (no discovery API) and always included
  // alongside whatever Twitch mode is active, so the mix stays interesting.
  return [...twitchChannels, ...fetchKickChannels()];
}

module.exports = { fetchLiveChannels, MODE, CATEGORY };
