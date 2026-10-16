showDenied = (title = 'Zugriff verweigert', message = 'Passwort ist falsch.') => {
  document.querySelector('#deniedTitle').textContent = title;
  document.querySelector('#deniedMessage').textContent = message;
  clearTimeout(deniedTimer);
  denied.classList.remove('show');
  void denied.offsetWidth;
  denied.classList.add('show');
  deniedTimer = setTimeout(() => denied.classList.remove('show'), 5000);
};

document.querySelector('#passwordForm').onsubmit = event => {
  event.preventDefault();
  const value = document.querySelector('#adminPassword').value;
  if (pendingStatus !== null) {
    const player = players[pendingStatus];
    if (value !== adminPassword && value !== player.password) {
      closeDialog();
      showDenied('Status-Zugriff verweigert', 'Dein Status-Passwort ist falsch.');
      return;
    }
    const index = pendingStatus;
    closeDialog();
    pendingStatus = null;
    toggleStatus(index);
    return;
  }
  if (value !== adminPassword && !players.some(player => player.admin && player.password && player.password === value)) {
    closeDialog();
    showDenied('Admin-Zugriff verweigert', 'Admin-Passwort ist falsch.');
    return;
  }
  isAdmin = true;
  document.querySelector('#adminPanel').classList.remove('inactive');
  document.querySelector('#adminState').textContent = 'Admin-Modus aktiv';
  document.querySelector('#logout').textContent = 'Admin abmelden';
  closeDialog();
  render();
};

document.querySelector('#ownerForm').onsubmit = event => {
  event.preventDefault();
  if (!ownerAuthenticated) {
    if (document.querySelector('#ownerPassword').value !== ownerPassword) {
      document.querySelector('#ownerError').textContent = 'Owner-Passwort ist nicht korrekt.';
      showDenied('Owner-Zugriff verweigert', 'Owner-Passwort ist falsch.');
      return;
    }
    ownerAuthenticated = true;
    showOwnerSettings();
    return;
  }
  ownerPassword = document.querySelector('#ownerPasswordSetting').value;
  adminPassword = document.querySelector('#adminPasswordSetting').value;
  document.querySelectorAll('[data-player-password]').forEach(input => players[Number(input.dataset.playerPassword)].password = input.value);
  document.querySelectorAll('[data-player-admin]').forEach(input => players[Number(input.dataset.playerAdmin)].admin = input.checked);
  closeOwner();
  render();
};
