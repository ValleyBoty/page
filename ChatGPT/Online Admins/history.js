const LEGACY_USERS_KEY = 'online-admins-player-database-v1';
const LEGACY_ACTIVITY_KEY = 'online-admins-activity-v1';
const DATABASE_NAME = 'online-admins-database';
const DATABASE_VERSION = 1;
let pendingBulkStatus = null;
let statusFilter = 'all';
let activityEvents = [];
let lastStatusSnapshot = new Map();
let lastUserSnapshot = new Map();
let lastSettingsSnapshot = null;
let auditReady = false;
let database = null;
let saveTimer = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'handle' });
      if (!db.objectStoreNames.contains('activity')) {
        const activity = db.createObjectStore('activity', { keyPath: 'id', autoIncrement: true });
        activity.createIndex('at', 'at');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function snapshotUsers() {
  players.forEach(player => {
    if (!player.statusChangedAt) player.statusChangedAt = Date.now();
    if (!player.createdAt) player.createdAt = Date.now();
    lastStatusSnapshot.set(player.handle, player.online);
    lastUserSnapshot.set(player.handle, { name: player.name, online: player.online, admin: Boolean(player.admin) });
  });
  lastSettingsSnapshot = { adminPassword, ownerPassword };
}

async function migrateLocalData() {
  const transaction = database.transaction(['users', 'activity'], 'readwrite');
  const users = transaction.objectStore('users');
  if ((await requestResult(users.count())) > 0) return;
  try {
    const legacyUsers = JSON.parse(localStorage.getItem(LEGACY_USERS_KEY));
    const legacyActivity = JSON.parse(localStorage.getItem(LEGACY_ACTIVITY_KEY));
    if (Array.isArray(legacyUsers)) legacyUsers.forEach(user => users.put({ ...user, createdAt: user.createdAt || Date.now() }));
    if (Array.isArray(legacyActivity)) legacyActivity.forEach(event => transaction.objectStore('activity').add(event));
  } catch (_) { /* No legacy database to migrate. */ }
}

async function initializeDatabase() {
  try {
    database = await openDatabase();
    await migrateLocalData();
    const transaction = database.transaction(['users', 'activity', 'settings'], 'readonly');
    const storedUsers = await requestResult(transaction.objectStore('users').getAll());
    const storedActivity = await requestResult(transaction.objectStore('activity').getAll());
    const storedSettings = await requestResult(transaction.objectStore('settings').getAll());
    if (storedUsers.length) players.splice(0, players.length, ...storedUsers.sort((a, b) => a.createdAt - b.createdAt));
    activityEvents = storedActivity.sort((a, b) => b.at - a.at).slice(0, 100);
    const settings = Object.fromEntries(storedSettings.map(setting => [setting.key, setting.value]));
    if (settings.adminPassword) adminPassword = settings.adminPassword;
    if (settings.ownerPassword) ownerPassword = settings.ownerPassword;
    snapshotUsers();
    auditReady = true;
    render();
  } catch (error) {
    console.warn('Die lokale Datenbank konnte nicht geöffnet werden.', error);
    snapshotUsers();
    auditReady = true;
    render();
  }
}

function queueDatabaseSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDatabase, 180);
}

async function saveDatabase() {
  if (!database) return;
  const transaction = database.transaction(['users', 'activity', 'settings'], 'readwrite');
  const users = transaction.objectStore('users');
  users.clear();
  players.forEach(player => users.put({ ...player, createdAt: player.createdAt || Date.now() }));
  const activity = transaction.objectStore('activity');
  activity.clear();
  activityEvents.slice(0, 100).forEach(event => activity.add(event));
  const settings = transaction.objectStore('settings');
  settings.put({ key: 'adminPassword', value: adminPassword });
  settings.put({ key: 'ownerPassword', value: ownerPassword });
}

function captureStatusChanges() {
  const now = Date.now();
  const currentHandles = new Set(players.map(player => player.handle));
  if (auditReady) {
    lastUserSnapshot.forEach((previous, handle) => {
      if (!currentHandles.has(handle)) { activityEvents.unshift({ kind: 'remove', name: previous.name, actor: isAdmin ? 'Admin' : 'Owner', at: now }); lastUserSnapshot.delete(handle); lastStatusSnapshot.delete(handle); }
    });
  }
  players.forEach(player => {
    const previous = lastUserSnapshot.get(player.handle);
    if (auditReady && !previous) {
      activityEvents.unshift({ kind: 'create', name: player.name, actor: isAdmin ? 'Admin' : 'Owner', at: now });
    } else if (auditReady && previous) {
      if (previous.online !== player.online) activityEvents.unshift({ kind: 'status', handle: player.handle, name: player.name, online: player.online, actor: isAdmin ? 'Admin' : 'Owner', at: now });
      if (previous.admin !== Boolean(player.admin)) activityEvents.unshift({ kind: player.admin ? 'admin-add' : 'admin-remove', name: player.name, actor: 'Owner', at: now });
    }
    lastStatusSnapshot.set(player.handle, player.online);
    lastUserSnapshot.set(player.handle, { name: player.name, online: player.online, admin: Boolean(player.admin) });
  });
  if (auditReady && lastSettingsSnapshot) {
    if (lastSettingsSnapshot.adminPassword !== adminPassword) activityEvents.unshift({ kind: 'settings', name: 'Admin-Passwort', actor: 'Owner', at: now });
    if (lastSettingsSnapshot.ownerPassword !== ownerPassword) activityEvents.unshift({ kind: 'settings', name: 'Owner-Passwort', actor: 'Owner', at: now });
  }
  lastSettingsSnapshot = { adminPassword, ownerPassword };
  queueDatabaseSave();
}

function renderActivityLog() {
  const container = document.querySelector('#activityLog');
  if (!container || document.querySelector('#ownerSettings').hidden) return;
  const entries = activityEvents.slice(0, 8);
  container.innerHTML = `<h3>Status-Verlauf <small>letzte ${entries.length} Ereignisse</small></h3>${entries.length ? entries.map(event => `<div class="activity-entry ${event.online ? '' : 'offline'}"><i></i><span><b>${event.name}</b> ist jetzt ${event.online ? 'online' : 'offline'}</span><time>${new Date(event.at).toLocaleTimeString('de-DE')}</time></div>`).join('') : '<small>Noch keine Statusänderungen gespeichert.</small>'}`;
}

function auditText(event) {
  if (event.kind === 'create') return 'wurde hinzugefügt';
  if (event.kind === 'remove') return 'wurde entfernt';
  if (event.kind === 'admin-add') return 'hat jetzt Admin-Rechte';
  if (event.kind === 'admin-remove') return 'hat keine Admin-Rechte mehr';
  if (event.kind === 'settings') return 'wurde aktualisiert';
  return `ist jetzt ${event.online ? 'online' : 'offline'}`;
}

function renderAuditLog() {
  const container = document.querySelector('#auditLog');
  if (!container || document.querySelector('#ownerSettings').hidden) return;
  const entries = activityEvents.slice(0, 20);
  container.innerHTML = `<h3>Audit-Protokoll <small>${entries.length} Einträge</small></h3>${entries.length ? entries.map(event => `<div class="audit-entry"><span>${event.kind === 'remove' ? '−' : event.kind === 'create' ? '+' : event.kind === 'settings' ? '⚙' : '✓'}</span><div><b>${event.name}</b> ${auditText(event)}<em>von ${event.actor || 'System'}</em></div><time>${new Date(event.at).toLocaleTimeString('de-DE')}</time></div>`).join('') : '<small>Noch keine Aktionen protokolliert.</small>'}`;
}

function renderOwnerStatusOverview() {
  const panel = document.querySelector('#ownerDialog');
  const history = document.querySelector('#ownerHistory');
  if (!panel.classList.contains('open') || document.querySelector('#ownerSettings').hidden) return;
  const now = Date.now();
  document.querySelector('#dashboardPlayers').textContent = players.length;
  document.querySelector('#dashboardOnline').textContent = players.filter(player => player.online).length;
  document.querySelector('#dashboardAdmins').textContent = players.filter(player => player.admin).length;
  document.querySelector('#dashboardOnlineAdmins').textContent = players.filter(player => player.admin && player.online).length;
  const visible = players.filter(player => statusFilter === 'all' || (statusFilter === 'online' && player.online) || (statusFilter === 'offline' && !player.online));
  history.innerHTML = `<h3>Live-Status aller Spieler <small>(${visible.length})</small></h3>${visible.map(player => `<div class="history-item"><span class="history-state ${player.online ? '' : 'offline'}">&bull; ${player.online ? 'ONLINE' : 'OFFLINE'}</span><b>${player.name}</b><span>seit ${Math.floor((now - player.statusChangedAt) / 1000)}s &middot; ${new Date(player.statusChangedAt).toLocaleTimeString('de-DE')}</span></div>`).join('')}`;
  renderActivityLog();
  renderAuditLog();
}

function selectAllStatus(online) {
  const error = document.querySelector('#bulkStatusError');
  pendingBulkStatus = online;
  error.textContent = `Auswahl gespeichert: Alle werden ${online ? 'online' : 'offline'} gesetzt.`;
  error.style.color = '#76e9c8';
  document.querySelector('#allOnline').classList.toggle('selected', online);
  document.querySelector('#allOffline').classList.toggle('selected', !online);
}

function applyPendingBulkStatus() {
  if (!ownerAuthenticated || pendingBulkStatus === null) return;
  const now = Date.now();
  players.forEach(player => { if (player.online !== pendingBulkStatus) { player.online = pendingBulkStatus; player.statusChangedAt = now; player.coolingDown = true; } });
  setTimeout(() => { players.forEach(player => player.coolingDown = false); render(); }, 3000);
  pendingBulkStatus = null;
  document.querySelector('#bulkStatusError').textContent = '';
  document.querySelector('#allOnline').classList.remove('selected');
  document.querySelector('#allOffline').classList.remove('selected');
}

document.querySelector('#allOnline').onclick = () => selectAllStatus(true);
document.querySelector('#allOffline').onclick = () => selectAllStatus(false);
document.querySelectorAll('[data-status-filter]').forEach(button => button.onclick = () => { statusFilter = button.dataset.statusFilter; document.querySelectorAll('[data-status-filter]').forEach(item => item.classList.toggle('active', item === button)); renderOwnerStatusOverview(); });
document.querySelector('#ownerForm').addEventListener('submit', applyPendingBulkStatus, true);
setInterval(() => { document.querySelector('#ownerClock').textContent = new Date().toLocaleTimeString('de-DE'); renderOwnerStatusOverview(); }, 1000);

const appRender = render;
render = () => {
  appRender();
  if (!players.length) document.querySelector('#playerList').innerHTML = '<div class="empty-state"><span>+</span><div><b>Keine Spieler im Server</b><small>Füge einen Spieler hinzu.</small></div></div>';
  captureStatusChanges();
  renderActivityLog();
  renderAuditLog();
};

updateAdminControls = () => {
  document.querySelectorAll('.actions,.add-form').forEach(element => element.classList.toggle('admin-locked', !isAdmin));
  document.querySelector('#adminOnlineCount').textContent = players.filter(player => player.online).length;
  document.querySelector('#adminPlayerCount').textContent = players.length;
  document.querySelector('#adminOnlineAdmins').textContent = players.filter(player => player.admin && player.online).length;
  document.querySelector('#adminSession').textContent = isAdmin ? 'AKTIV' : 'GESPERRT';
  document.querySelector('#adminFooterStatus').textContent = isAdmin ? 'Aktiv' : 'Gesperrt';
};

snapshotUsers();
render();
initializeDatabase();
