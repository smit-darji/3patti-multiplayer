/**
 * Teen Patti Client Orchestrator & Controller
 * Manages Home Page, Table Screen, Live Dealer, Auto-Blind, Master Admin, and Room Management.
 */
class TeenPattiApp {
  constructor() {
    this.socket = null;
    this.user = null;
    this.tableState = null;
    this.gameTable = null;
    this.stakeMultiplier = 1;
    this.autoBlind = false; // Resets each round — user enables per hand
    this.autoBlindTimer = null;
    this.soundEnabled = true;
    this.currentTipAmount = 50;
    this.prevSeats = []; // Track previous seat state for bot-join animation

    this.init();
  }

  async init() {
    this.isRegisterMode = false; // Default to login mode for seamless return / incognito logins

    // 1. Initialize table renderer
    const tableContainer = document.getElementById('poker-table-wrapper');
    this.gameTable = new GameTable(tableContainer);

    // 2. Populate Avatar Picker in Auth Modal
    this.initAvatarPicker();

    // 3. Bind DOM Events early
    this.bindEvents();

    // 4. Check local user session or saved auto-login credentials
    let loggedIn = false;
    const savedSession = localStorage.getItem('teen_patti_user');
    const savedCredsRaw = localStorage.getItem('saved_auth_creds');

    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        const res = await API.getMe(parsed.id);
        if (res.success && res.user) {
          this.user = res.user;
          this.onUserLoggedIn();
          loggedIn = true;
        }
      } catch (e) {}
    }

    if (!loggedIn && savedCredsRaw) {
      try {
        const creds = JSON.parse(savedCredsRaw);
        if (creds.username && creds.password) {
          // Prefill inputs
          const uEl = document.getElementById('auth-username');
          const pEl = document.getElementById('auth-password');
          const remEl = document.getElementById('auth-remember-me');
          if (uEl) uEl.value = creds.username;
          if (pEl) pEl.value = creds.password;
          if (remEl) remEl.checked = true;

          if (creds.autoLogin) {
            const loginRes = await API.login(creds.username, creds.password);
            if (loginRes.success && loginRes.user) {
              this.user = loginRes.user;
              this.onUserLoggedIn();
              loggedIn = true;
              this.showToast(`Auto-logged in as ${this.user.username}`, 'info');
            }
          }
        }
      } catch (e) {}
    }

    if (!loggedIn) {
      this.updateUserUI();
      this.switchAuthMode(false); // Open on Login tab by default
    }

    // 5. Connect Socket.IO
    this.initSocket();

    // 6. Check for room invite or direct table in URL (?room=CODE or ?join=CODE or ?table=ID or pathname /room/CODE)
    const urlParams = new URLSearchParams(window.location.search);
    let roomFromUrl = urlParams.get('room') || urlParams.get('join') || urlParams.get('table') || urlParams.get('code');
    if (!roomFromUrl) {
      const match = window.location.pathname.match(/\/(?:room|table)\/([A-Za-z0-9_-]+)/);
      if (match) roomFromUrl = match[1];
    }
    if (!roomFromUrl && window.location.hash) {
      const hash = window.location.hash.replace(/^#/, '');
      const hashParams = new URLSearchParams(hash);
      roomFromUrl = hashParams.get('room') || hashParams.get('join') || (hash.length >= 3 && !hash.includes('=') ? hash : null);
    }

    if (roomFromUrl) {
      const targetCode = roomFromUrl.trim();
      sessionStorage.setItem('pending_join_room', targetCode);
      this.pendingRoomTarget = targetCode;

      if (this.user) {
        this.joinRoomByCode(targetCode);
      } else {
        // Frictionless: Automatically create a guest session and jump directly into the room!
        this.quickGuestLogin(targetCode);
      }
    } else if (!loggedIn) {
      this.showAuthModal();
    }
  }

  initAvatarPicker() {
    const container = document.getElementById('auth-avatar-picker');
    if (!container || !window.HumanAvatars) return;

    container.innerHTML = HumanAvatars.list.map((av, idx) => `
      <img src="${HumanAvatars.getSvg(av.id)}" class="avatar-option ${idx === 0 ? 'selected' : ''}" 
           data-avatar="${av.id}" title="${av.name} (${av.title})" alt="${av.name}">
    `).join('');

    container.querySelectorAll('.avatar-option').forEach(img => {
      img.addEventListener('click', () => {
        container.querySelectorAll('.avatar-option').forEach(i => i.classList.remove('selected'));
        img.classList.add('selected');
        this.selectedAuthAvatar = img.dataset.avatar;
      });
    });

    this.selectedAuthAvatar = HumanAvatars.list[0].id;
  }

  initSocket() {
    this.socket = io();

    this.socket.on('connect', () => {
      console.log('⚡ Connected to game server');
      if (this.pendingRoomTarget && this.user) {
        const room = this.pendingRoomTarget;
        this.pendingRoomTarget = null;
        this.joinRoomByCode(room);
      }
    });

    this.socket.on('TABLE_STATE', (state) => {
      this.tableState = state;
      this.renderTable();
      this.updateTipUI();
      if (state.vipCompanion) {
        this.startVipCompanionKissLoop();
      } else {
        this.stopVipCompanionKissLoop();
      }
    });

    this.socket.on('TABLE_EVENT', ({ event, data }) => {
      this.handleTableEvent(event, data);
    });

    this.socket.on('ROOM_CLOSED', (data) => {
      this.handleRoomClosedByOwner(data);
    });

    this.socket.on('ERROR', ({ message }) => {
      this.showToast(message, 'error');
    });

    this.socket.on('SYSTEM_MESSAGE', (msg) => {
      this.showToast(msg, 'info');
    });

    this.socket.on('BALANCE_UPDATE', ({ chips }) => {
      if (this.user) {
        this.user.chips = chips;
        this.updateUserUI();
      }
      if (this.tableState && this.tableState.seats) {
        const mySeat = this.tableState.seats.find(s => s && s.id === this.user?.id);
        if (mySeat) {
          mySeat.chips = chips;
          this.gameTable.render(this.tableState, this.user?.id);
        }
      }
    });
  }

  async quickGuestLogin(roomToJoin = null) {
    try {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const guestName = `Guest_${randomSuffix}`;
      const guestPass = `pass_${randomSuffix}_${Date.now().toString(36)}`;
      const randomAvatar = `human-${Math.floor(1 + Math.random() * 8)}`;

      const res = await API.register(guestName, guestPass, randomAvatar);
      if (res.success && res.user) {
        this.user = res.user;
        this.onUserLoggedIn();
        this.showToast(`Joined as ${guestName} (₹10 Lakh free chips)`, 'success');
        if (roomToJoin) {
          this.joinRoomByCode(roomToJoin);
        }
        return res.user;
      }
    } catch (e) {
      console.warn('Guest login error, showing auth modal:', e);
      this.showAuthModal();
    }
  }

  async joinRoomByCode(code) {
    if (!code) return;
    const cleanCode = code.trim();

    // If socket isn't connected yet, stash as pendingRoomTarget and execute on connect
    if (!this.socket || !this.socket.connected) {
      this.pendingRoomTarget = cleanCode;
      return;
    }

    if (!this.user) {
      sessionStorage.setItem('pending_join_room', cleanCode);
      await this.quickGuestLogin(cleanCode);
      return;
    }

    try {
      // 1. Resolve room code or preset key through API
      const res = await API.joinCode(cleanCode);
      if (res && res.success && res.tableId) {
        this.enterTable(res.tableId);
        return;
      }
    } catch (err) {
      console.log('API joinCode failed, trying direct table join:', err);
    }

    // 2. Direct table enter by code/id
    this.enterTable(cleanCode);
  }

  onUserLoggedIn() {
    localStorage.setItem('teen_patti_user', JSON.stringify(this.user));
    this.hideAuthModal();
    this.updateUserUI();

    // Check if user came from an invite link
    const pendingRoom = sessionStorage.getItem('pending_join_room') || this.pendingRoomTarget;
    if (pendingRoom) {
      sessionStorage.removeItem('pending_join_room');
      this.pendingRoomTarget = null;
      this.joinRoomByCode(pendingRoom);
    } else {
      // Always land on Home Page first!
      this.showHomeView();
    }
  }

  isMasterUser() {
    return !!(this.user && (this.user.role === 'master' || this.user.role === 'admin' || this.user.username === 'master' || this.user.username === 'admin'));
  }

  updateUserUI() {
    const loginBtn = document.getElementById('btn-header-login');
    const logoutBtn = document.getElementById('btn-header-logout');

    if (!this.user) {
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (logoutBtn) logoutBtn.style.display = 'none';
      return;
    }

    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';

    const avatarSvg = window.HumanAvatars ? HumanAvatars.getSvg(this.user.avatar) : '';
    const isMaster = this.isMasterUser();

    // Home Header Profile
    const homeAvatar = document.getElementById('home-user-avatar');
    const homeName = document.getElementById('home-user-name');
    const homeChips = document.getElementById('home-user-chips');
    if (homeAvatar) homeAvatar.src = avatarSvg;
    if (homeName) homeName.textContent = this.user.username;
    if (homeChips) homeChips.textContent = this.formatChips(this.user.chips);

    // Hero Profile Card
    const heroAvatar = document.getElementById('hero-avatar-big');
    const heroName = document.getElementById('hero-username-big');
    const heroChips = document.getElementById('hero-chips-big');
    const heroRole = document.getElementById('hero-role-badge');
    if (heroAvatar) heroAvatar.src = avatarSvg;
    if (heroName) heroName.textContent = this.user.username;
    if (heroChips) heroChips.textContent = this.formatChips(this.user.chips);
    if (heroRole) {
      heroRole.textContent = isMaster ? '👑 MASTER & ADMIN SPECTATOR' : 'VIP PLAYER';
      heroRole.style.background = isMaster ? 'linear-gradient(135deg,#f59e0b,#b45309)' : 'linear-gradient(135deg,#10b981,#059669)';
    }

    // Table Header Profile
    const tableAvatar = document.getElementById('table-user-avatar');
    const tableUser = document.getElementById('table-user-name');
    const tableChips = document.getElementById('table-user-chips');
    if (tableAvatar) tableAvatar.src = avatarSvg;
    if (tableUser) tableUser.textContent = this.user.username;
    if (tableChips) tableChips.textContent = this.formatChips(this.user.chips);

    // Show Master Admin buttons if user is master
    const masterBtnHome = document.getElementById('btn-master-panel-toggle');
    const masterBtnTable = document.getElementById('btn-table-master-panel');
    const masterBtnHero = document.getElementById('hero-btn-master-panel');
    if (masterBtnHome) masterBtnHome.style.display = isMaster ? 'inline-flex' : 'none';
    if (masterBtnTable) masterBtnTable.style.display = isMaster ? 'inline-flex' : 'none';
    if (masterBtnHero) masterBtnHero.style.display = isMaster ? 'block' : 'none';
  }

  // --- VIEW SWITCHING ---

  showHomeView() {
    document.getElementById('view-home')?.classList.remove('view-hidden');
    document.getElementById('view-table')?.classList.add('view-hidden');
    this.loadHomeRooms();
  }

  showTableView() {
    document.getElementById('view-home')?.classList.add('view-hidden');
    document.getElementById('view-table')?.classList.remove('view-hidden');
  }

  // --- HOME PAGE ROOMS ---

  async loadHomeRooms() {
    const grid = document.getElementById('home-rooms-grid');
    if (!grid) return;

    try {
      const res = await API.getTables();
      if (!res.success) return;

      grid.innerHTML = res.tables.map(t => `
        <div class="table-card">
          <div>
            <div class="table-card-top">
              <span class="table-card-name">${t.name}</span>
              <span class="table-card-code">ID: ${t.code || t.id}</span>
            </div>
            <div class="table-card-details">
              <div class="table-card-row">
                <span>Boot (Ante):</span>
                <span>${this.formatChips(t.bootAmount)}</span>
              </div>
              <div class="table-card-row">
                <span>Pot Limit:</span>
                <span>${this.formatChips(t.potLimit)}</span>
              </div>
              <div class="table-card-row">
                <span>Players Seated:</span>
                <span style="color:#a7f3d0;">${t.playerCount}/10 Players</span>
              </div>
              <div class="table-card-row">
                <span>Current Pot:</span>
                <span style="color:#ffd700;">${this.formatChips(t.pot)}</span>
              </div>
            </div>
          </div>

          <div class="table-card-actions">
            <button class="btn-card-enter" onclick="window.app.enterTable('${t.id}')">Enter Table</button>
            <button class="btn-card-copy" onclick="window.app.copyText('${t.code || t.id}','Room Code')" title="Copy Room Code">📋</button>
          </div>
        </div>
      `).join('');
    } catch (e) {
      console.error(e);
    }
  }

  enterTable(tableId) {
    if (!this.user || !this.socket) return;

    // Always clear any lingering celebration overlay from a previous game
    this.resetCelebrationOverlay();

    this.socket.emit('JOIN_TABLE', {
      tableId: tableId,
      user: this.user
    });
    this.showTableView();
    this.showToast('Welcome to the table! Take a seat to play.', 'info');
  }

  handleLeaveTable() {
    const isOwner = this.tableState && (this.tableState.isOwner || (this.user && this.tableState.ownerId === this.user.id));
    const isCustomRoom = this.tableState && (this.tableState.isPrivate || !this.tableState.tableId?.startsWith('pub_'));

    const modal = document.getElementById('modal-confirm-exit');
    if (!modal) {
      this.executeLeaveTable();
      return;
    }

    const badge = document.getElementById('confirm-exit-badge');
    const title = document.getElementById('confirm-exit-title');
    const desc = document.getElementById('confirm-exit-desc');
    const iconSym = document.getElementById('confirm-exit-icon-symbol');
    const iconWrap = document.getElementById('confirm-exit-icon');
    const proceedBtn = document.getElementById('btn-confirm-exit-proceed');
    const proceedText = document.getElementById('btn-confirm-exit-text');

    if (isOwner && isCustomRoom) {
      if (badge) {
        badge.textContent = '👑 ROOM OWNER ALERT';
        badge.style.borderColor = '#f59e0b';
        badge.style.color = '#fde047';
        badge.style.background = 'rgba(245,158,11,0.18)';
      }
      if (iconSym) iconSym.textContent = '👑';
      if (iconWrap) {
        iconWrap.style.borderColor = '#f59e0b';
        iconWrap.style.boxShadow = '0 0 25px rgba(245,158,11,0.5)';
      }
      if (title) title.textContent = 'Close Table & Return to Lobby?';
      if (desc) desc.innerHTML = 'You are the <strong>Room Owner</strong>.<br>Leaving will close this game room for everyone and return all players to the main lobby.';
      if (proceedText) proceedText.textContent = 'Close Room & Exit';
      if (proceedBtn) {
        proceedBtn.style.background = 'linear-gradient(135deg, #ef4444, #b91c1c)';
        proceedBtn.style.borderColor = '#f87171';
        proceedBtn.style.boxShadow = '0 4px 18px rgba(239,68,68,0.45)';
      }
    } else {
      if (badge) {
        badge.textContent = '🚪 TABLE EXIT';
        badge.style.borderColor = '#38bdf8';
        badge.style.color = '#7dd3fc';
        badge.style.background = 'rgba(56,189,248,0.15)';
      }
      if (iconSym) iconSym.textContent = '🚪';
      if (iconWrap) {
        iconWrap.style.borderColor = '#38bdf8';
        iconWrap.style.boxShadow = '0 0 25px rgba(56,189,248,0.5)';
      }
      if (title) title.textContent = 'Exit Game Room?';
      if (desc) desc.innerHTML = 'Are you sure you want to leave this table and return to the <strong>Home Lobby</strong>?';
      if (proceedText) proceedText.textContent = 'Leave Table';
      if (proceedBtn) {
        proceedBtn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        proceedBtn.style.borderColor = '#fbbf24';
        proceedBtn.style.boxShadow = '0 4px 18px rgba(245,158,11,0.35)';
      }
    }

    modal.classList.add('active');
  }

  closeConfirmExitModal() {
    document.getElementById('modal-confirm-exit')?.classList.remove('active');
  }

  executeLeaveTable() {
    this.closeConfirmExitModal();
    this.stopVipCompanionKissLoop();
    this.resetCelebrationOverlay();

    // Remove any active walker
    document.querySelectorAll('.carnival-queen-walker').forEach(el => el.remove());
    this.isCarnivalQueenWalking = false;
    this.carnivalWalkingTargetSeat = null;

    // Close any table-specific modals
    const sideshowModal = document.getElementById('sideshow-modal');
    if (sideshowModal) sideshowModal.style.display = 'none';
    document.getElementById('sideshow-result-modal')?.classList.remove('active');
    document.getElementById('room-friends-modal')?.classList.remove('active');
    document.getElementById('modal-room-closed')?.classList.remove('active');

    if (this.socket) {
      try {
        this.socket.emit('LEAVE_TABLE');
      } catch (e) {}
    }

    this.tableState = null;
    this.showHomeView();
    window.history.pushState(null, '', '/');
    this.updateUserUI();
    this.loadHomeRooms();
    this.showToast('Left table. Welcome back to the lobby!', 'info');
  }

  handleRoomClosedByOwner(data) {
    this.closeConfirmExitModal();
    this.stopVipCompanionKissLoop();
    this.resetCelebrationOverlay();

    // Remove any active walker
    document.querySelectorAll('.carnival-queen-walker').forEach(el => el.remove());
    this.isCarnivalQueenWalking = false;
    this.carnivalWalkingTargetSeat = null;

    // Close any table modals
    const sideshowModal = document.getElementById('sideshow-modal');
    if (sideshowModal) sideshowModal.style.display = 'none';
    document.getElementById('sideshow-result-modal')?.classList.remove('active');
    document.getElementById('room-friends-modal')?.classList.remove('active');

    // Immediately open the Home Lobby page!
    this.tableState = null;
    this.showHomeView();
    window.history.pushState(null, '', '/');
    this.updateUserUI();
    this.loadHomeRooms();

    // Update message
    const desc = document.getElementById('room-closed-desc');
    if (desc) {
      desc.innerHTML = `The room owner (<strong>${data.ownerName || 'Host'}</strong>) has left the table. The game session has ended.`;
    }

    // Load available active tables to populate quick list
    const listEl = document.getElementById('room-closed-quick-list');
    if (listEl) {
      listEl.innerHTML = '<div style="color:#94a3b8;font-size:0.8rem;text-align:center;padding:8px;">Loading live tables...</div>';
      API.getTables().then(res => {
        if (res && res.tables && res.tables.length > 0) {
          listEl.innerHTML = res.tables.slice(0, 4).map(t => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:rgba(30,41,59,0.7);border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
              <div>
                <div style="font-weight:700;font-size:0.82rem;color:#f1f5f9;">${t.name}</div>
                <div style="font-size:0.7rem;color:#94a3b8;">Boot: ₹${(t.bootAmount).toLocaleString()} • Players: ${t.playerCount || 0}/10</div>
              </div>
              <button class="btn-hero-join" onclick="window.app.enterTableFromClosedModal('${t.id}')" style="padding:4px 10px;font-size:0.75rem;">
                Join Table
              </button>
            </div>
          `).join('');
        } else {
          listEl.innerHTML = '<div style="color:#94a3b8;font-size:0.8rem;text-align:center;padding:8px;">No other tables active right now.</div>';
        }
      }).catch(() => {
        listEl.innerHTML = '';
      });
    }

    // Display room closed modal
    document.getElementById('modal-room-closed')?.classList.add('active');

    if (window.sound && window.sound.playFold) {
      window.sound.playFold();
    }
  }

  enterTableFromClosedModal(tableId) {
    document.getElementById('modal-room-closed')?.classList.remove('active');
    this.enterTable(tableId);
  }

  handleRoomClosedGoHome() {
    document.getElementById('modal-room-closed')?.classList.remove('active');
    this.showHomeView();
    window.history.pushState(null, '', '/');
    this.updateUserUI();
    this.loadHomeRooms();
    this.showToast('Returned to Home Lobby.', 'info');
  }

  handleRoomClosedJoinOther() {
    document.getElementById('modal-room-closed')?.classList.remove('active');
    this.showHomeView();
    window.history.pushState(null, '', '/');
    this.updateUserUI();
    this.loadHomeRooms();

    // Focus room ID input and scroll to tables section
    setTimeout(() => {
      const input = document.getElementById('home-room-code-input');
      if (input) {
        input.focus();
      }
      const grid = document.getElementById('home-rooms-grid');
      if (grid) {
        grid.scrollIntoView({ behavior: 'smooth' });
      }
      this.showToast('Select an active table below or enter a Room ID!', 'info');
    }, 150);
  }

  resetCelebrationOverlay() {
    const overlay = document.getElementById('celebration-overlay');
    if (overlay) overlay.classList.remove('active');

    // Clear all winner fields
    const nameEl = document.getElementById('celebration-winner-name');
    const handEl = document.getElementById('celebration-hand-title');
    const amtEl = document.getElementById('celebration-amount');
    const cardsRow = document.getElementById('celebration-cards-row');
    if (nameEl) nameEl.textContent = '';
    if (handEl) handEl.innerHTML = '';
    if (amtEl) amtEl.textContent = '';
    if (cardsRow) cardsRow.innerHTML = '';

    // Reset intermission timer display back to 5s
    const fillCircle = document.getElementById('intermission-fill-circle');
    const textEl = document.getElementById('intermission-countdown-text');
    const boldEl = document.getElementById('intermission-timer-bold');
    if (fillCircle) fillCircle.style.strokeDashoffset = '0';
    if (textEl) textEl.textContent = '5s';
    if (boldEl) boldEl.textContent = '5s';
  }

  // --- JOIN BY ROOM ID ---

  async handleJoinByInput() {
    const input = document.getElementById('home-room-code-input');
    const code = input ? input.value.trim() : '';
    if (!code) {
      this.showToast('Please enter a Room ID', 'warning');
      return;
    }

    try {
      const res = await API.joinCode(code);
      if (res.success && res.tableId) {
        this.enterTable(res.tableId);
      } else {
        this.showToast(res.error || 'Room not found with that ID', 'error');
      }
    } catch (err) {
      this.showToast('Invalid room code', 'error');
    }
  }

  // --- CREATE ROOM ---

  openCreateRoomModal() {
    document.getElementById('create-room-modal')?.classList.add('active');
  }

  closeCreateRoomModal() {
    document.getElementById('create-room-modal')?.classList.remove('active');
  }

  async handleCreateRoomSubmit(e) {
    e.preventDefault();
    const nameInput = document.getElementById('create-room-name');
    const bootSelect = document.getElementById('create-room-boot');
    const potSelect = document.getElementById('create-room-pot-limit');
    const isPrivateCheck = document.getElementById('create-room-private');
    const sizeSelect = document.getElementById('create-room-size');

    const name = nameInput ? nameInput.value.trim() : 'Private Lounge';
    const boot = parseInt(bootSelect.value, 10) || 1000;
    const potMult = parseInt(potSelect.value, 10) || 1024;
    const potLimit = boot * potMult;
    const isPrivate = isPrivateCheck ? isPrivateCheck.checked : true;
    const maxPlayers = parseInt(sizeSelect?.value, 10) || 10;
    const variationSelect = document.getElementById('create-room-variation');
    const variation = variationSelect ? variationSelect.value : 'classic';

    try {
      const res = await API.createTable(name, boot, potLimit, isPrivate, variation, maxPlayers, this.user?.id, this.user?.username);
      if (res.success && res.table) {
        this.closeCreateRoomModal();
        this.enterTable(res.table.id);

        const code = res.table.code || res.table.id;
        this.copyToClipboard(code).catch(() => {});
        this.showToast(`🎉 Room "${res.table.name}" (${res.table.maxPlayers || maxPlayers} Players) created! Room Code "${code}" copied.`, 'success');
      }
    } catch (err) {
      this.showToast('Failed to create room', 'error');
    }
  }

  copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (successful) {
          resolve();
        } else {
          reject(new Error('execCommand failed'));
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  copyText(text, label = 'Text') {
    this.copyToClipboard(text).then(() => {
      this.showToast(`📋 ${label} "${text}" copied!`, 'success');
    }).catch(() => {
      this.showToast(`${label}: ${text}`, 'info');
    });
  }

  copyCurrentRoomCode() {
    const code = this.tableState?.roomCode || this.tableState?.tableId;
    if (code) {
      this.copyToClipboard(code).then(() => {
        this.showToast(`📋 Room Code "${code}" copied!`, 'success');
      }).catch(() => {
        this.showToast(`Room Code is: ${code}`, 'info');
      });
    }
  }

  copyCurrentRoomLink() {
    const code = this.tableState?.roomCode || this.tableState?.tableId;
    if (code) {
      const inviteUrl = `${window.location.origin}/?room=${encodeURIComponent(code)}`;
      this.copyToClipboard(inviteUrl).then(() => {
        this.showToast(`🔗 Invite link copied to clipboard! Share with friends to auto-join.`, 'success');
      }).catch(() => {
        this.showToast(`Invite Link: ${inviteUrl}`, 'info');
      });
    }
  }

  // --- LIVE DEALER & TIPPING ---

  adjustTip(direction) {
    const presets = [50, 100, 250, 500, 1000, 5000, 10000];
    const current = this.currentTipAmount || 50;
    let idx = presets.indexOf(current);
    if (idx === -1) {
      idx = presets.findIndex(p => p >= current);
      if (idx === -1) idx = presets.length - 1;
    }
    const newIdx = Math.max(0, Math.min(presets.length - 1, idx + direction));
    this.currentTipAmount = presets[newIdx];
    this.updateTipUI();
  }

  setTipAmount(amount) {
    this.currentTipAmount = Math.max(50, amount);
    this.updateTipUI();
  }

  quickTip(amount) {
    this.currentTipAmount = amount;
    this.updateTipUI();
    this.sendCustomTip();
  }

  updateTipUI() {
    const amt = this.currentTipAmount || 50;
    const displayEl = document.getElementById('dealer-tip-val');
    const sendBtn = document.getElementById('btn-send-tip-action');
    const is10kClaimedByOther = this.tableState && this.tableState.round10kTipUserId && this.tableState.round10kTipUserId !== this.user?.id;

    if (displayEl) {
      if (amt >= 10000 && is10kClaimedByOther) {
        displayEl.innerHTML = `<span style="color:#ef4444;font-size:0.75rem;font-weight:bold;">👑 CLAIMED</span>`;
      } else {
        displayEl.textContent = this.formatChips(amt);
      }
    }

    if (sendBtn) {
      if (amt >= 10000) {
        if (is10kClaimedByOther) {
          sendBtn.disabled = true;
          sendBtn.style.opacity = '0.5';
          sendBtn.style.cursor = 'not-allowed';
          sendBtn.innerHTML = `👑 Claimed`;
          sendBtn.title = `10K VIP Dealer already claimed by ${this.tableState.round10kTipUserName || 'another player'} this round`;
        } else {
          sendBtn.disabled = false;
          sendBtn.style.opacity = '1';
          sendBtn.style.cursor = 'pointer';
          sendBtn.innerHTML = `👑 10K VIP`;
          sendBtn.title = `Bring Carnival Queen VIP Dealer to sit beside you this round!`;
        }
      } else {
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        sendBtn.style.cursor = 'pointer';
        sendBtn.innerHTML = `💋 Tip`;
        sendBtn.title = `Tip Scarlett ${this.formatChips(amt)}`;
      }
    }

    // Update quick chip styling if present
    document.querySelectorAll('.btn-quick-chip').forEach(btn => {
      const chipVal = parseInt(btn.getAttribute('data-amount'), 10);
      if (chipVal === 10000 && is10kClaimedByOther) {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
        btn.title = `10K VIP already claimed this round`;
      } else {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
      }
    });
  }

  sendCustomTip() {
    this.tipDealer(this.currentTipAmount || 50);
  }

  async tipDealer(amount = 50) {
    if (!this.user) return;
    const numTip = parseInt(amount, 10) || 50;

    // Check round exclusivity client-side
    if (numTip >= 10000 && this.tableState && this.tableState.round10kTipUserId && this.tableState.round10kTipUserId !== this.user.id) {
      this.showToast(`👑 10K VIP Dealer is exclusive! ${this.tableState.round10kTipUserName || 'Another player'} has her this round. You can tip ₹500 - ₹5K!`, 'warning');
      return;
    }

    if (this.user.chips < numTip) {
      this.showToast(`Insufficient chips to tip ${this.formatChips(numTip)}`, 'warning');
      return;
    }

    try {
      // Direct socket emit with complete payload
      if (this.socket && this.socket.connected && this.tableState) {
        this.socket.emit('TIP_DEALER', {
          amount: numTip,
          userId: this.user.id,
          tableId: this.tableState.tableId
        });
      } else {
        const res = await API.tipDealer(this.user.id, numTip);
        if (res.success) {
          this.user.chips = res.chips;
          this.updateUserUI();

          if (this.tableState && this.tableState.seats) {
            const mySeat = this.tableState.seats.find(s => s && s.id === this.user.id);
            if (mySeat) {
              mySeat.chips = res.chips;
              this.gameTable.render(this.tableState, this.user.id);
            }
          }
          const formattedGift = this.formatChips(res.bonusGift);
          this.animateTipCoinsFromSeat(mySeat ? mySeat.seatIndex : -1, formattedGift, this.user?.username, numTip);
        }
      }
    } catch (err) {
      this.showToast(err.message || 'Cannot tip right now.', 'warning');
    }
  }

  animateTipCoins() {
    const mySeat = this.tableState?.seats.find(s => s && s.id === this.user?.id);
    this.animateTipCoinsFromSeat(mySeat ? mySeat.seatIndex : -1);
  }

  animateTipCoinsFromSeat(seatIndex, formattedGift = null, userName = null, rawTip = 50) {
    const felt = document.getElementById('table-felt');
    if (!felt) return;

    const feltRect = felt.getBoundingClientRect();
    const coinCount = 8;
    const isVipTip = (parseInt(rawTip, 10) || 50) >= 1000;

    // Dynamic Origin: player's seated avatar center relative to felt
    let originX = feltRect.width * 0.50;
    let originY = feltRect.height * 0.83;

    if (seatIndex !== undefined && seatIndex !== -1) {
      const seatEl = document.querySelector(`.player-seat[data-seat-index="${seatIndex}"]`);
      if (seatEl) {
        const seatRect = seatEl.getBoundingClientRect();
        originX = (seatRect.left + seatRect.width / 2) - feltRect.left;
        originY = (seatRect.top + seatRect.height / 2) - feltRect.top;
      }
    } else {
      const selfSeatEl = document.querySelector('.player-seat.seat-self');
      if (selfSeatEl) {
        const seatRect = selfSeatEl.getBoundingClientRect();
        originX = (seatRect.left + seatRect.width / 2) - feltRect.left;
        originY = (seatRect.top + seatRect.height / 2) - feltRect.top;
      }
    }

    // Dynamic Target: live dealer podium center relative to felt
    let targetX = feltRect.width * 0.50;
    let targetY = feltRect.height * 0.22;
    const dealerEl = document.querySelector('.dealer-girl-avatar') || document.querySelector('.live-dealer-podium');
    if (dealerEl) {
      const dealerRect = dealerEl.getBoundingClientRect();
      targetX = (dealerRect.left + dealerRect.width / 2) - feltRect.left;
      targetY = (dealerRect.top + dealerRect.height / 2) - feltRect.top;
    }

    // On 10K tip, play proper kiss "MUAAAH" sound instead of coin sound
    if ((parseInt(rawTip, 10) || 0) >= 10000) {
      if (window.sound && window.sound.playKiss) window.sound.playKiss();
    } else {
      if (window.sound && window.sound.playChip) window.sound.playChip();
    }

    for (let i = 0; i < coinCount; i++) {
      setTimeout(() => {
        const coin = document.createElement('div');
        coin.className = 'tip-flying-coin';

        const spreadX = (Math.random() - 0.5) * 24;
        const spreadY = (Math.random() - 0.5) * 12;
        const spinDeg = 360 + Math.floor(Math.random() * 360);
        const driftX = (Math.random() - 0.5) * 50;
        const duration = 650 + Math.random() * 150;

        coin.style.left = `${originX + spreadX}px`;
        coin.style.top = `${originY + spreadY}px`;
        coin.style.setProperty('--tx', `${targetX - originX - spreadX + driftX}px`);
        coin.style.setProperty('--ty', `${targetY - originY - spreadY}px`);
        coin.style.setProperty('--spin', `${spinDeg}deg`);
        coin.style.setProperty('--dur', `${duration}ms`);

        felt.appendChild(coin);

        setTimeout(() => coin.remove(), duration + 100);
      }, i * 60);
    }

    const lastArrival = coinCount * 60 + 400;
    setTimeout(() => {
      const dealerFigure = document.querySelector('.dealer-live-figure, #dealer-live-figure, .dealer-girl-avatar');
      if (dealerFigure) {
        dealerFigure.classList.remove('tip-received');
        dealerFigure.classList.remove('dealer-blowing-kiss');
        void dealerFigure.offsetWidth;
        dealerFigure.classList.add('tip-received');

        if (isVipTip) {
          // Switch to 3D kissing pose frame!
          dealerFigure.src = '/images/dealer_kiss_figure.png';
          dealerFigure.classList.add('dealer-blowing-kiss');
          setTimeout(() => {
            dealerFigure.src = '/images/dealer_scarlett_transparent.png';
            dealerFigure.classList.remove('dealer-blowing-kiss');
            dealerFigure.classList.remove('tip-received');
          }, 2400);
        } else {
          setTimeout(() => dealerFigure.classList.remove('tip-received'), 1100);
        }
      }

      // On 10K tip, VIP Carnival Queen walks around table and sits beside tip provider!
      // On 5K tip, she visits via flight.
      if (rawTip >= 10000) {
        this.animateCarnivalQueenWalkAroundTable(seatIndex, originX, originY, targetX, targetY, rawTip);
      } else if (rawTip >= 5000) {
        this.animateCarnivalVipCompanionVisit(seatIndex, targetX, targetY, originX, originY, rawTip);
      } else if (isVipTip) {
        this.animateDealerKissToSeat(seatIndex, targetX, targetY, originX, originY, formattedGift);
      }
    }, lastArrival);
  }

  animateCarnivalQueenWalkAroundTable(seatIndex, originX, originY, targetX, targetY, rawTip) {
    const felt = document.getElementById('table-felt');
    if (!felt) return;

    const feltRect = felt.getBoundingClientRect();
    if (!feltRect.width || !feltRect.height) return;

    // Clean up any previous walkers
    document.querySelectorAll('.carnival-queen-walker').forEach(el => el.remove());

    // Mark walking state so static companion is not displayed prematurely
    this.isCarnivalQueenWalking = true;
    this.carnivalWalkingTargetSeat = seatIndex;

    // 1. Starting position at the dealer podium (top of the table felt)
    let sX = feltRect.width * 0.50;
    let sY = feltRect.height * 0.22;
    const dealerEl = document.querySelector('.live-dealer-podium') || document.querySelector('.dealer-figure-stage');
    if (dealerEl) {
      const dr = dealerEl.getBoundingClientRect();
      sX = (dr.left + dr.width / 2) - feltRect.left;
      sY = (dr.bottom - 10) - feltRect.top;
    }

    // 2. Destination coordinates right beside the tip provider's seat
    const seatSelector = (seatIndex !== undefined && seatIndex !== -1)
      ? `.player-seat[data-seat-index="${seatIndex}"]`
      : '.player-seat.seat-self';
    const targetSeatEl = document.querySelector(seatSelector);

    let destX = feltRect.width * 0.50;
    let destY = feltRect.height * 0.82;

    if (targetSeatEl) {
      const sr = targetSeatEl.getBoundingClientRect();
      const relRight = sr.right - feltRect.left;
      const isTooCloseRight = relRight > (feltRect.width - 65);
      destX = isTooCloseRight ? (sr.left - feltRect.left - 20) : (relRight + 12);
      destY = (sr.top + sr.height * 0.28) - feltRect.top;

      // Temporarily hide any rendered companion on this seat until walk finishes
      const existingComp = targetSeatEl.querySelector('.seat-vip-companion');
      if (existingComp) {
        existingComp.classList.add('vip-companion-waiting-walk');
      }
    }

    // 3. Elliptical table walk track parameters
    const cX = feltRect.width * 0.50;
    const cY = feltRect.height * 0.50;
    const rx = Math.max(120, feltRect.width * 0.39);
    const ry = Math.max(90, feltRect.height * 0.32);

    // Track start at top (angle -90 deg)
    const angleStart = -Math.PI / 2;
    const trackStartX = cX + rx * Math.cos(angleStart);
    const trackStartY = cY + ry * Math.sin(angleStart);

    // Track destination angle near player seat
    const angleEnd = Math.atan2(destY - cY, destX - cX);
    let sweep = angleEnd - angleStart;
    while (sweep <= 0) sweep += 2 * Math.PI;

    // Full 360 degree victory lap around the whole table felt plus sweep to seat
    const totalAngle = sweep + (2 * Math.PI);
    const trackEndX = cX + rx * Math.cos(angleEnd);
    const trackEndY = cY + ry * Math.sin(angleEnd);

    // 4. Create walking character DOM element
    const walker = document.createElement('div');
    walker.className = 'carnival-queen-walker';
    walker.innerHTML = `
      <div class="walker-name-badge">
        <span class="walker-crown">👑</span>
        <span class="walker-title">10K VIP QUEEN</span>
        <span class="walker-heart">💋</span>
      </div>
      <div class="walker-aura"></div>
      <div class="walker-figure-wrapper">
        <img src="/images/dealer_carnival_vip.png" class="walker-figure-img" alt="Carnival Queen" />
      </div>
      <div class="walker-shadow"></div>
    `;
    walker.style.left = `${sX}px`;
    walker.style.top = `${sY}px`;
    felt.appendChild(walker);

    const fig = walker.querySelector('.walker-figure-wrapper');
    const shadow = walker.querySelector('.walker-shadow');

    // Initial audio and announcement
    if (window.sound && window.sound.playKiss) {
      window.sound.playKiss();
    }
    this.showToast('👑 VIP Carnival Queen is walking around the table to sit beside you! 💋✨', 'info');

    // Helper for sparkling footsteps
    const spawnSparkle = (x, y) => {
      if (!felt) return;
      const sp = document.createElement('div');
      sp.className = 'walker-footprint-sparkle';
      const symbols = ['✨', '💋', '⭐', '💖', '🍀', '✨'];
      sp.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      sp.style.left = `${x + (Math.random() - 0.5) * 14}px`;
      sp.style.top = `${y + 4 + (Math.random() - 0.5) * 6}px`;
      felt.appendChild(sp);
      setTimeout(() => sp.remove(), 850);
    };

    // 5. High-precision animation loop
    const duration = 4000; // 4 seconds total
    const startTime = performance.now();
    let lastX = sX;
    let facing = 1;
    let lastSparkleTime = 0;
    let lastStepIdx = -1;

    const tick = (now) => {
      // If view switched or walker removed, cancel
      if (!walker.parentElement) return;

      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      let curX, curY;

      if (progress < 0.07) {
        // Step forward from dealer stage onto table track
        const t = progress / 0.07;
        curX = sX + (trackStartX - sX) * t;
        curY = sY + (trackStartY - sY) * t;
      } else if (progress < 0.90) {
        // Walk smoothly around the table perimeter ellipse
        const t = (progress - 0.07) / 0.83;
        const curAngle = angleStart + (t * totalAngle);
        curX = cX + rx * Math.cos(curAngle);
        curY = cY + ry * Math.sin(curAngle);
      } else {
        // Step from track into the perched position beside player
        const t = (progress - 0.90) / 0.10;
        const ease = 1 - Math.pow(1 - t, 3);
        curX = trackEndX + (destX - trackEndX) * ease;
        curY = trackEndY + (destY - trackEndY) * ease;
      }

      // Footstep dynamics
      const totalSteps = 24;
      const stepVal = progress * totalSteps;
      const stepIdx = Math.floor(stepVal);
      const stepPhase = stepVal % 1;
      const stepBob = Math.sin(stepPhase * Math.PI) * 7.5;
      const stepSway = Math.sin(stepIdx % 2 === 0 ? stepPhase * Math.PI : -stepPhase * Math.PI) * 4;

      // Facing orientation based on horizontal velocity
      const dx = curX - lastX;
      if (dx > 0.35) facing = 1;
      else if (dx < -0.35) facing = -1;
      lastX = curX;

      // Update character position & walking bounce/sway
      walker.style.left = `${curX}px`;
      walker.style.top = `${curY}px`;
      if (fig) {
        fig.style.transform = `scaleX(${facing}) rotate(${stepSway + (facing * 2)}deg) translateY(-${stepBob}px)`;
      }
      if (shadow) {
        shadow.style.transform = `scale(${1 - stepBob * 0.035})`;
      }

      // Sparkle footprint trails
      if (now - lastSparkleTime > 115) {
        lastSparkleTime = now;
        spawnSparkle(curX, curY);
      }

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        // 6. Arrival at seat: sit down beside tip provider!
        walker.classList.add('walker-sitting-down');

        if (window.sound && window.sound.playKiss) {
          window.sound.playKiss();
        }

        // Heart & Luck explosion
        const burst = document.createElement('div');
        burst.className = 'kiss-heart-burst';
        burst.innerHTML = `
          <div class="kiss-burst-item b1">💖</div>
          <div class="kiss-burst-item b2">💋</div>
          <div class="kiss-burst-item b3">👑</div>
          <div class="kiss-burst-item b4">🍀</div>
          <div class="kiss-burst-item b5">💕</div>
          <div class="kiss-bonus-tag" style="background:linear-gradient(135deg,#f59e0b,#ec4899);box-shadow:0 0 25px rgba(245,158,11,0.95);border:1px solid #ffd700;">
            👑 10K VIP QUEEN SAT BESIDE YOU! 💋🍀
          </div>
        `;
        burst.style.left = `${destX}px`;
        burst.style.top = `${destY}px`;
        felt.appendChild(burst);
        setTimeout(() => burst.remove(), 2600);

        if (targetSeatEl) {
          targetSeatEl.classList.add('seat-kiss-received');
          setTimeout(() => targetSeatEl.classList.remove('seat-kiss-received'), 2600);
        }

        this.showToast("💋 Carnival VIP Queen: Mwah! I've walked around the table and sat right beside you! Blessing your cards with 10K Gold Luck! 👑🍀", "success");

        // Settle into perched companion and clean up walker
        setTimeout(() => {
          walker.remove();
          this.isCarnivalQueenWalking = false;
          this.carnivalWalkingTargetSeat = null;

          document.querySelectorAll('.vip-companion-waiting-walk').forEach(el => {
            el.classList.remove('vip-companion-waiting-walk');
            el.style.opacity = '1';
            el.style.pointerEvents = 'auto';
            el.classList.add('companion-kissing');
            setTimeout(() => el.classList.remove('companion-kissing'), 1500);
          });
        }, 400);
      }
    };

    requestAnimationFrame(tick);
  }

  animateCarnivalVipCompanionVisit(seatIndex, startX, startY, endX, endY, rawTip) {
    const felt = document.getElementById('table-felt');
    if (!felt) return;

    if (window.sound && window.sound.playKiss) {
      window.sound.playKiss();
    }

    // Create 3D Carnival VIP Queen character gliding to the player's seat
    const companion = document.createElement('div');
    companion.className = 'carnival-vip-flying-companion';
    companion.innerHTML = `
      <div class="vip-companion-flight-wrap">
        <div class="vip-flight-aura"></div>
        <img src="/images/dealer_carnival_vip.png" class="vip-flight-img" alt="VIP Carnival Queen" />
        <div class="vip-flight-tag">💋 ${rawTip >= 10000 ? '10K VIP QUEEN' : '5K VIP COMPANION'}</div>
      </div>
    `;

    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const dur = 1300; // ms

    companion.style.left = `${startX}px`;
    companion.style.top = `${startY}px`;
    companion.style.setProperty('--vtx', `${deltaX}px`);
    companion.style.setProperty('--vty', `${deltaY}px`);
    companion.style.setProperty('--vdur', `${dur}ms`);

    felt.appendChild(companion);

    // Floating heart trails during flight
    const trailInterval = setInterval(() => {
      const currentRect = companion.getBoundingClientRect();
      const feltRect = felt.getBoundingClientRect();
      if (!currentRect || !feltRect) return;

      const heart = document.createElement('div');
      heart.className = 'kiss-trail-heart';
      heart.textContent = Math.random() > 0.5 ? '💋' : '💖';
      heart.style.left = `${(currentRect.left + currentRect.width / 2) - feltRect.left + (Math.random() - 0.5) * 16}px`;
      heart.style.top = `${(currentRect.top + currentRect.height / 2) - feltRect.top + (Math.random() - 0.5) * 16}px`;
      felt.appendChild(heart);
      setTimeout(() => heart.remove(), 800);
    }, 100);

    setTimeout(() => {
      clearInterval(trailInterval);
      companion.remove();

      const seatSelector = (seatIndex !== undefined && seatIndex !== -1)
        ? `.player-seat[data-seat-index="${seatIndex}"]`
        : '.player-seat.seat-self';
      const targetSeatEl = document.querySelector(seatSelector);

      if (targetSeatEl) {
        targetSeatEl.classList.add('seat-kiss-received');
        setTimeout(() => targetSeatEl.classList.remove('seat-kiss-received'), 2500);

        const burst = document.createElement('div');
        burst.className = 'kiss-heart-burst';
        burst.innerHTML = `
          <div class="kiss-burst-item b1">💖</div>
          <div class="kiss-burst-item b2">💋</div>
          <div class="kiss-burst-item b3">👑</div>
          <div class="kiss-burst-item b4">🍀</div>
          <div class="kiss-burst-item b5">💕</div>
          <div class="kiss-bonus-tag" style="background:linear-gradient(135deg,#f59e0b,#ec4899);box-shadow:0 0 25px rgba(245,158,11,0.9);">${rawTip >= 10000 ? '👑 10K VIP QUEEN SAT BESIDE YOU! 💋🍀' : '💋 5K VIP QUEEN VISITS YOUR CHAIR! 🍀'}</div>
        `;
        burst.style.left = `${endX}px`;
        burst.style.top = `${endY}px`;
        felt.appendChild(burst);
        setTimeout(() => burst.remove(), 2500);
      }

      this.showToast(rawTip >= 10000 
        ? "💋 VIP Queen: Mwah! I'm sitting right beside you to bring you all the luck! Let's win this pot! 👑🍀"
        : "💋 VIP Companion: Mwah! Sitting right beside you for good luck! You're my champion! 🍀✨", "success");
    }, dur);
  }

  startVipCompanionKissLoop() {
    if (this.vipKissInterval) return;
    this.vipKissInterval = setInterval(() => {
      if (!this.tableState || !this.tableState.vipCompanion) {
        this.stopVipCompanionKissLoop();
        return;
      }
      const seatIndex = this.tableState.vipCompanion.seatIndex;
      this.triggerVipCompanionKiss(seatIndex, true);
    }, 2800);
  }

  stopVipCompanionKissLoop() {
    if (this.vipKissInterval) {
      clearInterval(this.vipKissInterval);
      this.vipKissInterval = null;
    }
  }

  triggerVipCompanionKiss(seatIndex, isAuto = false) {
    // Only play sound on manual user click - NEVER play sound automatically every 5-10 seconds!
    if (!isAuto) {
      if (window.sound && window.sound.playKiss) window.sound.playKiss();
    }
    const felt = document.getElementById('table-felt');
    const seatEl = document.querySelector(`.player-seat[data-seat-index="${seatIndex}"]`);
    const companionEl = document.querySelector('.seat-vip-companion');
    if (companionEl) {
      companionEl.classList.remove('companion-kissing');
      void companionEl.offsetWidth;
      companionEl.classList.add('companion-kissing');
      setTimeout(() => companionEl.classList.remove('companion-kissing'), 1400);
    }

    if (felt && seatEl) {
      const feltRect = felt.getBoundingClientRect();
      const seatRect = seatEl.getBoundingClientRect();
      const x = (seatRect.left + seatRect.width / 2) - feltRect.left;
      const y = (seatRect.top + seatRect.height / 2) - feltRect.top;
      const burst = document.createElement('div');
      burst.className = 'kiss-heart-burst';
      const phrases = [
        "💋 Mwah! Good luck handsome! 🍀",
        "💋 *Kiss* Golden luck for you! 👑✨",
        "💋 You're my champion! Mwah! 💖",
        "💋 Win this pot for us, handsome! 🍀"
      ];
      const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
      burst.innerHTML = `
        <div class="kiss-burst-item b1">💖</div>
        <div class="kiss-burst-item b2">💋</div>
        <div class="kiss-burst-item b3">✨</div>
        <div class="kiss-bonus-tag" style="background:linear-gradient(135deg,#ec4899,#f59e0b);">${randomPhrase}</div>
      `;
      burst.style.left = `${x}px`;
      burst.style.top = `${y}px`;
      felt.appendChild(burst);
      setTimeout(() => burst.remove(), 2200);
    }
    if (!isAuto) {
      this.showToast("💋 Carnival VIP Queen: Mwah! Looking lucky, handsome! Win this pot! 🍀", "success");
    }
  }

  animateDealerKissToSeat(seatIndex, startX, startY, endX, endY, formattedGift) {
    const felt = document.getElementById('table-felt');
    if (!felt) return;

    // Play sweet "mwah" kiss sound effect
    if (window.sound && window.sound.playKiss) {
      window.sound.playKiss();
    }

    // Create flying kiss element (kissing lips with floating hearts)
    const kiss = document.createElement('div');
    kiss.className = 'tip-flying-kiss';
    kiss.innerHTML = `
      <div class="kiss-emoji-wrap">
        <span class="kiss-lips">💋</span>
        <span class="kiss-sparkle s1">✨</span>
        <span class="kiss-sparkle s2">💖</span>
        <span class="kiss-sparkle s3">💕</span>
      </div>
    `;

    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const dur = 1050; // ms

    kiss.style.left = `${startX}px`;
    kiss.style.top = `${startY}px`;
    kiss.style.setProperty('--ktx', `${deltaX}px`);
    kiss.style.setProperty('--kty', `${deltaY}px`);
    kiss.style.setProperty('--kdur', `${dur}ms`);

    felt.appendChild(kiss);

    // Floating heart trails during flight
    const trailInterval = setInterval(() => {
      const currentRect = kiss.getBoundingClientRect();
      const feltRect = felt.getBoundingClientRect();
      if (!currentRect || !feltRect) return;

      const heart = document.createElement('div');
      heart.className = 'kiss-trail-heart';
      heart.textContent = Math.random() > 0.5 ? '💖' : '✨';
      heart.style.left = `${(currentRect.left + currentRect.width / 2) - feltRect.left + (Math.random() - 0.5) * 14}px`;
      heart.style.top = `${(currentRect.top + currentRect.height / 2) - feltRect.top + (Math.random() - 0.5) * 14}px`;
      felt.appendChild(heart);
      setTimeout(() => heart.remove(), 700);
    }, 120);

    setTimeout(() => {
      clearInterval(trailInterval);
      kiss.remove();

      // Target seat receiving the kiss & bonus blessing!
      const seatSelector = (seatIndex !== undefined && seatIndex !== -1)
        ? `.player-seat[data-seat-index="${seatIndex}"]`
        : '.player-seat.seat-self';
      const targetSeatEl = document.querySelector(seatSelector);

      if (targetSeatEl) {
        targetSeatEl.classList.add('seat-kiss-received');
        setTimeout(() => targetSeatEl.classList.remove('seat-kiss-received'), 2000);

        // Heart & Sparkle burst over player seat
        const burst = document.createElement('div');
        burst.className = 'kiss-heart-burst';
        burst.innerHTML = `
          <div class="kiss-burst-item b1">💖</div>
          <div class="kiss-burst-item b2">💋</div>
          <div class="kiss-burst-item b3">✨</div>
          <div class="kiss-burst-item b4">🍀</div>
          <div class="kiss-burst-item b5">💕</div>
          <div class="kiss-bonus-tag">💋 VIP KISS & LUCKY BLESSING! 🍀</div>
        `;
        burst.style.left = `${endX}px`;
        burst.style.top = `${endY}px`;
        felt.appendChild(burst);
        setTimeout(() => burst.remove(), 2000);
      }
    }, dur);
  }

  // --- MASTER ADMIN PANEL ---

  switchMasterTab(tabName) {
    const userView = document.getElementById('master-view-users');
    const tablesView = document.getElementById('master-view-tables');
    const userBtn = document.getElementById('master-tab-users-btn');
    const tableBtn = document.getElementById('master-tab-tables-btn');

    if (tabName === 'tables') {
      if (userView) userView.style.display = 'none';
      if (tablesView) tablesView.style.display = 'block';
      if (userBtn) {
        userBtn.style.background = 'rgba(15,23,42,0.8)';
        userBtn.style.color = '#cbd5e1';
        userBtn.style.borderColor = '#475569';
      }
      if (tableBtn) {
        tableBtn.style.background = 'linear-gradient(135deg,#f59e0b,#b45309)';
        tableBtn.style.color = 'white';
        tableBtn.style.borderColor = '#fde047';
      }
      this.loadMasterTables();
    } else {
      if (userView) userView.style.display = 'block';
      if (tablesView) tablesView.style.display = 'none';
      if (userBtn) {
        userBtn.style.background = 'linear-gradient(135deg,#f59e0b,#b45309)';
        userBtn.style.color = 'white';
        userBtn.style.borderColor = '#fde047';
      }
      if (tableBtn) {
        tableBtn.style.background = 'rgba(15,23,42,0.8)';
        tableBtn.style.color = '#cbd5e1';
        tableBtn.style.borderColor = '#475569';
      }
    }
  }

  async loadMasterTables() {
    const tbody = document.getElementById('master-tables-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#94a3b8;">Loading all active tables...</td></tr>`;

    try {
      const masterIdentifier = this.user?.id || this.user?.username || 'admin';
      const res = await API.getAdminTables(masterIdentifier);
      if (res && res.success) {
        this.renderMasterTablesTable(res.tables || []);
      } else {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#ef4444;">${res?.error || 'Failed loading tables'}</td></tr>`;
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#ef4444;">${err.message}</td></tr>`;
    }
  }

  renderMasterTablesTable(tables) {
    const tbody = document.getElementById('master-tables-tbody');
    if (!tbody) return;

    if (!tables || tables.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#94a3b8;">No active tables right now.</td></tr>`;
      return;
    }

    tbody.innerHTML = tables.map(t => `
      <tr>
        <td><strong style="color:#ffd700;font-family:monospace;letter-spacing:1px;">${t.code || t.id}</strong></td>
        <td><strong>${t.name}</strong> ${t.isPrivate ? '<span style="color:#f87171;font-size:0.75rem;">(Private)</span>' : '<span style="color:#34d399;font-size:0.75rem;">(Public)</span>'}</td>
        <td style="text-transform:capitalize;">${t.variation || 'Classic'}</td>
        <td><span style="color:#60a5fa;font-weight:700;">${t.playerCount}/${t.maxPlayers || 10}</span></td>
        <td>Boot: ${this.formatChips(t.bootAmount)} | Pot: <strong style="color:#fef08a;">${this.formatChips(t.pot)}</strong></td>
        <td><span style="padding:2px 8px;border-radius:6px;font-size:0.72rem;background:${t.status === 'PLAYING' ? '#059669' : '#475569'};color:white;">${t.status}</span></td>
        <td>
          <button onclick="window.app.enterTableMasterMode('${t.id}')" style="background:linear-gradient(135deg,#6366f1,#4338ca);color:white;border:1px solid #818cf8;padding:4px 10px;border-radius:6px;font-size:0.75rem;font-weight:800;cursor:pointer;">
            👁️ Inspect / Join
          </button>
        </td>
      </tr>
    `).join('');
  }

  enterTableMasterMode(tableId) {
    document.getElementById('master-modal')?.classList.remove('active');
    this.enterTable(tableId);
    this.showToast('👑 Entered Room with Master God-Mode Card Vision!', 'success');
  }

  async openMasterPanel() {
    if (!this.isMasterUser()) {
      this.showToast('Only master/admin accounts have access to chip management & room monitoring', 'error');
      return;
    }

    try {
      const masterIdentifier = this.user.id || this.user.username || 'admin';
      const res = await API.getAdminUsers(masterIdentifier);
      if (!res.success) {
        this.showToast(res.error || 'Failed to load master panel', 'error');
        return;
      }

      this.masterUsersCache = res.users || [];
      const totalCountEl = document.getElementById('master-total-users-count');
      if (totalCountEl) totalCountEl.textContent = this.masterUsersCache.length;

      const searchInput = document.getElementById('master-user-search-input');
      const query = searchInput ? searchInput.value.trim() : '';
      this.renderMasterUsersTable(query);

      this.switchMasterTab('users');
      document.getElementById('master-modal')?.classList.add('active');
    } catch (err) {
      this.showToast(err.message || 'Failed to load master panel', 'error');
    }
  }

  async refreshMasterUsers() {
    const refreshBtn = document.getElementById('btn-master-refresh-list');
    if (refreshBtn) {
      refreshBtn.textContent = '⏳ Refreshing...';
      refreshBtn.disabled = true;
    }

    try {
      const masterIdentifier = this.user?.id || this.user?.username || 'admin';
      const res = await API.getAdminUsers(masterIdentifier);
      if (res && res.success) {
        this.masterUsersCache = res.users || [];
        const totalCountEl = document.getElementById('master-total-users-count');
        if (totalCountEl) totalCountEl.textContent = this.masterUsersCache.length;

        const searchInput = document.getElementById('master-user-search-input');
        const query = searchInput ? searchInput.value.trim() : '';
        this.renderMasterUsersTable(query);
        this.showToast('🔄 Player list refreshed with latest chips!', 'success');
      } else {
        this.showToast(res?.error || 'Failed to refresh list', 'error');
      }
    } catch (err) {
      this.showToast(err.message || 'Failed to refresh list', 'error');
    } finally {
      if (refreshBtn) {
        refreshBtn.textContent = '🔄 Refresh List';
        refreshBtn.disabled = false;
      }
    }
  }

  filterMasterUsers(query) {
    this.renderMasterUsersTable(query);
  }

  renderMasterUsersTable(query = '') {
    const tbody = document.getElementById('master-users-tbody');
    if (!tbody || !this.masterUsersCache) return;

    const filtered = query
      ? this.masterUsersCache.filter(u => u.username.toLowerCase().includes(query.toLowerCase()) || u.id.toLowerCase().includes(query.toLowerCase()))
      : this.masterUsersCache;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px;">No players found matching "${this.escapeHtml(query)}"</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(u => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <img src="${this.gameTable.getAvatarUrl(u.avatar)}" style="width:28px;height:28px;border-radius:50%;border:1px solid #ffd700;" alt="${u.username}">
            <div>
              <strong style="color:#fff;">${this.escapeHtml(u.username)}</strong>
              <div style="font-size:11px;color:#94a3b8;">${u.id}</div>
            </div>
          </div>
        </td>
        <td>
          <span class="master-tag" style="${u.role === 'master' ? 'background:linear-gradient(135deg,#f59e0b,#b45309);color:#fff;font-weight:800;' : 'background:#334155;color:#e2e8f0;'}">
            ${u.role === 'master' ? '👑 MASTER' : 'PLAYER'}
          </span>
        </td>
        <td style="color:#fde047;font-weight:800;font-size:1.05rem;">
          🪙 ${this.formatChips(u.chips)}
        </td>
        <td style="color:#cbd5e1;font-size:0.85rem;">
          ${u.handsWon} W / ${u.handsPlayed} P
        </td>
        <td>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <!-- Custom amount input row -->
            <div class="master-action-row">
              <input type="number" class="master-input-amount" id="chips-input-${u.id}" placeholder="Chips" value="100000" min="1">
              <button class="btn-master-add" onclick="window.app.executeMasterChipAction('${u.id}', 'add')">+ Add</button>
              <button class="btn-master-deduct" onclick="window.app.executeMasterChipAction('${u.id}', 'deduct')">- Deduct</button>
            </div>
            <!-- Quick preset buttons -->
            <div style="display:flex;gap:4px;">
              <button style="background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);color:#6ee7b7;font-size:0.68rem;padding:2px 6px;border-radius:4px;cursor:pointer;" onclick="window.app.executeMasterQuickChips('${u.id}', 100000)">+1 Lakh</button>
              <button style="background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);color:#6ee7b7;font-size:0.68rem;padding:2px 6px;border-radius:4px;cursor:pointer;" onclick="window.app.executeMasterQuickChips('${u.id}', 1000000)">+10 Lakh</button>
              <button style="background:rgba(245,158,11,0.2);border:1px solid rgba(245,158,11,0.4);color:#fde047;font-size:0.68rem;padding:2px 6px;border-radius:4px;cursor:pointer;" onclick="window.app.executeMasterQuickChips('${u.id}', 10000000)">+1 Crore</button>
            </div>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async executeMasterQuickChips(targetUserId, amount) {
    return this.executeMasterChipActionWithAmount(targetUserId, amount, 'add');
  }

  async executeMasterChipAction(targetUserId, action) {
    const input = document.getElementById(`chips-input-${targetUserId}`);
    const amount = input ? parseInt(input.value, 10) : 0;
    if (!amount || amount <= 0) {
      this.showToast('Enter a valid chip amount', 'warning');
      return;
    }
    return this.executeMasterChipActionWithAmount(targetUserId, amount, action);
  }

  async executeMasterChipActionWithAmount(targetUserId, amount, action) {
    try {
      const res = await API.masterManageChips(this.user.id, targetUserId, amount, action);
      if (res.success) {
        this.showToast(`Successfully ${action === 'add' ? 'added' : 'deducted'} ${this.formatChips(amount)}!`, 'success');
        
        // Update cached balance
        if (this.masterUsersCache) {
          const userObj = this.masterUsersCache.find(u => u.id === targetUserId);
          if (userObj) userObj.chips = res.newBalance;
          const searchInput = document.getElementById('master-user-search-input');
          this.renderMasterUsersTable(searchInput ? searchInput.value.trim() : '');
        }

        // If master modified their own chips, refresh UI
        if (targetUserId === this.user.id) {
          this.user.chips = res.newBalance;
          this.updateUserUI();
        }
      }
    } catch (err) {
      this.showToast(err.message || 'Chip management failed', 'error');
    }
  }

  async masterBulkResetZero() {
    if (!this.isMasterUser()) return;
    if (!confirm('⚠️ Are you sure you want to RESET CHIPS TO 0 for ALL players?')) return;

    try {
      const res = await API.masterBulkResetZero(this.user.id);
      if (res.success) {
        this.showToast(res.message, 'warning');
        this.refreshMasterUsers();
      }
    } catch (err) {
      this.showToast(err.message || 'Bulk reset failed', 'error');
    }
  }

  async masterBulkAddChips(amount = 2000000) {
    if (!this.isMasterUser()) return;

    try {
      const res = await API.masterBulkAddChips(this.user.id, amount);
      if (res.success) {
        this.showToast(res.message, 'success');
        this.refreshMasterUsers();
      }
    } catch (err) {
      this.showToast(err.message || 'Bulk chip add failed', 'error');
    }
  }

  // --- GAME TABLE RENDERING ---

  renderTable() {
    if (!this.tableState) return;

    // Render 10 seats, pot, chip stacks
    this.gameTable.render(this.tableState, this.user?.id);

    // Update table header details
    const tableNameEl = document.getElementById('header-table-name');
    const bootEl = document.getElementById('header-boot-amount');
    const potLimitEl = document.getElementById('header-pot-limit');
    const roomCodeEl = document.getElementById('header-room-code');

    if (tableNameEl) tableNameEl.textContent = this.tableState.tableName;
    if (bootEl) bootEl.textContent = this.formatChips(this.tableState.bootAmount);
    if (potLimitEl) potLimitEl.textContent = this.formatChips(this.tableState.potLimit);
    if (roomCodeEl) roomCodeEl.textContent = this.tableState.roomCode || this.tableState.tableId;

    const hostBadge = document.getElementById('header-host-badge');
    if (hostBadge) {
      const isOwner = this.tableState.isOwner || (this.user && this.tableState.ownerId === this.user.id);
      hostBadge.style.display = isOwner ? 'inline-block' : 'none';
    }

    // Sync my local user chips if seated (Strict privacy: user only receives their own chips)
    const mySeat = this.tableState.seats.find(s => s && s.id === this.user?.id);
    if (mySeat && this.user && mySeat.chips !== null && mySeat.chips !== undefined) {
      this.user.chips = mySeat.chips;
      this.updateUserUI();
    }

    // Update Room Friends badge count and table subtitle
    const maxP = this.tableState.maxPlayers || (this.tableState.seats ? this.tableState.seats.length : 10);
    const tableSubEl = document.getElementById('table-subtitle');
    if (tableSubEl) {
      tableSubEl.textContent = `${maxP}-Player Table`;
    }

    const friendsCountEl = document.getElementById('header-friends-count');
    if (friendsCountEl) {
      const seatedCount = this.tableState.seats.filter(Boolean).length;
      friendsCountEl.textContent = `${seatedCount}/${maxP}`;
    }

    // If Room Friends modal is currently open, refresh its list
    const friendsModal = document.getElementById('room-friends-modal');
    if (friendsModal && friendsModal.classList.contains('active')) {
      this.populateRoomFriendsList();
    }

    // Update Intermission / Countdown Overlay with 5-Second Loader
    const overlay = document.getElementById('celebration-overlay');
    const hasWinnerShowdown = this.tableState.lastShowdown &&
                              this.tableState.lastShowdown.winners &&
                              this.tableState.lastShowdown.winners.length > 0;

    if (this.tableState.status === 'COUNTDOWN' && hasWinnerShowdown) {
      const sec = this.tableState.countdownSeconds || 0;
      const maxSec = this.tableState.countdownMax || 5;
      const textEl = document.getElementById('intermission-countdown-text');
      const boldEl = document.getElementById('intermission-timer-bold');
      const fillCircle = document.getElementById('intermission-fill-circle');

      if (textEl) textEl.textContent = `${sec}s`;
      if (boldEl) boldEl.textContent = `${sec}s`;
      if (fillCircle) {
        // Circumference for r=18: 2 * Math.PI * 18 = 113.1
        const offset = 113.1 * (1 - (sec / maxSec));
        fillCircle.style.strokeDashoffset = offset;
      }
      // Make sure overlay is visible during post-round winner countdown
      if (overlay) overlay.classList.add('active');
    } else {
      // Clear overlay for PLAYING, WAITING, or initial table countdown before first game
      if (overlay) overlay.classList.remove('active');
    }

    // Authentic Teen Patti rules: Players start BLIND. Cards are NOT automatically seen.
    // Player decides when to tap cards or click 'See Cards' to reveal!

    // Render Action Controls
    this.renderActionDock();

    // Check Sideshow Prompt
    this.checkSideshowPrompt();
  }

  renderActionDock() {
    const state = this.tableState;
    if (!state || !this.user) return;

    const mySeat = state.seats.find(s => s && s.id === this.user.id);
    const isSeated = !!mySeat;
    const isPlaying = state.status === 'PLAYING';
    const isMyTurn = isPlaying && isSeated && state.currentTurnSeat === mySeat.seatIndex;
    const isActive = isSeated && mySeat.status === 'ACTIVE';

    const statusMsgEl = document.getElementById('action-status-msg');
    const btnPack = document.getElementById('btn-action-pack');
    const btnSee = document.getElementById('btn-action-see');
    const btnSideshow = document.getElementById('btn-action-sideshow');
    const btnChaal = document.getElementById('btn-action-chaal');
    const btnShow = document.getElementById('btn-action-show');
    const stepperGroup = document.getElementById('stepper-group');
    const autoBlindContainer = document.getElementById('auto-blind-container');
    const autoBlindCheckbox = document.getElementById('checkbox-auto-blind');

    if (this.isMasterUser()) {
      const leadingWinner = this.tableState?.seats?.find(s => s && s.isLeadingWinner);
      let leaderText = '';
      if (leadingWinner) {
        const handName = leadingWinner.godModeHandEval ? leadingWinner.godModeHandEval.typeName : 'Highest Hand';
        leaderText = ` • 🟢 <strong style="color:#34d399;">Table Leader: ${this.escapeHtml(leadingWinner.name)} (${this.escapeHtml(handName)})</strong>`;
      }
      statusMsgEl.innerHTML = `<span style="color:#ffd700;font-weight:800;">👑 MASTER & ADMIN GOD-MODE SPECTATOR — Viewing All Live Open Cards${leaderText}</span>`;
      btnPack.disabled = true;
      btnSee.disabled = true;
      btnSideshow.disabled = true;
      btnChaal.disabled = true;
      btnShow.disabled = true;
      if (stepperGroup) stepperGroup.style.display = 'none';
      if (autoBlindContainer) autoBlindContainer.style.display = 'none';
      return;
    }

    if (!isSeated) {
      const maxP = this.tableState?.maxPlayers || 10;
      statusMsgEl.innerHTML = `<span>Click an empty seat to sit down! (Up to ${maxP} players)</span>`;
      btnPack.disabled = true;
      btnSee.disabled = true;
      btnSideshow.disabled = true;
      btnChaal.disabled = true;
      btnShow.disabled = true;
      if (stepperGroup) stepperGroup.style.display = 'none';
      if (autoBlindContainer) autoBlindContainer.style.opacity = '0.4';
      return;
    }

    if (state.status === 'COUNTDOWN') {
      statusMsgEl.innerHTML = `<span class="turn-pulse-dot" style="background:#f59e0b;box-shadow:0 0 10px #f59e0b;"></span><span>Dealing next hand in <strong>${state.countdownSeconds}s</strong>...</span>`;
      btnPack.disabled = true;
      btnSee.disabled = true;
      btnSideshow.disabled = true;
      btnChaal.disabled = true;
      btnShow.disabled = true;
      if (stepperGroup) stepperGroup.style.display = 'none';
      return;
    }

    if (state.status === 'WAITING') {
      statusMsgEl.innerHTML = `<span>Waiting for at least 2 players to start hand...</span>`;
      btnPack.disabled = true;
      btnSee.disabled = true;
      btnSideshow.disabled = true;
      btnChaal.disabled = true;
      btnShow.disabled = true;
      if (stepperGroup) stepperGroup.style.display = 'none';
      return;
    }

    if (!isActive) {
      statusMsgEl.innerHTML = `<span>You folded this round. Waiting for next hand...</span>`;
      btnPack.disabled = true;
      btnSee.disabled = true;
      btnSideshow.disabled = true;
      btnChaal.disabled = true;
      btnShow.disabled = true;
      if (stepperGroup) stepperGroup.style.display = 'none';
      return;
    }

    // Active player controls
    if (stepperGroup) stepperGroup.style.display = 'flex';

    // Auto Blind — strictly disabled and unclickable once cards are seen
    if (autoBlindContainer && autoBlindCheckbox) {
      if (mySeat.isSeen) {
        this.autoBlind = false;
        autoBlindCheckbox.checked = false;
        autoBlindCheckbox.disabled = true;
        autoBlindContainer.style.opacity = '0.35';
        autoBlindContainer.style.pointerEvents = 'none';
        autoBlindContainer.style.cursor = 'not-allowed';
      } else {
        autoBlindCheckbox.checked = this.autoBlind;
        autoBlindCheckbox.disabled = false;
        autoBlindContainer.style.opacity = '1';
        autoBlindContainer.style.pointerEvents = 'auto';
        autoBlindContainer.style.cursor = 'pointer';
      }
    }

    // See Cards Button — styled differently when already seen
    if (!mySeat.isSeen) {
      btnSee.disabled = false;
      btnSee.classList.remove('btn-already-seen');
      btnSee.innerHTML = `<span>SEE CARDS</span><span class="action-sub-text">Blind ${mySeat.blindCount}/4</span>`;
    } else {
      btnSee.disabled = true;
      btnSee.classList.add('btn-already-seen');
      btnSee.innerHTML = `<span>👁 SEEN</span><span class="action-sub-text">Playing Open</span>`;
    }

    // Multiplier constraints
    const minMult = mySeat.isSeen ? 2 : 1;
    const maxMult = mySeat.isSeen ? 4 : 2;
    if (this.stakeMultiplier < minMult || this.stakeMultiplier > maxMult) {
      this.stakeMultiplier = minMult;
    }

    const stepperVal = document.getElementById('stepper-val-display');
    if (stepperVal) stepperVal.textContent = `${this.stakeMultiplier}x`;

    const maxChaal = state.maxChaal || 100000;
    const betAmount = Math.min(state.currentStake * this.stakeMultiplier, maxChaal);
    const actionLabel = !mySeat.isSeen ? 'BLIND' : 'CHAAL';
    btnChaal.innerHTML = `<span>${actionLabel}</span><span class="action-sub-text">${this.formatChips(betAmount)}</span>`;

    // 2-player show — Always visible, enabled on 2-player turn
    const activePlayers = state.seats.filter(s => s && s.status === 'ACTIVE');
    const canShow = activePlayers.length === 2;
    btnShow.style.display = 'flex';
    if (canShow) {
      btnShow.innerHTML = `<span>SHOW</span><span class="action-sub-text">${this.formatChips(betAmount)}</span>`;
      btnShow.title = isMyTurn ? 'Call Showdown and compare cards!' : '2-Player Showdown available on your turn';
      btnShow.classList.add('btn-show-ready');
      btnShow.disabled = !isMyTurn;
    } else {
      btnShow.innerHTML = `<span>SHOW</span><span class="action-sub-text">2 Players</span>`;
      btnShow.title = 'Show is available when only 2 active players remain';
      btnShow.classList.remove('btn-show-ready');
      btnShow.disabled = true;
    }

    // Sideshow eligibility (available on your turn whenever 2+ active players are present)
    const sideshowCost = state.currentStake * 2;
    const hasSideshowChips = (mySeat.chips || 0) >= sideshowCost;
    const canSideshow = isMyTurn && activePlayers.length >= 2 && hasSideshowChips && this.checkSideshowEligible(mySeat.seatIndex);
    btnSideshow.disabled = !canSideshow;
    btnSideshow.style.display = 'flex';
    if (canSideshow) {
      btnSideshow.classList.add('btn-sideshow-ready');
      btnSideshow.innerHTML = `<span>SIDESHOW</span><span class="action-sub-text">${this.formatChips(sideshowCost)}</span>`;
      btnSideshow.title = 'Request secret card comparison with previous player';
    } else {
      btnSideshow.classList.remove('btn-sideshow-ready');
      btnSideshow.innerHTML = `<span>SIDESHOW</span><span class="action-sub-text">${this.formatChips(sideshowCost)}</span>`;
      btnSideshow.title = !isMyTurn 
        ? 'Sideshow available on your turn' 
        : (activePlayers.length < 2 
            ? 'Requires at least 2 active players' 
            : (!hasSideshowChips ? 'Insufficient chips for Sideshow' : 'No previous active player found'));
    }

    // --- AUTO ACTIONS ON MY TURN ---
    if (isMyTurn) {
      btnPack.disabled = false;
      btnChaal.disabled = false;

      // Auto Blind: fires once, then turns itself OFF (user consciously re-enables each hand)
      if (!mySeat.isSeen && this.autoBlind) {
        statusMsgEl.innerHTML = `<span class="turn-pulse-dot" style="background:#10b981;box-shadow:0 0 10px #10b981;"></span><span style="color:#34d399;font-weight:700">⚡ AUTO BLIND: Betting...</span>`;
        if (!this.autoBlindTimer) {
          this.autoBlindTimer = setTimeout(() => {
            this.autoBlindTimer = null;
            if (this.tableState?.status === 'PLAYING' && this.tableState?.currentTurnSeat === mySeat.seatIndex && !this.tableState?.seats.find(s => s && s.id === this.user.id)?.isSeen) {
              this.handleChaal();
              // Reset auto blind OFF after firing — user must re-enable
              this.autoBlind = false;
              localStorage.setItem('teen_patti_autoblind', 'false');
              const cb = document.getElementById('checkbox-auto-blind');
              if (cb) cb.checked = false;
            }
          }, 220);
        }
        return;
      }

      statusMsgEl.innerHTML = `<span class="turn-pulse-dot"></span><span style="color:#ffd700;font-weight:700">YOUR TURN! (${state.turnTimeLeft}s)</span>`;
    } else {
      if (this.autoBlindTimer) { clearTimeout(this.autoBlindTimer); this.autoBlindTimer = null; }
      const turnPlayer = state.seats[state.currentTurnSeat];
      const turnName = turnPlayer ? turnPlayer.name : 'player';
      statusMsgEl.innerHTML = `<span>Waiting for <strong>${turnName}</strong>'s turn (${state.turnTimeLeft}s)...</span>`;
      btnPack.disabled = true;
      btnChaal.disabled = true;
      if (!canShow) btnShow.disabled = true;
    }
  }

  checkSideshowEligible(seatIndex) {
    if (!this.tableState || !this.tableState.seats) return false;
    const maxPlayers = this.tableState.maxPlayers || 10;
    for (let offset = 1; offset < maxPlayers; offset++) {
      const prev = (seatIndex - offset + maxPlayers) % maxPlayers;
      const s = this.tableState.seats[prev];
      if (s && s.status === 'ACTIVE') {
        return true;
      }
    }
    return false;
  }

  checkSideshowPrompt() {
    const promptModal = document.getElementById('sideshow-modal');
    const req = this.tableState?.sideshowRequest;
    if (!promptModal) return;

    const mySeat = this.tableState?.seats.find(s => s && s.id === this.user?.id);
    if (req && mySeat && req.toSeat === mySeat.seatIndex) {
      const reqNameEl = document.getElementById('sideshow-requester-name');
      const reqAmtEl = document.getElementById('sideshow-amount');
      if (reqNameEl) reqNameEl.textContent = req.fromName;
      if (reqAmtEl) reqAmtEl.textContent = this.formatChips(req.amount);
      
      promptModal.style.display = 'block';
      promptModal.classList.add('active');

      if (!this._sideshowTimerInterval) {
        let remaining = 10;
        const timerText = document.getElementById('sideshow-auto-decline-timer');
        const timerBar = document.getElementById('sideshow-timer-bar-fill');
        if (timerText) timerText.textContent = `${remaining}s`;
        if (timerBar) timerBar.style.width = '100%';

        this._sideshowTimerInterval = setInterval(() => {
          remaining -= 1;
          if (timerText) timerText.textContent = `${Math.max(0, remaining)}s`;
          if (timerBar) timerBar.style.width = `${Math.max(0, remaining * 10)}%`;
          if (remaining <= 0) {
            clearInterval(this._sideshowTimerInterval);
            this._sideshowTimerInterval = null;
          }
        }, 1000);
      }
    } else {
      if (this._sideshowTimerInterval) {
        clearInterval(this._sideshowTimerInterval);
        this._sideshowTimerInterval = null;
      }
      promptModal.classList.remove('active');
      promptModal.style.display = 'none';
    }
  }

  handleTableEvent(event, data) {
    const mySeat = this.tableState?.seats.find(s => s && s.id === this.user?.id);
    const mySeatIndex = mySeat ? mySeat.seatIndex : -1;

    switch (event) {
      case 'BOOT_COLLECTED':
        window.sound.playDeal();
        this.gameTable.setDealerSpeech(`Ante collected! Round started with ${this.formatChips(data.pot)} pot. Good luck!`);
        break;

      case 'PLAYER_BET':
        window.sound.playChip();
        this.gameTable.animateBetChips(data.seatIndex, mySeatIndex);
        break;

      case 'CARDS_SEEN':
        if (data.seatIndex === mySeatIndex) {
          window.sound.playDeal();
        }
        break;

      case 'PLAYER_PACKED':
        window.sound.playFold();
        break;

      case 'DEALER_TIPPED':
        const formattedTip = this.formatChips(data.tipAmount);
        const formattedGift = this.formatChips(data.bonusGift);
        const isVip = (data.tipAmount || 0) >= 1000;
        this.animateTipCoinsFromSeat(data.seatIndex, formattedGift, data.userName, data.tipAmount);
        if (isVip) {
          this.showToast(`💋 Scarlett blew a VIP Kiss to ${data.userName} & blessed them with Lucky Cards! 🍀✨`, 'success');
        } else {
          this.showToast(`🪙 ${data.userName} tipped Scarlett ${formattedTip}!`, 'info');
        }
        break;

      case 'SIDESHOW_REQUESTED':
        // Animate table-wide laser duel beam from requester to target for all spectators
        this.gameTable.animateSideshowDuel(data.fromSeat, data.toSeat, mySeatIndex);
        this.showToast(`⚔️ Sideshow Challenge: ${data.fromName} vs ${data.toName}!`, 'info');
        break;

      case 'SIDESHOW_RESOLVED':
        this.gameTable.animateSideshowDuel(data.winnerSeat, data.loserSeat, mySeatIndex);
        
        // If local user is one of the 2 sideshow players, reveal both hands in private comparison modal
        if (mySeatIndex === data.fromSeat || mySeatIndex === data.toSeat) {
          this.showSideshowComparison(data, mySeatIndex);
        } else {
          // Spectators only see the public result announcement, not the private cards
          this.showToast(`⚔️ Sideshow: ${data.winnerName} defeated ${data.loserName}!`, 'info');
        }
        break;

      case 'ROUND_ENDED':
        window.sound.playWin();
        this.showCelebration(data);
        const winner = data.winners[0];
        if (winner) {
          this.gameTable.setDealerSpeech(`🎉 Congratulations ${winner.name} for winning ${this.formatChips(winner.amount)}!`);
        }
        break;
    }
  }

  getHandBadgeClass(handName) {
    if (!handName) return 'hand-badge-high';
    const lower = handName.toLowerCase();
    if (lower.includes('trail') || lower.includes('trio') || lower.includes('three of a kind')) return 'hand-badge-trail';
    if (lower.includes('pure')) return 'hand-badge-pure';
    if (lower.includes('sequence') || lower.includes('straight')) return 'hand-badge-sequence';
    if (lower.includes('color') || lower.includes('flush')) return 'hand-badge-color';
    if (lower.includes('pair')) return 'hand-badge-pair';
    return 'hand-badge-high';
  }

  showCelebration(showdown) {
    const overlay = document.getElementById('celebration-overlay');
    if (!overlay) return;

    const winner = showdown.winners[0];
    if (!winner) return;

    document.getElementById('celebration-winner-name').textContent = winner.name;
    document.getElementById('celebration-amount').textContent = `Won ${this.formatChips(winner.amount)}`;
    
    const handTitleEl = document.getElementById('celebration-hand-title');
    if (handTitleEl) {
      const badgeClass = this.getHandBadgeClass(winner.handName);
      const icon = winner.handName?.toLowerCase().includes('trail') ? '🔥' :
                   winner.handName?.toLowerCase().includes('pure') ? '💎' :
                   winner.handName?.toLowerCase().includes('sequence') ? '⚡' :
                   winner.handName?.toLowerCase().includes('color') ? '🎨' :
                   winner.handName?.toLowerCase().includes('pair') ? '👥' : '🃏';
      
      const label = winner.handName ? `${winner.handName} • ${winner.handDescription}` : 'Won by Fold (Last player remaining)';
      handTitleEl.innerHTML = `<span class="hand-badge ${badgeClass}">${icon} ${label}</span>`;
    }

    const cardsRow = document.getElementById('celebration-cards-row');
    cardsRow.innerHTML = '';
    if (winner.cards && winner.cards.length === 3) {
      winner.cards.forEach(c => {
        if (!c) return;
        const isRed = c.suit === '♥' || c.suit === '♦';
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card-item is-flipped is-winner';
        cardDiv.innerHTML = `
          <div class="card-inner">
            <div class="card-front ${isRed ? 'red-suit' : 'black-suit'}">
              <div class="card-corner top"><span class="card-rank">${c.rank}</span><span class="card-suit-mini">${c.suit}</span></div>
              <div class="card-center-suit">${c.suit}</div>
              <div class="card-corner bottom"><span class="card-rank">${c.rank}</span><span class="card-suit-mini">${c.suit}</span></div>
            </div>
          </div>
        `;
        cardsRow.appendChild(cardDiv);
      });
    }

    // Show the celebration overlay — it stays visible during the 5s COUNTDOWN intermission.
    // renderTable() will dismiss it when the new hand PLAYING state arrives.
    const fillCircle = document.getElementById('intermission-fill-circle');
    const textEl = document.getElementById('intermission-countdown-text');
    const boldEl = document.getElementById('intermission-timer-bold');
    if (fillCircle) fillCircle.style.strokeDashoffset = '0';
    if (textEl) textEl.textContent = '5s';
    if (boldEl) boldEl.textContent = '5s';

    overlay.classList.add('active');
  }

  showSideshowComparison(data, mySeatIndex) {
    const modal = document.getElementById('sideshow-result-modal');
    if (!modal) return;

    // Helper to render 3 mini cards
    const renderCardsHtml = (cards) => {
      if (!cards || cards.length === 0) return '';
      return cards.map(c => {
        if (!c) return '';
        const isRed = c.suit === '♥' || c.suit === '♦';
        return `
          <div class="card-item is-flipped" style="width:44px;height:62px;">
            <div class="card-inner">
              <div class="card-front ${isRed ? 'red-suit' : 'black-suit'}" style="padding:2px 4px;">
                <div class="card-corner top" style="font-size:11px;font-weight:900;"><span class="card-rank">${c.rank}</span><span class="card-suit-mini">${c.suit}</span></div>
                <div class="card-center-suit" style="font-size:16px;">${c.suit}</div>
                <div class="card-corner bottom" style="font-size:11px;font-weight:900;"><span class="card-rank">${c.rank}</span><span class="card-suit-mini">${c.suit}</span></div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    };

    // Populate Challenger (from)
    const fromNameEl = document.getElementById('sideshow-from-name');
    const fromEvalEl = document.getElementById('sideshow-from-eval');
    const fromCardsEl = document.getElementById('sideshow-from-cards');
    const fromOutcomeEl = document.getElementById('sideshow-from-outcome');
    const fromIsWinner = data.winnerSeat === data.fromSeat;

    if (fromNameEl) fromNameEl.textContent = data.fromName + (data.fromSeat === mySeatIndex ? ' (YOU)' : '');
    if (fromEvalEl) fromEvalEl.textContent = data.fromEval ? `${data.fromEval.typeName}` : 'Evaluated';
    if (fromCardsEl) fromCardsEl.innerHTML = renderCardsHtml(data.fromCards);
    if (fromOutcomeEl) {
      fromOutcomeEl.innerHTML = fromIsWinner 
        ? '<span style="color:#86efac;font-weight:900;font-size:0.9rem;">🏆 SIDESHOW WINNER</span>' 
        : '<span style="color:#f87171;font-weight:900;font-size:0.9rem;">❌ FOLDED</span>';
    }

    // Populate Target (to)
    const toNameEl = document.getElementById('sideshow-to-name');
    const toEvalEl = document.getElementById('sideshow-to-eval');
    const toCardsEl = document.getElementById('sideshow-to-cards');
    const toOutcomeEl = document.getElementById('sideshow-to-outcome');
    const toIsWinner = data.winnerSeat === data.toSeat;

    if (toNameEl) toNameEl.textContent = data.toName + (data.toSeat === mySeatIndex ? ' (YOU)' : '');
    if (toEvalEl) toEvalEl.textContent = data.toEval ? `${data.toEval.typeName}` : 'Evaluated';
    if (toCardsEl) toCardsEl.innerHTML = renderCardsHtml(data.toCards);
    if (toOutcomeEl) {
      toOutcomeEl.innerHTML = toIsWinner 
        ? '<span style="color:#86efac;font-weight:900;font-size:0.9rem;">🏆 SIDESHOW WINNER</span>' 
        : '<span style="color:#f87171;font-weight:900;font-size:0.9rem;">❌ FOLDED</span>';
    }

    // Sound effect based on user outcome
    const userWon = data.winnerSeat === mySeatIndex;
    if (userWon) {
      window.sound.playWin();
      this.showToast(`🏆 You won the sideshow duel against ${data.loserName}!`, 'success');
    } else {
      window.sound.playFold();
      this.showToast(`❌ You lost the sideshow duel to ${data.winnerName}. Hand folded.`, 'warning');
    }

    modal.classList.add('active');

    // Auto close after 4.5 seconds
    setTimeout(() => {
      modal.classList.remove('active');
    }, 4500);
  }

  // --- ACTIONS DISPATCH ---

  handleTakeSeat(seatIndex) {
    if (!this.user) {
      this.showAuthModal();
      return;
    }
    if (this.isMasterUser()) {
      this.showToast('👑 Master & Admin users are in dedicated Spectator mode to supervise games and watch open cards without sitting.', 'info');
      return;
    }
    this.socket.emit('TAKE_SEAT', { seatIndex });
  }

  handleSeeCards() {
    this.autoBlind = false;
    localStorage.setItem('teen_patti_autoblind', 'false');
    const cb = document.getElementById('checkbox-auto-blind');
    const container = document.getElementById('auto-blind-container');
    if (cb) {
      cb.checked = false;
      cb.disabled = true;
    }
    if (container) {
      container.style.opacity = '0.35';
      container.style.pointerEvents = 'none';
      container.style.cursor = 'not-allowed';
    }
    this.socket.emit('ACTION_SEE');
  }

  handleChaal() {
    this.socket.emit('ACTION_CHAAL', { multiplier: this.stakeMultiplier });
  }

  handlePack() {
    this.socket.emit('ACTION_PACK');
  }

  handleSideshow() {
    this.socket.emit('ACTION_SIDESHOW');
  }

  handleSideshowResponse(accept) {
    if (this._sideshowTimerInterval) {
      clearInterval(this._sideshowTimerInterval);
      this._sideshowTimerInterval = null;
    }
    this.socket.emit('RESPOND_SIDESHOW', { accept });
    const promptModal = document.getElementById('sideshow-modal');
    if (promptModal) {
      promptModal.classList.remove('active');
      promptModal.style.display = 'none';
    }
  }

  handleShow() {
    this.socket.emit('ACTION_SHOW', { multiplier: this.stakeMultiplier });
  }

  // --- BOT ACTIONS ---

  addBot() {
    this.socket.emit('BOT_ADD_ONE');
    this.showToast('Adding 1 bot to table...', 'info');
  }

  fillTableWithBots() {
    this.socket.emit('BOT_FILL_10');
    this.showToast('Filling remaining seats with bots for full table play!', 'success');
  }

  removeBots() {
    this.socket.emit('BOT_REMOVE_ALL');
    this.showToast('Removed all bots from table.', 'info');
  }

  // --- AUTH & MODALS ---

  switchAuthMode(isRegister) {
    this.isRegisterMode = isRegister;
    const tabLogin = document.getElementById('tab-auth-login');
    const tabReg = document.getElementById('tab-auth-register');
    const titleEl = document.getElementById('auth-modal-title');
    const descEl = document.getElementById('auth-modal-desc');
    const submitBtn = document.getElementById('auth-submit-btn');
    const avatarGroup = document.getElementById('avatar-picker-group');
    const errorBanner = document.getElementById('auth-error-banner');
    const toggleBtn = document.getElementById('auth-toggle-mode');

    if (errorBanner) {
      errorBanner.style.display = 'none';
      errorBanner.innerHTML = '';
    }

    if (tabLogin) tabLogin.classList.toggle('active', !isRegister);
    if (tabReg) tabReg.classList.toggle('active', isRegister);

    if (titleEl) titleEl.textContent = isRegister ? 'Join Teen Patti Royale' : 'Login to Account';
    if (descEl) {
      descEl.innerHTML = isRegister
        ? 'Register with a unique username. Starting bankroll: <strong>10 Lakh (₹10,00,000) chips</strong>!'
        : 'Enter your credentials to access your tables and live card games.';
    }
    if (submitBtn) {
      submitBtn.textContent = isRegister ? 'Login Instead' : '🔑 Login & Play';
      submitBtn.style.opacity = isRegister ? '0.75' : '1';
    }
    const regBtn = document.getElementById('auth-register-btn');
    if (regBtn) {
      regBtn.textContent = isRegister ? '✨ Register & Claim ₹10 Lakh' : '✨ Register (+₹10 Lakh)';
      regBtn.style.opacity = isRegister ? '1' : '0.85';
    }
    if (avatarGroup) avatarGroup.style.display = isRegister ? 'block' : 'none';
    if (toggleBtn) {
      toggleBtn.textContent = isRegister ? 'Already have an account? Login' : 'Need an account? Register';
    }
  }

  toggleAuthMode() {
    this.switchAuthMode(!this.isRegisterMode);
  }

  fillQuickAuth(username, password, isRegister = false) {
    this.switchAuthMode(isRegister);
    const uEl = document.getElementById('auth-username');
    const pEl = document.getElementById('auth-password');
    const remEl = document.getElementById('auth-remember-me');
    if (uEl) uEl.value = username;
    if (pEl) pEl.value = password;
    if (remEl) remEl.checked = true;
    this.showToast(`Autofilled ${username}! Click "${isRegister ? 'Register' : 'Login'}" to enter.`, 'info');
  }

  showAuthModal() {
    document.getElementById('auth-modal')?.classList.add('active');
  }

  hideAuthModal() {
    document.getElementById('auth-modal')?.classList.remove('active');
  }

  showRulesModal() {
    document.getElementById('rules-modal')?.classList.add('active');
  }

  hideRulesModal() {
    document.getElementById('rules-modal')?.classList.remove('active');
  }

  openRoomFriendsModal() {
    this.populateRoomFriendsList();
    document.getElementById('room-friends-modal')?.classList.add('active');
  }

  closeRoomFriendsModal() {
    document.getElementById('room-friends-modal')?.classList.remove('active');
  }

  populateRoomFriendsList() {
    const codeDisplay = document.getElementById('modal-room-code-display');
    if (codeDisplay && this.tableState) {
      codeDisplay.textContent = this.tableState.roomCode || this.tableState.tableId;
    }

    const container = document.getElementById('room-friends-list-container');
    if (!container || !this.tableState) return;

    const seated = this.tableState.seats.filter(Boolean);
    if (seated.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:24px 12px;color:#94a3b8;font-size:0.85rem;">
          No players currently seated in this room.
          <div style="margin-top:6px;color:#64748b;">Share your Room ID with up to 9 friends!</div>
        </div>
      `;
      return;
    }

    container.innerHTML = seated.map(s => {
      const isMe = s.id === this.user?.id;
      const avatarUrl = this.gameTable.getAvatarUrl(s.avatar);
      const safeName = this.gameTable.escapeHtml(s.name);
      return `
        <div class="room-friend-row ${isMe ? 'friend-row-me' : ''}">
          <div class="friend-info-left">
            <img src="${avatarUrl}" class="player-avatar-img" style="width:36px;height:36px;" alt="${safeName}">
            <div>
              <div class="friend-name-text">
                ${s.isBot ? '🤖 ' : ''}${safeName}
                ${isMe ? '<span class="tag-you">YOU</span>' : ''}
              </div>
              <div class="friend-seat-text">Seat ${s.seatIndex + 1} • ${s.status}</div>
            </div>
          </div>

          <div class="friend-coins-right">
            ${isMe ? `
              <div class="friend-my-coins" title="Your Personal Coin Balance">
                <span class="coin-glint">🪙</span>
                <strong>${this.formatChips(this.user.chips)}</strong>
              </div>
            ` : `
              <div class="friend-private-coins" title="Other player balances are strictly private">
                <span class="private-badge">🔒 Protected</span>
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  handleLogout() {
    if (this.socket) {
      try {
        this.socket.emit('LEAVE_TABLE');
      } catch (e) {}
    }
    localStorage.removeItem('teen_patti_user');
    sessionStorage.removeItem('pending_join_room');
    this.pendingRoomTarget = null;

    // Disable auto-login so logout stays logged out, but preserve saved credentials
    const savedCredsRaw = localStorage.getItem('saved_auth_creds');
    if (savedCredsRaw) {
      try {
        const creds = JSON.parse(savedCredsRaw);
        creds.autoLogin = false;
        localStorage.setItem('saved_auth_creds', JSON.stringify(creds));
      } catch (e) {}
    }
    this.user = null;
    this.tableState = null;
    this.stopVipCompanionKissLoop();

    // Clean URL so ?room= isn't re-triggered on next visit
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, '/');
    }

    // Direct redirect to Login screen / modal
    this.showHomeView();
    this.updateUserUI();
    this.switchAuthMode(false); // Login tab
    this.showAuthModal();
    this.showToast('You have been logged out. Please log in to continue.', 'info');
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  formatChips(amount) {
    if (amount === undefined || amount === null) return '₹0';
    if (amount >= 10000000) {
      return `₹${(amount / 10000000).toFixed(2)} Cr`;
    }
    if (amount >= 100000) {
      return `₹${(amount / 100000).toFixed(2)} Lakh`;
    }
    if (amount >= 1000) {
      return `₹${(amount / 1000).toFixed(1)} K`;
    }
    return `₹${amount.toLocaleString('en-IN')}`;
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async submitAuth(forceAction = null) {
    const isRegister = forceAction !== null ? (forceAction === 'register') : this.isRegisterMode;
    const uEl = document.getElementById('auth-username');
    const pEl = document.getElementById('auth-password');
    const username = uEl ? uEl.value.trim() : '';
    const password = pEl ? pEl.value : '';
    const rememberMe = document.getElementById('auth-remember-me')?.checked ?? true;
    const errorBanner = document.getElementById('auth-error-banner');
    
    if (errorBanner) {
      errorBanner.style.display = 'none';
      errorBanner.innerHTML = '';
    }

    // Validate client side
    if (!username || username.length < 2) {
      const msg = 'Username must be at least 2 characters.';
      if (errorBanner) {
        errorBanner.innerHTML = `⚠️ <strong>Validation Error:</strong> ${msg}`;
        errorBanner.style.display = 'block';
      }
      if (uEl) {
        uEl.classList.add('input-error-shake');
        setTimeout(() => uEl.classList.remove('input-error-shake'), 600);
        uEl.focus();
      }
      this.showToast(msg, 'warning');
      return;
    }

    if (!password || password.length < 4) {
      const msg = 'Password must be at least 4 characters.';
      if (errorBanner) {
        errorBanner.innerHTML = `⚠️ <strong>Validation Error:</strong> ${msg}`;
        errorBanner.style.display = 'block';
      }
      if (pEl) {
        pEl.classList.add('input-error-shake');
        setTimeout(() => pEl.classList.remove('input-error-shake'), 600);
        pEl.focus();
      }
      this.showToast(msg, 'warning');
      return;
    }

    try {
      let res;
      if (isRegister) {
        try {
          res = await API.register(username, password, this.selectedAuthAvatar || 'human-1');
        } catch (regErr) {
          // If already registered, seamlessly switch to Login mode with password intact
          if (regErr.message && regErr.message.toLowerCase().includes('already registered')) {
            this.switchAuthMode(false);
            if (errorBanner) {
              errorBanner.innerHTML = `ℹ️ <strong>Account Exists:</strong> "${username}" is already registered. Switched to Login mode. Click Login to enter.`;
              errorBanner.style.display = 'block';
            }
            this.showToast(`Account "${username}" already exists. Switched to Login mode.`, 'info');
            return;
          }
          throw regErr;
        }
        if (res.success) {
          if (rememberMe) {
            localStorage.setItem('saved_auth_creds', JSON.stringify({ username, password, autoLogin: true }));
          } else {
            localStorage.removeItem('saved_auth_creds');
          }
          this.user = res.user;
          this.onUserLoggedIn();
          this.showToast('🎉 Welcome! 10 Lakh (₹10,00,000) bonus chips credited to your wallet!', 'success');
          if (window.sound && window.sound.playWin) window.sound.playWin();
        }
      } else {
        res = await API.login(username, password);
        if (res.success) {
          if (rememberMe) {
            localStorage.setItem('saved_auth_creds', JSON.stringify({ username, password, autoLogin: true }));
          } else {
            localStorage.removeItem('saved_auth_creds');
          }
          this.user = res.user;
          this.onUserLoggedIn();
          this.showToast(`✅ Welcome back, ${res.user.username}! Chips: ${this.formatChips(res.user.chips)}`, 'success');
        }
      }
    } catch (err) {
      const errMsg = err.message || 'Authentication failed. Please check your username and password.';
      if (errorBanner) {
        errorBanner.innerHTML = `❌ <strong>Error:</strong> ${this.escapeHtml(errMsg)}`;
        errorBanner.style.display = 'block';
      }
      if (uEl) {
        uEl.classList.add('input-error-shake');
        setTimeout(() => uEl.classList.remove('input-error-shake'), 600);
      }
      if (pEl) {
        pEl.classList.add('input-error-shake');
        setTimeout(() => pEl.classList.remove('input-error-shake'), 600);
      }
      this.showToast(errMsg, 'error');
    }
  }

  bindEvents() {
    // Auth Form Submit
    const authForm = document.getElementById('auth-form');

    if (authForm) {
      authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitAuth();
      });
    }

    // Action Buttons
    document.getElementById('btn-action-see')?.addEventListener('click', () => this.handleSeeCards());
    document.getElementById('btn-action-chaal')?.addEventListener('click', () => this.handleChaal());
    document.getElementById('btn-action-pack')?.addEventListener('click', () => this.handlePack());
    document.getElementById('btn-action-sideshow')?.addEventListener('click', () => this.handleSideshow());
    document.getElementById('btn-action-show')?.addEventListener('click', () => this.handleShow());
    document.getElementById('btn-sideshow-accept')?.addEventListener('click', () => this.handleSideshowResponse(true));
    document.getElementById('btn-sideshow-decline')?.addEventListener('click', () => this.handleSideshowResponse(false));

    // Auto Blind Checkbox (resets each hand)
    const autoBlindCheckbox = document.getElementById('checkbox-auto-blind');
    if (autoBlindCheckbox) {
      autoBlindCheckbox.checked = false;
      autoBlindCheckbox.addEventListener('change', (e) => {
        this.autoBlind = e.target.checked;
        if (this.autoBlind) {
          this.showToast('⚡ Auto-Blind ON — will bet blind this turn then turn off', 'success');
        } else {
          this.showToast('Auto-Blind OFF', 'info');
        }
      });
    }

    // Stepper Controls [-] [+] [2x]
    document.getElementById('btn-stepper-minus')?.addEventListener('click', () => {
      const mySeat = this.tableState?.seats.find(s => s && s.id === this.user?.id);
      const min = mySeat?.isSeen ? 2 : 1;
      if (this.stakeMultiplier > min) {
        this.stakeMultiplier = min;
        this.renderActionDock();
      }
    });

    document.getElementById('btn-stepper-plus')?.addEventListener('click', () => {
      const mySeat = this.tableState?.seats.find(s => s && s.id === this.user?.id);
      const max = mySeat?.isSeen ? 4 : 2;
      if (this.stakeMultiplier < max) {
        this.stakeMultiplier = max;
        this.renderActionDock();
      }
    });

    document.getElementById('btn-stepper-double')?.addEventListener('click', () => {
      const mySeat = this.tableState?.seats.find(s => s && s.id === this.user?.id);
      const max = mySeat?.isSeen ? 4 : 2;
      this.stakeMultiplier = max;
      this.renderActionDock();
    });

    // Room Code Badge Copy
    document.getElementById('header-room-badge')?.addEventListener('click', () => {
      this.copyCurrentRoomCode();
    });

    // Create Room Form
    document.getElementById('create-room-form')?.addEventListener('submit', (e) => {
      this.handleCreateRoomSubmit(e);
    });

    // Master Admin Panel Buttons
    document.getElementById('btn-master-panel-toggle')?.addEventListener('click', () => {
      this.openMasterPanel();
    });
    document.getElementById('btn-table-master-panel')?.addEventListener('click', () => {
      this.openMasterPanel();
    });

    // Sound toggle
    document.getElementById('btn-sound-toggle')?.addEventListener('click', () => {
      const enabled = window.sound.toggle();
      const btn = document.getElementById('btn-sound-toggle');
      if (btn) btn.textContent = enabled ? '🔊' : '🔇';
    });

    // Fullscreen event listener
    const onFsChange = () => this.updateFullscreenUI();
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('mozfullscreenchange', onFsChange);
    document.addEventListener('MSFullscreenChange', onFsChange);

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'f' || e.key === 'F') this.handlePack();
      if (e.key === 'c' || e.key === 'C') this.handleChaal();
      if (e.key === 's' || e.key === 'S') this.handleSeeCards();
    });
  }

  toggleFullscreen() {
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
    if (!isFull) {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      } else if (docEl.mozRequestFullScreen) {
        docEl.mozRequestFullScreen();
      } else if (docEl.msRequestFullscreen) {
        docEl.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }

  updateFullscreenUI() {
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
    const icons = document.querySelectorAll('.fs-icon');
    icons.forEach(el => {
      el.textContent = isFull ? '🗗' : '⛶';
    });
    if (isFull) {
      document.body.classList.add('is-fullscreen');
    } else {
      document.body.classList.remove('is-fullscreen');
    }
  }
}

window.TeenPattiApp = TeenPattiApp;

function initTeenPattiApp() {
  window.app = new TeenPattiApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTeenPattiApp);
} else {
  initTeenPattiApp();
}
