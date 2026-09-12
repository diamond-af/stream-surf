const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const CATEGORY = process.env.TWITCH_CATEGORY || 'Just Chatting';

const HAS_API_KEYS = !!(CLIENT_ID && CLIENT_SECRET);

function loadCuratedChannels() {
  try {
    const file = path.join(__dirname, 'channels.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const names = (data.twitch || []).filter((n) => n && !n.startsWith('example_channel'));
    return names;
  } catch {
    return [];
  }
}

const CURATED_CHANNELS = loadCuratedChannels();
const HAS_CURATED_CHANNELS = CURATED_CHANNELS.length > 0;

// 'live'    = real Twitch API discovery (needs API keys)
// 'curated' = direct embed of a hand-picked list, no API needed
// 'mock'    = fake demo data, nothing configured yet
const MODE = HAS_API_KEYS ? 'live' : HAS_CURATED_CHANNELS ? 'curated' : 'mock';
const MOCK_MODE = MODE === 'mock'; // kept for backwards compatibility with server.js/client.js checks
const REAL_EMBED_MODE = MODE === 'live' || MODE === 'curated';

const MOCK_CHANNELS = [
  { id: 'mock1', login: 'chillbeats_radio', displayName: 'ChillBeatsRadio', title: 'lofi & chatting - come hang out', viewers: 812 },
  { id: 'mock2', login: 'pixel_pete', displayName: 'Pixel_Pete', title: 'speedrunning until I rage quit', viewers: 214 },
  { id: 'mock3', login: 'sundaydrawsstuff', displayName: 'SundayDrawsStuff', title: 'drawing your pfp requests', viewers: 96 },
  { id: 'mock4', login: 'lategamelarry', displayName: 'LateGameLarry', title: 'ranked grind (send help)', viewers: 431 },
  { id: 'mock5', login: 'kitchen_with_kay', displayName: 'Kitchen_With_Kay', title: 'cooking disasters live', viewers: 58 },
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

async function fetchLiveChannels() {
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
  }));
}

module.exports = { fetchLiveChannels, MOCK_MODE, REAL_EMBED_MODE, MODE, CATEGORY };
