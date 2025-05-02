require('dotenv').config();
const express       = require('express');
const session       = require('express-session');
const mysql         = require('mysql2/promise');
const path          = require('path');
const crypto        = require('crypto');
const QRCode        = require('qrcode');
const axios         = require('axios');
const SpotifyWebApi = require('spotify-web-api-node');
const cors          = require('cors');

const app = express();

// —————— Sessions ——————
// tell Express “yes, I’m behind CloudFront/ELB, so I want
// ➤ allow your React/SPA origin to talk & share cookies
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN, // e.g. "https://flingmusic.onrender.com"
  credentials: true
}));

app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // only true in prod
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// —————— Middleware ——————
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// —————— Spotify Client ——————
const spotifyApi = new SpotifyWebApi({
  clientId:     process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri:  process.env.SPOTIFY_REDIRECT_URI
});

// —————— 1) Spotify Status ——————
app.get('/api/spotify/status', (req, res) => {
  res.sendStatus(req.session.spotifyAccessToken ? 200 : 401);
});

// —————— 2) Spotify Login ——————
app.get('/api/spotify/login', (req, res) => {
  const scopes = ['playlist-modify-private'];
  const url    = spotifyApi.createAuthorizeURL(scopes, null);
  res.redirect(url);
});

// —————— 3) Spotify Callback ——————
// callback handler (must be registered in your Spotify app’s Redirect URIs)
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const frontEnd = process.env.FRONTEND_ORIGIN;   // e.g. "https://flingmusic.onrender.com"

  // if Spotify didn’t send us a code, bail
  if (!code) {
    return res.redirect(`${frontEnd}/?connected=false`);
  }

  try {
    // exchange the code for access & refresh tokens
    const data = await spotifyApi.authorizationCodeGrant(code);

    // persist in session
    req.session.spotifyAccessToken  = data.body.access_token;
    req.session.spotifyRefreshToken = data.body.refresh_token;

    // also configure the client for subsequent calls
    spotifyApi.setAccessToken(data.body.access_token);
    spotifyApi.setRefreshToken(data.body.refresh_token);

    // send user back to your SPA with a flag
    res.redirect(`${frontEnd}/?connected=true`);
  } catch (err) {
    console.error('Spotify callback error', err);
    // if anything goes wrong, still redirect home so your UI can show an error
    res.redirect(`${frontEnd}/?connected=false`);
  }
});


// —————— Database Pool ——————
const db = mysql.createPool({
  host:              process.env.DB_HOST,
  port:             +process.env.DB_PORT || 3306,
  user:              process.env.DB_USER,
  password:          process.env.DB_PASS,
  database:          process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:   10,
  queueLimit:        0,
  connectTimeout:   10000,   // 10s
});

// optional: log any pool errors
db.on('error', err => {
  console.error('MySQL pool error', err);
});


// —————— 4) Create/Replace Room Playlist ——————
app.post('/api/spotify/createPlaylist', async (req, res) => {
  console.log('--- createPlaylist START ---');
  if (!req.session.spotifyAccessToken) {
    return res.status(401).json({ message: 'Not connected to Spotify' });
  }
  // refresh token if needed
  spotifyApi.setAccessToken(req.session.spotifyAccessToken);
  spotifyApi.setRefreshToken(req.session.spotifyRefreshToken);
  try {
    const refresh = await spotifyApi.refreshAccessToken();
    req.session.spotifyAccessToken = refresh.body.access_token;
    spotifyApi.setAccessToken(refresh.body.access_token);
    console.log('① Token refreshed');
  } catch {
    console.warn('① Token refresh failed, using existing token');
  }

  // get Spotify user id
  let spotifyUserId;
  try {
    const me = await spotifyApi.getMe();
    spotifyUserId = me.body.id;
    console.log('② Spotify user id:', spotifyUserId);
  } catch (err) {
    console.error('② getMe failed', err);
    return res.status(500).json({ message: 'Spotify getMe failed' });
  }

  // gather seeds from users in room
  let seeds = [];
  try {
    const [rows] = await db.query(
      'SELECT DISTINCT preference FROM users WHERE inRoom = 1'
    );
    seeds = rows.map(r => r.preference.trim().toLowerCase()).slice(0, 5);
    if (!seeds.length) seeds = ['pop'];
    console.log('③ Using seeds:', seeds);
  } catch (err) {
    console.error('③ DB query failed', err);
    return res.status(500).json({ message: 'DB error fetching preferences' });
  }

  // build track URIs via search
  let uris = [];
  try {
    for (let seed of seeds) {
      const search = await spotifyApi.searchTracks(`genre:${seed}`, { limit: 10 });
      uris.push(...search.body.tracks.items.map(t => t.uri));
      console.log(`④ seed="${seed}" → ${search.body.tracks.items.length} URIs`);
    }
    uris = Array.from(new Set(uris)).slice(0, 30);
    console.log(`④ Total URIs: ${uris.length}`);
  } catch (err) {
    console.error('④ searchTracks failed', err);
    return res.status(500).json({ message: 'Spotify search failed' });
  }

  const playlistName = 'Fling Room Playlist';
  let playlistId;

  // attempt to replace existing playlist
  try {
    const list     = await spotifyApi.getUserPlaylists(spotifyUserId, { limit: 50 });
    const existing = list.body.items.find(p => p.name === playlistName);
    if (existing) {
      playlistId = existing.id;
      console.log('⑤ Replacing tracks in', playlistId);
      await axios.put(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        { uris },
        { headers: { Authorization: `Bearer ${req.session.spotifyAccessToken}` } }
      );
      console.log('⑤ Tracks replaced');
    }
  } catch (err) {
    console.warn('⑤ Replace failed, will try create', err.response?.data || err.message);
  }

  // if no existing, create new
  if (!playlistId) {
    try {
      console.log('⑤ Creating new playlist via axios:', playlistName);
      const createRes = await axios.post(
        `https://api.spotify.com/v1/users/${spotifyUserId}/playlists`,
        { name: playlistName, description: 'Auto-generated room playlist', public: false },
        { headers: { Authorization: `Bearer ${req.session.spotifyAccessToken}` } }
      );
      playlistId = createRes.data.id;
      console.log('⑤ New playlist ID:', playlistId);

      await axios.post(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        { uris },
        { headers: { Authorization: `Bearer ${req.session.spotifyAccessToken}` } }
      );
      console.log('⑤ Tracks added');
    } catch (err) {
      console.error('⑤ Create/add failed', err.response?.data || err.message);
      return res.status(500).json({
        message: 'Spotify playlist creation failed',
        details: err.response?.data || err.message
      });
    }
  }

  console.log('--- createPlaylist SUCCESS:', playlistId);
  res.json({ playlistId });
});
// server.js
app.post('/api/spotify/disconnect', (req, res) => {
  req.session.spotifyAccessToken = null;
  req.session.spotifyRefreshToken = null;
  res.json({ message: 'Disconnected' });
});


// —————— 5) Save Room Playlist to Group ——————
app.post('/api/groups/:groupId/playlists', async (req, res) => {
  const { groupId }           = req.params;
  const { spotifyPlaylistId } = req.body;
  if (!groupId || !spotifyPlaylistId) {
    return res.status(400).json({ message: 'Missing groupId or spotifyPlaylistId' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO group_playlists (group_id, spotify_playlist_id) VALUES (?, ?)',
      [groupId, spotifyPlaylistId]
    );
    res.json({ message: 'Saved', recordId: result.insertId });
  } catch (err) {
    console.error('POST /api/groups/:groupId/playlists error', err);
    res.status(500).json({ message: 'Database error saving playlist' });
  }
});

// —————— 6) Genres ——————
app.get('/api/genres', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT genre_name FROM spotify_genres ORDER BY genre_name'
    );
    res.json(rows.map(r => r.genre_name));
  } catch (err) {
    console.error('GET /api/genres error', err);
    res.status(500).json({ message: 'Database error fetching genres' });
  }
});

// —————— 7) Room Users ——————
app.get('/api/roomUsers', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT username FROM users WHERE inRoom = 1'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/roomUsers error', err);
    res.status(500).json({ message: 'Database error' });
  }
});

// —————— 8) Groups CRUD ——————

/** GET /api/groups?userId=… */
app.get('/api/groups', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ message: 'Missing userId' });
  try {
    const [created] = await db.query(
      'SELECT group_id AS id, group_name AS name FROM `groups` WHERE created_by = ?',
      [userId]
    );
    const [joined] = await db.query(
      `SELECT g.group_id AS id, g.group_name AS name
       FROM \`groups\` g
       JOIN group_users gu ON gu.group_id = g.group_id
       WHERE gu.user_id = ?`,
      [userId]
    );
    const all    = [...created, ...joined];
    const unique = Array.from(new Map(all.map(g => [g.id,g])).values());
    res.json(unique);
  } catch (err) {
    console.error('GET /api/groups error', err);
    res.status(500).json({ message: 'Database error fetching groups' });
  }
});

/** POST /api/groups */
app.post('/api/groups', async (req, res) => {
  const { groupName, createdBy } = req.body;
  if (!groupName || !createdBy) return res.status(400).json({ message: 'Missing groupName or createdBy' });
  try {
    const [result] = await db.query(
      'INSERT INTO `groups` (group_name,created_by) VALUES (?,?)',
      [groupName, createdBy]
    );
    res.json({ message: 'Group created', groupId: result.insertId });
  } catch (err) {
    console.error('POST /api/groups error', err);
    res.status(500).json({ message: 'Database error creating group' });
  }
});

/** POST /api/groups/:groupId/join */
app.post('/api/groups/:groupId/join', async (req, res) => {
  const { groupId } = req.params, { userId } = req.body;
  if (!groupId||!userId) return res.status(400).json({ message:'Missing groupId or userId' });
  try {
    await db.query('INSERT INTO group_users (group_id,user_id) VALUES (?,?)',[groupId,userId]);
    res.json({ message:'Joined group' });
  } catch (err) {
    console.error('POST /api/groups/:groupId/join error', err);
    res.status(500).json({ message:'Database error joining group' });
  }
});

/** POST /api/groups/:groupId/leave */
app.post('/api/groups/:groupId/leave', async (req, res) => {
  const { groupId } = req.params, { userId } = req.body;
  if (!groupId||!userId) return res.status(400).json({ message:'Missing groupId or userId' });
  try {
    await db.query('DELETE FROM group_users WHERE group_id=? AND user_id=?',[groupId,userId]);
    res.json({ message:'You left the group' });
  } catch (err) {
    console.error('POST /api/groups/:groupId/leave error', err);
    res.status(500).json({ message:'Database error leaving group' });
  }
});

/** GET /api/groups/:groupId/members */
app.get('/api/groups/:groupId/members', async (req, res) => {
  const { groupId } = req.params;
  if (!groupId) return res.status(400).json({ message:'Missing groupId' });
  try {
    const [rows] = await db.query(
      `SELECT u.id,u.username
       FROM users u
       JOIN group_users gu ON u.id=gu.user_id
       WHERE gu.group_id=?`,
      [groupId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/groups/:groupId/members error', err);
    res.status(500).json({ message:'Database error fetching members' });
  }
});

/** DELETE /api/groups/:groupId */
app.delete('/api/groups/:groupId', async (req, res) => {
  const { groupId } = req.params;
  if (!groupId) return res.status(400).json({ message:'Missing groupId' });
  try {
    await db.query('DELETE FROM group_users WHERE group_id=?',[groupId]);
    await db.query('DELETE FROM `groups` WHERE group_id=?',[groupId]);
    res.json({ message:'Group deleted' });
  } catch (err) {
    console.error('DELETE /api/groups/:groupId error', err);
    res.status(500).json({ message:'Database error deleting group' });
  }
});

// —————— 9) List Saved Playlists for a Group ——————
app.get('/api/groups/:groupId/playlists', async (req, res) => {
  const { groupId } = req.params;
  if (!groupId) return res.status(400).json({ message:'Missing groupId' });
  try {
    const [rows] = await db.query(
      `SELECT
         id                    AS id,
         spotify_playlist_id   AS playlistId,
         created_at            AS createdAt
       FROM group_playlists
       WHERE group_id=?
       ORDER BY createdAt DESC`,
      [groupId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/groups/:groupId/playlists error', err);
    res.status(500).json({ message:'Database error fetching playlists' });
  }
});

/** DELETE /api/groups/:groupId/playlists/:id */
app.delete('/api/groups/:groupId/playlists/:id', async (req, res) => {
  await db.query('DELETE FROM group_playlists WHERE id=?',[req.params.id]);
  res.json({ message:'Deleted' });
});

// —————— 10) Sign Up & Sign In ——————
app.post('/api/signup', async (req, res) => {
  const { username,password } = req.body;
  if (!username||!password) return res.status(400).json({ message:'Missing username or password' });
  try {
    await db.query('INSERT INTO users (username,password) VALUES (?,?)',[username,password]);
    res.json({ message:'Sign-up successful' });
  } catch (err) {
    if (err.code==='ER_DUP_ENTRY') return res.status(400).json({ message:'Username already taken' });
    console.error('Signup error', err);
    res.status(500).json({ message:'Database error', error:err.message });
  }
});

app.post('/api/signin', async (req, res) => {
  const { username,password } = req.body;
  if (!username||!password) return res.status(400).json({ message:'Missing username or password' });
  try {
    const [rows] = await db.query(
      'SELECT id,username,preference FROM users WHERE username=? AND password=? LIMIT 1',
      [username,password]
    );
    if (!rows.length) return res.status(401).json({ message:'Invalid credentials' });
    res.json({ message:'Sign-in successful', user:rows[0] });
  } catch (err) {
    console.error('Signin error', err);
    res.status(500).json({ message:'Database error', error:err.message });
  }
});

// —————— 11) QR Code Presence ——————
app.post('/api/generateQR', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message:'Missing userId' });
  const token = crypto.randomBytes(16).toString('hex');
  try {
    const [result] = await db.query('UPDATE users SET qrToken=? WHERE id=?',[token,userId]);
    if (result.affectedRows===0) return res.status(404).json({ message:'User not found' });
    QRCode.toDataURL(token, (err, dataUrl) => {
      if (err) return res.status(500).json({ message:'QR generation error', error:err.message });
      res.json({ qrDataUrl: dataUrl });
    });
  } catch (err) {
    console.error('generateQR error', err);
    res.status(500).json({ message:'Database error', error:err.message });
  }
});

app.post('/api/qrEnter', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ message:'Missing token' });
  try {
    const [rows] = await db.query('SELECT id FROM users WHERE qrToken=? LIMIT 1',[token]);
    if (!rows.length) return res.status(404).json({ message:'Token not found' });
    await db.query('UPDATE users SET inRoom=1,qrToken=NULL WHERE id=?',[rows[0].id]);
    res.json({ message:'User entered room' });
  } catch (err) {
    console.error('qrEnter error', err);
    res.status(500).json({ message:'Database error', error:err.message });
  }
});

// —————— 12) Leave Room & Update Preference ——————
app.post('/api/leave', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message:'Missing userId' });
  try {
    await db.query('UPDATE users SET inRoom=0 WHERE id=?',[userId]);
    res.json({ message:'You left the room' });
  } catch (err) {
    console.error('leave error', err);
    res.status(500).json({ message:'Database error', error:err.message });
  }
});

app.post('/api/updatePreference', async (req, res) => {
  const { userId,newPref } = req.body;
  if (!userId||!newPref) return res.status(400).json({ message:'Missing userId or newPref' });
  try {
    const [result] = await db.query(
      'UPDATE users SET preference=? WHERE id=?',
      [newPref,userId]
    );
    if (result.affectedRows===0) return res.status(404).json({ message:'User not found or no update made' });
    res.json({ message:'Preference updated successfully' });
  } catch (err) {
    console.error('updatePreference error', err);
    res.status(500).json({ message:'Database error', error:err.message });
  }
});

// —————— Start Server ——————
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server listening on http://localhost:${PORT}`));
