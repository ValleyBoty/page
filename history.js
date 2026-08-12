const BULK_STATUS_PASSWORD = 'Alle Spieler. Auf einen Blick.';
let pendingBulkStatus = null;
let statusFilter = 'all';

function renderOwnerStatusOverview() {
  const panel = document.querySelector('#ownerDialog');
  const history = document.querySelector('#ownerHistory');
  if (!panel.classList.contains('open') || document.querySelector('#ownerSettings').hidden) return;

  const now = Date.now();
  document.querySelector('#dashboardPlayers').textContent = players.length;
  document.querySelector('#dashboardOnline').textContent = players.filter(player => player.online).length;
  document.querySelector('#dashboardAdmins').textContent = players.filter(player => player.admin).length;
  const visiblePlayers = players.filter(player => statusFilter === 'all' || (statusFilter === 'online' && player.online) || (statusFilter === 'offline' && !player.online));
  history.innerHTML = `<h3>Live-Status aller Spieler <small>(${visiblePlayers.length})</small></h3>${visiblePlayers.map(player => {
    const seconds = Math.floor((now - player.statusChangedAt) / 1000);
    const state = player.online ? 'ONLINE' : 'OFFLINE';
    return `<div class="history-item"><span class="history-state ${player.online ? '' : 'offline'}">&bull; ${state}</span><b>${player.name}</b><span>seit ${seconds}s &middot; ${new Date(player.statusChangedAt).toLocaleTimeString('de-DE')}</span></div>`;
  }).join('')}`;
}

function selectAllStatus(online) {
  const password = document.querySelector('#bulkStatusPassword');
  const error = document.querySelector('#bulkStatusError');
  if (password.value !== BULK_STATUS_PASSWORD) {
    error.textContent = 'Passwort ist nicht korrekt.';
    error.style.color = '';
    return;
  }
  pendingBulkStatus = online;
  error.textContent = `Auswahl gespeichert: Alle werden ${online ? 'online' : 'offline'} gesetzt.`;
  error.style.color = '#76e9c8';
  document.querySelector('#allOnline').classList.toggle('selected', online);
  document.querySelector('#allOffline').classList.toggle('selected', !online);
}

function applyPendingBulkStatus() {
  if (!ownerAuthenticated || pendingBulkStatus === null) return;
  const now = Date.now();
  let changed = false;
  players.forEach(player => {
    if (player.online !== pendingBulkStatus) {
      player.online = pendingBulkStatus;
      player.statusChangedAt = now;
      player.coolingDown = true;
      changed = true;
    }
  });
  if (changed) setTimeout(() => { players.forEach(player => { player.coolingDown = false; }); render(); }, 3000);
  pendingBulkStatus = null;
  document.querySelector('#bulkStatusPassword').value = '';
  document.querySelector('#bulkStatusError').textContent = '';
  document.querySelector('#allOnline').classList.remove('selected');
  document.querySelector('#allOffline').classList.remove('selected');
}

document.querySelector('#allOnline').onclick = () => selectAllStatus(true);
document.querySelector('#allOffline').onclick = () => selectAllStatus(false);
document.querySelectorAll('[data-status-filter]').forEach(button => {
  button.onclick = () => {
    statusFilter = button.dataset.statusFilter;
    document.querySelectorAll('[data-status-filter]').forEach(item => item.classList.toggle('active', item === button));
    renderOwnerStatusOverview();
  };
});
document.querySelector('#ownerForm').addEventListener('submit', () => applyPendingBulkStatus(), true);
setInterval(() => {
  document.querySelector('#ownerClock').textContent = new Date().toLocaleTimeString('de-DE');
  renderOwnerStatusOverview();
}, 1000);

updateAdminControls = () => {
  document.querySelectorAll('.actions,.add-form').forEach(element => element.classList.toggle('admin-locked', !isAdmin));
  document.querySelector('#adminOnlineCount').textContent = players.filter(player => player.online).length;
  document.querySelector('#adminPlayerCount').textContent = players.length;
  document.querySelector('#adminSession').textContent = isAdmin ? 'AKTIV' : 'GESPERRT';
};
render();
