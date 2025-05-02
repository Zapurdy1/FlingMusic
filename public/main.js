// main.js
// —————————————————————————————
// 1) Base URL — use the same host/origin that served the page
// —————————————————————————————
const BASE = window.location.origin;

// ————————————————
// 1) Persisted User & NAVBAR
// ————————————————
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

function updateNav() {
  const nav = document.querySelector('.nav-links');
  if (!nav) return;
  const old = document.getElementById('signOutBtn');
  if (old) old.parentElement.remove();

  if (currentUser) {
    nav.querySelectorAll('a[href="signin.html"], a[href="signup.html"]')
       .forEach(a => a.style.display = 'none');
    const li = document.createElement('li');
    li.innerHTML = `<a href="#" id="signOutBtn">Sign Out</a>`;
    nav.appendChild(li);
    document.getElementById('signOutBtn').addEventListener('click', () => {
      localStorage.removeItem('currentUser');
      currentUser = null;
      updateNav();
      window.location.href = 'signin.html';
    });
  } else {
    nav.querySelectorAll('a[href="signin.html"], a[href="signup.html"]')
       .forEach(a => a.style.display = '');
  }
}

// ————————————————
// 2) AUTH: Sign Up & Sign In
// ————————————————
async function handleSignup(e) {
  e.preventDefault();
  const username = document.getElementById('signupUsername').value.trim();
  const password = document.getElementById('signupPassword').value.trim();
  const msgDiv   = document.getElementById('signupMessage');
  try {
    const res  = await fetch(`${BASE}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      msgDiv.textContent = 'Server error (invalid response)';
      msgDiv.style.color   = 'red';
      console.error('Non-JSON signup response:', text);
      return;
    }
    msgDiv.textContent = data.message;
    msgDiv.style.color = res.ok ? 'green' : 'red';
    if (res.ok) setTimeout(() => window.location.href = 'signin.html', 1000);
  } catch (err) {
    console.error('Signup error:', err);
    msgDiv.textContent = `Error connecting: ${err.message}`;
    msgDiv.style.color = 'red';
  }
}

async function handleSignin(e) {
  e.preventDefault();
  const username = document.getElementById('signinUsername').value.trim();
  const password = document.getElementById('signinPassword').value.trim();
  const msgDiv   = document.getElementById('signinMessage');
  try {
    const res  = await fetch(`${BASE}/api/signin`, {
      method: 'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ username, password })
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      msgDiv.textContent = 'Server error (invalid response)';
      msgDiv.style.color   = 'red';
      console.error('Non-JSON signin response:', text);
      return;
    }
    msgDiv.textContent = data.message;
    msgDiv.style.color = res.ok ? 'green' : 'red';
    if (res.ok) {
      currentUser = data.user;
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      setTimeout(() => window.location.href = 'index.html', 1000);
    }
  } catch (err) {
    console.error('Signin error:', err);
    msgDiv.textContent = `Error connecting: ${err.message}`;
    msgDiv.style.color = 'red';
  }
}

// ————————————————
// 3) Load Spotify Genres
// ————————————————
async function loadGenres() {
  const sel = document.getElementById('musicPrefSelect');
  if (!sel) return;
  try {
    const res    = await fetch(`${BASE}/api/genres`);
    const genres = await res.json();
    sel.innerHTML = '';
    genres.forEach(g => {
      const opt = document.createElement('option');
      opt.value   = g;
      opt.textContent = g.charAt(0).toUpperCase() + g.slice(1);
      if (currentUser?.preference?.toLowerCase() === g) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load genres', err);
    sel.innerHTML = '<option value="">Error loading genres</option>';
  }
}

// ————————————————
// 4) Spotify Status & Playlist Creation
// ————————————————
async function initSpotify() {
  // only run on pages that have a spotifyStatus span
  const statusEl   = document.getElementById('spotifyStatus');
  const connectBtn = document.getElementById('connectSpotifyBtn');
  const disconnectBtn = document.getElementById('disconnectSpotifyBtn');
  const createBtn  = document.getElementById('createPlaylistBtn');
  if (!statusEl || !connectBtn || !createBtn) return;

  let connected = false;
  try {
    // status route returns 200 when we're connected, 401 if not
    const res = await fetch(`${BASE}/api/spotify/status`, {
      credentials: 'include'
    });
    connected = res.ok;
  } catch (err) {
    // network failure? treat as “not connected”
    connected = false;
  }

  // update UI
  statusEl.textContent        = connected ? 'Connected' : 'Not connected';
  connectBtn.style.display    = connected ? 'none' : 'inline-block';
  createBtn.style.display     = connected ? 'inline-block' : 'none';

  // if you have a "Disconnect" button in your HTML
  if (disconnectBtn) {
    disconnectBtn.style.display = connected ? 'inline-block' : 'none';
    disconnectBtn.onclick = async () => {
      try {
        const res = await fetch(`${BASE}/api/spotify/disconnect`, {
          method:      'POST',
          credentials: 'include'
        });
        if (!res.ok) throw new Error(await res.text());
      } catch (e) {
        console.warn('Disconnect failed:', e);
      }
      // after disconnect, re‑init to update UI
      initSpotify();
    };
  }
}





document.getElementById('connectSpotifyBtn')?.addEventListener('click', () => {
  window.location.href = `${BASE}/api/spotify/login`;
});
document.getElementById('disconnectSpotifyBtn')?.addEventListener('click', async () => {
  try {
    const res = await fetch(`${BASE}/api/spotify/disconnect`, {
      method:      'POST',
      credentials: 'include'
    });
    if (!res.ok) throw new Error((await res.json()).message || res.status);
   
    document.getElementById('spotifyStatus').textContent   = 'Not connected';
    document.getElementById('connectSpotifyBtn').disabled = false;
    document.getElementById('createPlaylistBtn').disabled = true;
    document.getElementById('disconnectSpotifyBtn').disabled = true;
    alert('Spotify has been disconnected.');
  } catch (err) {
    console.error('Disconnect failed', err);
    alert('Error disconnecting Spotify: ' + err.message);
  }
});
// Disconnect from Spotify
document.getElementById('disconnectSpotifyBtn')?.addEventListener('click', async () => {
  try {
    const res = await fetch(`${BASE}/api/spotify/disconnect`, {
      method:      'POST',
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to disconnect');
    // re-run init to update UI
    await initSpotify();
    // clear any embed
    document.getElementById('embed').innerHTML = '';
  } catch (err) {
    console.error('Disconnect failed', err);
    alert('Error disconnecting from Spotify');
  }
});

document.getElementById('createPlaylistBtn')?.addEventListener('click', async () => {
  try {
    const res  = await fetch(`${BASE}/api/spotify/createPlaylist`, {
      method:      'POST',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) return alert('Error: ' + (data.message || res.status));

    document.getElementById('embed').innerHTML = `
      <iframe
        src="https://open.spotify.com/embed/playlist/${data.playlistId}"
        width="300" height="380"
        frameborder="0" allow="encrypted-media">
      </iframe>
    `;

    window.__lastPlaylistId = data.playlistId;
    document.getElementById('savePlaylistBtn').disabled = false;
  } catch (err) {
    console.error('Playlist creation failed', err);
    alert('Network error creating playlist');
  }
});

// ————————————————
// 5) QR Presence & Room Logic
// ————————————————
async function loadRoomUsers() {
  const ul = document.getElementById('roomUsersList');
  if (!ul) return;
  try {
    const res   = await fetch(`${BASE}/api/roomUsers`);
    const users = await res.json();
    ul.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      li.textContent = u.username;
      ul.appendChild(li);
    });
  } catch {
    // ignore
  }
}

document.getElementById('generateQrBtn')?.addEventListener('click', async () => {
  const profileMessage = document.getElementById('profileMessage');
  const qrDiv          = document.getElementById('qrcode');
  profileMessage.textContent = '';
  qrDiv.innerHTML = '';

  if (!currentUser) {
    profileMessage.textContent = 'Please sign in first.';
    profileMessage.style.color = 'red';
    return;
  }
  try {
    const res  = await fetch(`${BASE}/api/generateQR`, {
      method: 'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
    const data = await res.json();
    if (!res.ok) {
      profileMessage.textContent = data.message;
      profileMessage.style.color = 'red';
      return;
    }
    profileMessage.textContent = 'QR code generated. Scan it!';
    profileMessage.style.color = 'green';
    qrDiv.innerHTML = `<img src="${data.qrDataUrl}" alt="QR Code">`;
  } catch (err) {
    console.error('QR error', err);
    profileMessage.textContent = 'Error generating QR code';
    profileMessage.style.color = 'red';
  }
});

document.getElementById('leaveRoomBtn')?.addEventListener('click', async () => {
  const profileMessage = document.getElementById('profileMessage');
  profileMessage.textContent = '';
  if (!currentUser) {
    profileMessage.textContent = 'Please sign in first.';
    profileMessage.style.color = 'red';
    return;
  }
  try {
    const res  = await fetch(`${BASE}/api/leave`, {
      method: 'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
    const data = await res.json();
    profileMessage.textContent = res.ok ? 'You left the room.' : data.message;
    profileMessage.style.color = res.ok ? 'green' : 'red';
    if (res.ok) loadRoomUsers();
  } catch {
    profileMessage.textContent = 'Error leaving room';
    profileMessage.style.color = 'red';
  }
});

// ————————————————
// 6) Update Preference
// ————————————————
document.getElementById('updatePrefBtn')?.addEventListener('click', async () => {
  const profileMessage = document.getElementById('profileMessage');
  profileMessage.textContent = '';
  if (!currentUser) {
    profileMessage.textContent = 'Please sign in first.';
    profileMessage.style.color = 'red';
    return;
  }
  const newPref = document.getElementById('musicPrefSelect').value;
  try {
    const res  = await fetch(`${BASE}/api/updatePreference`, {
      method: 'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ userId: currentUser.id, newPref })
    });
    const data = await res.json();
    profileMessage.textContent = res.ok
      ? `Preference updated to ${newPref}`
      : data.message;
    profileMessage.style.color = res.ok ? 'green' : 'red';
    if (res.ok) {
      currentUser.preference = newPref;
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
    }
  } catch (err) {
    console.error('Update preference failed', err);
    profileMessage.textContent = 'Error updating preference';
    profileMessage.style.color = 'red';
  }
});

// ————————————————
// 7) GROUPS: Load, Create, Buttons
// ————————————————
async function loadGroups() {
  if (!currentUser) return;
  const ul = document.getElementById('groupsList');
  if (!ul) return;
  ul.innerHTML = '<li>Loading groups…</li>';
  try {
    const res    = await fetch(`${BASE}/api/groups?userId=${currentUser.id}`);
    const groups = await res.json();
    ul.innerHTML = '';
    groups.forEach(g => {
      const li = document.createElement('li');
      li.dataset.groupId = g.id;
      li.innerHTML = `
        <span class="group-name">${g.name}</span>
        <button class="view-group-playlists-btn">Playlists</button>
        <button class="view-members-btn">View Members</button>
        <button class="leave-group-btn">Leave</button>
        <button class="add-member-btn">Add Member</button>
        <button class="delete-group-btn">Delete Group</button>
      `;
      ul.appendChild(li);
    });
    attachGroupButtons();
  } catch (err) {
    console.error('Failed to load groups', err);
    ul.innerHTML = '<li>Error loading groups</li>';
  }
}

function attachGroupButtons() {
  // View Members
  document.querySelectorAll('.view-members-btn').forEach(btn => {
    btn.onclick = async () => {
      const groupId = btn.closest('li').dataset.groupId;
      try {
        const res     = await fetch(`${BASE}/api/groups/${groupId}/members`);
        const members = await res.json();
        alert(members.map(m => `• ${m.username} (ID: ${m.id})`).join('\n') ||
              'No members in this group.');
      } catch (err) {
        console.error('Failed to fetch members', err);
        alert('Error loading members');
      }
    };
  });

  // Leave Group
  document.querySelectorAll('.leave-group-btn').forEach(btn => {
    btn.onclick = async () => {
      const groupId = btn.closest('li').dataset.groupId;
      if (!confirm('Leave this group?')) return;
      const res = await fetch(`${BASE}/api/groups/${groupId}/leave`, {
        method: 'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });
      const d = await res.json();
      if (!res.ok) return alert('Error: ' + d.message);
      alert('You left the group');
      loadGroups();
    };
  });

  // Add Member
  document.querySelectorAll('.add-member-btn').forEach(btn => {
    btn.onclick = async () => {
      const groupId   = btn.closest('li').dataset.groupId;
      const newUserId = prompt('Enter the user ID to add:');
      if (!newUserId) return;
      const res = await fetch(`${BASE}/api/groups/${groupId}/join`, {
        method: 'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ userId: newUserId })
      });
      const d = await res.json();
      if (!res.ok) return alert('Error: ' + d.message);
      alert('User added to group.');
    };
  });

  // Delete Group
  document.querySelectorAll('.delete-group-btn').forEach(btn => {
    btn.onclick = async () => {
      const groupId = btn.closest('li').dataset.groupId;
      if (!confirm('Delete this group forever?')) return;
      const res = await fetch(`${BASE}/api/groups/${groupId}`, { method:'DELETE' });
      const d   = await res.json();
      if (!res.ok) return alert('Error: ' + d.message);
      alert('Group deleted');
      loadGroups();
    };
  });

  // View Playlists
  document.querySelectorAll('.view-group-playlists-btn').forEach(btn => {
    btn.onclick = () => {
      const li        = btn.closest('li');
      const groupId   = li.dataset.groupId;
      const groupName = li.querySelector('.group-name').textContent;
      document.getElementById('currentGroupName').textContent = groupName;
      loadSavedPlaylists(groupId);
    };
  });
}
// ————————————————
// Create New Group
// ————————————————
document.getElementById('createGroupBtn')?.addEventListener('click', async () => {
  const nameEl = document.getElementById('newGroupName');
  const groupName = nameEl.value.trim();
  if (!groupName) {
    return alert('Please enter a group name');
  }

  try {
    const res = await fetch(`${BASE}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupName,
        createdBy: currentUser.id
      })
    });
    const data = await res.json();
    if (!res.ok) {
      return alert('Error creating group: ' + (data.message || res.status));
    }
    alert('Group created!');
    nameEl.value = '';
    // refresh both lists:
    loadGroups();
    loadMyGroupsForSave();
  } catch (err) {
    console.error('Create group failed', err);
    alert('Network error creating group');
  }
});

// ————————————————
// 8) Saved Playlists for a Group
// ————————————————
async function loadSavedPlaylists(groupId) {
  const ul = document.getElementById('savedPlaylistsList');
  ul.innerHTML = '<li>Loading…</li>';

  try {
    const res  = await fetch(`${BASE}/api/groups/${groupId}/playlists`);
    const list = await res.json();   // [{id, playlistId, createdAt}, …]
    ul.innerHTML = '';

    if (!list.length) {
      ul.innerHTML = '<li>No saved playlists</li>';
      return;
    }

    list.forEach(pl => {
      const playlistId = pl.playlistId;
      const when       = new Date(pl.createdAt).toLocaleString();
      const li = document.createElement('li');
      li.dataset.recordId   = pl.id;
      li.dataset.playlistId = playlistId;
      li.innerHTML = `
        <strong>Playlist ID: ${playlistId}</strong>
        <span class="small">(${when})</span>
        <button class="view-playlist-btn" data-id="${playlistId}">View</button>
        <button class="delete-playlist-btn" data-record-id="${pl.id}">Delete</button>
      `;
      ul.appendChild(li);
    });

    // wire up View
    document.querySelectorAll('.view-playlist-btn').forEach(btn => {
      btn.onclick = () => {
        const pid = btn.dataset.id;
        document.getElementById('embed').innerHTML =
          `<iframe
             src="https://open.spotify.com/embed/playlist/${pid}"
             width="300" height="380"
             frameborder="0" allow="encrypted-media">
           </iframe>`;
      };
    });

    // wire up Delete
    document.querySelectorAll('.delete-playlist-btn').forEach(btn => {
      btn.onclick = async () => {
        const recordId = btn.dataset.recordId;
        await fetch(`${BASE}/api/groups/${groupId}/playlists/${recordId}`, {
          method: 'DELETE'
        });
        loadSavedPlaylists(groupId);
      };
    });

  } catch (err) {
    console.error('Failed to load playlists', err);
    ul.innerHTML = '<li>Error loading playlists</li>';
  }
}


// ————————————————
// 9) Save-to-Group: load dropdown & handler
// ————————————————
async function loadMyGroupsForSave() {
  if (!currentUser) return;
  const sel = document.getElementById('saveGroupSelect');
  if (!sel) return;
  try {
    const res    = await fetch(`${BASE}/api/groups?userId=${currentUser.id}`);
    const groups = await res.json();
    sel.innerHTML = `<option value="">Select group…</option>`;
    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value   = g.id;
      opt.textContent = g.name;
      sel.appendChild(opt);
    });
    sel.disabled = false;
  } catch (err) {
    console.error('Failed to load groups for save', err);
    sel.innerHTML = `<option>Error loading</option>`;
  }
}

document.getElementById('savePlaylistBtn')?.addEventListener('click', async () => {
  const sel      = document.getElementById('saveGroupSelect');
  const groupId  = sel?.value;
  const playlist = window.__lastPlaylistId;
  if (!groupId || !playlist) {
    return alert('Select a group and generate a playlist first.');
  }
  try {
    const res  = await fetch(
      `${BASE}/api/groups/${groupId}/playlists`,
      {
        method: 'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ spotifyPlaylistId: playlist })
      }
    );
    const data = await res.json();
    if (!res.ok) {
      return alert('Error saving: ' + data.message);
    }
    alert('Playlist saved to group!');
    sel.value = '';
    document.getElementById('savePlaylistBtn').disabled = true;
  } catch (err) {
    console.error('Save playlist failed', err);
    alert('Network error saving playlist');
  }
});
// ————————————————
// COLOR SCHEME SUPPORT
// ————————————————
const colorSchemeSelect   = document.getElementById('colorSchemeSelect');
const applyColorSchemeBtn = document.getElementById('applyColorSchemeBtn');

function applyColorScheme(theme) {
  // first strip any old theme class
  document.body.classList.remove(
    'theme-default',
    'theme-dark',
    'theme-pastel',
    'theme-blue'
  );
 
  document.body.classList.add(`theme-${theme}`);

  localStorage.setItem('flingColorScheme', theme);
}

function loadSavedColorScheme() {
  const saved = localStorage.getItem('flingColorScheme') || 'default';
  applyColorScheme(saved);
  if (colorSchemeSelect) colorSchemeSelect.value = saved;
}

applyColorSchemeBtn?.addEventListener('click', () => {
  const theme = colorSchemeSelect.value;
  applyColorScheme(theme);
});

// ————————————————
// 10) Initialize EVERYTHING
// ————————————————
window.addEventListener('DOMContentLoaded', () => {
  updateNav();
  document.getElementById('signupForm')?.addEventListener('submit', handleSignup);
  document.getElementById('signinForm')?.addEventListener('submit', handleSignin);
  if (currentUser) {
    const span = document.getElementById('userIdDisplay');
    if (span) span.textContent = currentUser.id;
    loadGenres();
    initSpotify();
    loadRoomUsers();
    loadGroups();
    loadMyGroupsForSave();
    attachGroupButtons();
    loadSavedColorScheme();
  }
});
