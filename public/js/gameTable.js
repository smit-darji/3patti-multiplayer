/**
 * Teen Patti 10-Player Table Renderer
 */
class GameTable {
  constructor(containerEl) {
    this.container = containerEl;
    this.state = null;
    this.localUserId = null;
    this.timerInterval = null;
    this.dealerPuck = null;
    this.initLayout();
  }

  initLayout() {
    this.container.innerHTML = `
      <div class="poker-table-outer">
        <div class="poker-table-armrest">
          <div class="poker-table-felt" id="table-felt">
            <div class="table-ring-marking"></div>

            <!-- Live 3D Animated Human Dealer Character Standing at the Table (Large, realistic, no background/border) -->
            <div class="live-dealer-podium" id="live-dealer-podium">
              <div class="dealer-figure-stage">
                <div class="dealer-live-aura"></div>
                <img src="${this.getDealerAvatar()}" class="dealer-live-figure" id="dealer-live-figure" alt="Live Dealer Scarlett" />
                <div class="dealer-live-nameplate">
                  <span class="dealer-crown-icon">👑</span>
                  <span class="dealer-title-text">SCARLETT</span>
                </div>
              </div>

              <!-- Compact Single-Row Tip Stepper: [-] ₹50 [+] 💋 Tip -->
              <div class="dealer-tip-box" id="dealer-tip-box">
                <button class="btn-tip-step" onclick="window.app.adjustTip(-1)" title="Decrease Tip">-</button>
                <span class="tip-display-val" id="dealer-tip-val">₹50</span>
                <button class="btn-tip-step" onclick="window.app.adjustTip(1)" title="Increase Tip">+</button>
                <button class="btn-send-tip" id="btn-send-tip-action" onclick="window.app.sendCustomTip()" title="Send Tip to Scarlett">
                  💋 Tip
                </button>
              </div>
              <div class="dealer-quick-row" id="dealer-quick-row">
                <button class="btn-quick-chip" data-amount="500" onclick="window.app.quickTip(500)" title="Quick Tip ₹500">₹500</button>
                <button class="btn-quick-chip" data-amount="1000" onclick="window.app.quickTip(1000)" title="Quick Tip ₹1,000">₹1K</button>
                <button class="btn-quick-chip" data-amount="5000" onclick="window.app.quickTip(5000)" title="Quick Tip ₹5,000">₹5K</button>
                <button class="btn-quick-chip vip-chip" data-amount="10000" onclick="window.app.quickTip(10000)" title="👑 10K VIP: Carnival Queen Sits Beside You!">👑 10K VIP</button>
              </div>
            </div>
            
            <!-- Center Table Pot (Clean, spacious, zero visual clutter) -->
            <div class="table-center-hub">
              <div class="pot-chips-cluster" id="pot-chips-cluster"></div>
              <div class="pot-clean-badge">
                <span class="pot-glint-icon">🪙</span>
                <span class="pot-clean-title">POT</span>
                <span class="pot-amount" id="table-pot-amount">₹0</span>
              </div>
            </div>

            <!-- Dealer Puck -->
            <div class="dealer-puck" id="dealer-puck">D</div>

            <!-- 10 Radial Seats -->
            <div id="seats-container"></div>
          </div>
        </div>
      </div>
    `;

    this.seatsContainer = this.container.querySelector('#seats-container');
    this.dealerPuck = this.container.querySelector('#dealer-puck');
    this.potAmountEl = this.container.querySelector('#table-pot-amount');
    this.stakeBadgeEl = this.container.querySelector('#table-stake-badge');
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

  // Symmetrical dynamic radial positioning around table ellipse (supports 5, 10, 15, 20 players)
  getSeatCoordinates(seatIndex, userSeatIndex = -1, totalSeats = 10) {
    const total = Math.max(2, totalSeats || 10);
    // If user is seated, rotate seats so user is always at bottom (index 0 relative)
    const offset = userSeatIndex !== -1 ? (seatIndex - userSeatIndex + total) % total : seatIndex;
    
    // Angle: 0 starts at bottom (90 deg in cartesian) and moves clockwise
    const angleStep = 360 / total;
    const angleDeg = 90 + (offset * angleStep);
    const rad = (angleDeg * Math.PI) / 180;

    // Table ellipse radii (optimized for spacious non-overlapping layout)
    let rx = 40; // % horizontal radius
    let ry = 34; // % vertical radius

    if (total > 10) {
      rx = 42;
      ry = 36;
    } else if (total <= 6) {
      rx = 38;
      ry = 32;
    }

    let left = 50 + rx * Math.cos(rad);
    let top = 50 + ry * Math.sin(rad);

    // Fine-tune top center seat and bottom self seat
    if (offset === 0) {
      top = Math.min(85, 50 + ry);
    } else if (total % 2 === 0 && offset === total / 2) {
      top = Math.max(7.5, 50 - ry);
    }

    return { left, top, isSelf: offset === 0 && userSeatIndex !== -1 };
  }

  render(state, localUserId) {
    this.state = state;
    this.localUserId = localUserId;

    if (!state) return;

    const totalSeats = (state && state.maxPlayers) || (state && state.seats ? state.seats.length : 10);

    // Update Pot
    if (this.potAmountEl) this.potAmountEl.textContent = this.formatChips(state.pot);
    if (this.stakeBadgeEl) this.stakeBadgeEl.textContent = `Current Stake: ${this.formatChips(state.currentStake)}`;

    const potClusterEl = this.container.querySelector('#pot-chips-cluster');
    if (potClusterEl) {
      potClusterEl.innerHTML = state.pot > 0 ? this.getPotClusterHtml(state.pot) : '';
    }

    // Find local user's seat index
    const mySeat = state.seats.find(s => s && s.id === localUserId);
    const mySeatIndex = mySeat ? mySeat.seatIndex : -1;

    // Render Seats dynamically
    this.seatsContainer.className = totalSeats > 10 ? 'seats-compact' : '';
    this.seatsContainer.innerHTML = '';

    for (let i = 0; i < totalSeats; i++) {
      const seatData = state.seats[i];
      const coords = this.getSeatCoordinates(i, mySeatIndex, totalSeats);

      const seatEl = document.createElement('div');
      seatEl.className = `player-seat ${coords.isSelf ? 'seat-self' : ''}`;
      seatEl.style.left = `${coords.left}%`;
      seatEl.style.top = `${coords.top}%`;
      seatEl.dataset.seatIndex = i;

      if (!seatData) {
        // Empty seat
        seatEl.innerHTML = `
          <div class="seat-empty" onclick="window.app.handleTakeSeat(${i})">
            <span class="seat-empty-plus">+</span>
            <span class="seat-empty-label">Seat ${i + 1}</span>
          </div>
        `;
      } else {
        // Occupied Seat
        const isTurn = state.status === 'PLAYING' && state.currentTurnSeat === i;
        const isWinner = (state.status === 'SHOWDOWN' || state.status === 'COUNTDOWN' || state.status === 'WAITING') &&
                         state.lastShowdown && state.lastShowdown.winners &&
                         state.lastShowdown.winners.some(w => w.seatIndex === i);
        const isPacked = seatData.status === 'PACKED';
        const avatarUrl = this.getAvatarUrl(seatData.avatar);
        const safeName = this.escapeHtml(seatData.name);

        seatEl.innerHTML = `
          <div class="player-pod ${isTurn ? 'is-turn' : ''} ${isWinner ? 'is-winner-seat' : ''} ${isPacked ? 'is-packed' : ''}">
            ${isWinner ? '<div class="winner-seat-crown">👑</div>' : ''}

            <!-- Current round 3D bet chips -->
            ${seatData.currentBet > 0 ? `
              <div class="player-bet-badge">
                ${this.getChipStackHtml(seatData.currentBet)}
                <span class="player-bet-val">${this.formatChips(seatData.currentBet)}</span>
              </div>
            ` : ''}

            <!-- Avatar & Timer Ring -->
            <div class="player-avatar-wrapper">
              <svg class="timer-ring-svg" viewBox="0 0 66 66">
                <circle class="timer-circle" id="timer-circle-${i}" cx="33" cy="33" r="30" />
              </svg>
              <img src="${avatarUrl}" class="player-avatar-img" alt="${safeName}" />
              
              <!-- Status Tag -->
              <span class="player-status-badge ${isWinner ? 'status-active' : 'status-' + seatData.status.toLowerCase()}" ${isWinner ? 'style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-weight:900;border:1px solid #ffd700;"' : ''}>
                ${isWinner ? '👑 WINNER' : (seatData.status === 'ACTIVE' ? (seatData.isSeen ? 'SEEN' : 'BLIND') : seatData.status)}
              </span>
            </div>

            <!-- Name & Chips Tag (High contrast, clean typography) -->
            <div class="player-info-card ${coords.isSelf ? 'my-info-card' : ''}">
              <div class="player-name" title="${safeName}">
                ${seatData.isBot ? '🤖 ' : ''}${safeName}
                ${coords.isSelf ? '<span class="tag-you">YOU</span>' : ''}
              </div>
              <div class="player-chips ${coords.isSelf ? 'is-self' : ''}" title="${coords.isSelf ? 'Your Chips' : safeName + '\'s Chips'}">
                <span class="coin-glint">🪙</span>
                <span>${this.formatChips(seatData.chips)}</span>
              </div>
            </div>

            <!-- Cards Container (Click to Reveal for Self) -->
            <div class="player-cards-container" ${coords.isSelf && seatData.hasCards && !seatData.isSeen ? 'onclick="window.app.handleSeeCards()" style="cursor:pointer;" title="Tap Cards to Reveal"' : ''}>
              ${this.renderCards(seatData, coords.isSelf)}
              ${coords.isSelf && seatData.hasCards && !seatData.isSeen ? '<div class="tap-reveal-hint">👁️ Tap to Reveal</div>' : ''}
            </div>

            <!-- 👑 3D Carnival VIP Companion (Perched beside tipping player) -->
            ${(state.vipCompanion && state.vipCompanion.seatIndex === i) ? `
              <div class="seat-vip-companion ${(window.app?.isCarnivalQueenWalking && window.app?.carnivalWalkingTargetSeat === i) ? 'vip-companion-waiting-walk' : ''}" onclick="window.app.triggerVipCompanionKiss(${i})" title="Carnival VIP Companion - Brings you lucky cards!">
                <div class="vip-companion-aura"></div>
                <img src="/images/dealer_carnival_vip.png" class="vip-companion-figure" alt="VIP Companion" />
                <div class="vip-companion-tag">💋 VIP LUCK</div>
              </div>
            ` : ''}
          </div>
        `;
      }

      this.seatsContainer.appendChild(seatEl);
    }

    // Position Dealer Puck near dealer seat
    this.updateDealerPuck(state.dealerSeat, mySeatIndex, totalSeats);

    // Update Turn Timer Animation
    this.updateTurnTimer(state);
  }

  renderCards(seatData, isSelf) {
    if (!seatData.hasCards || seatData.status === 'PACKED') {
      return '';
    }

    const cards = seatData.cards || [];
    let html = '';

    for (let c = 0; c < 3; c++) {
      const card = cards[c];
      const isFlipped = !!card; // If card data is known, flip face up!

      if (isFlipped && card) {
        const isRed = card.suit === '♥' || card.suit === '♦';
        html += `
          <div class="card-item is-flipped">
            <div class="card-inner">
              <div class="card-back">
                <div class="card-back-emblem">♠</div>
              </div>
              <div class="card-front ${isRed ? 'red-suit' : 'black-suit'}">
                <div class="card-corner top">
                  <span class="card-rank">${card.rank}</span>
                  <span class="card-suit-mini">${card.suit}</span>
                </div>
                <div class="card-center-suit">${card.suit}</div>
                <div class="card-corner bottom">
                  <span class="card-rank">${card.rank}</span>
                  <span class="card-suit-mini">${card.suit}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        // Face down card
        html += `
          <div class="card-item">
            <div class="card-inner">
              <div class="card-back">
                <div class="card-back-emblem">♠</div>
              </div>
              <div class="card-front"></div>
            </div>
          </div>
        `;
      }
    }

    return html;
  }

  updateDealerPuck(dealerSeatIndex, userSeatIndex, totalSeats = 10) {
    if (dealerSeatIndex === -1 || !this.dealerPuck) {
      this.dealerPuck.style.display = 'none';
      return;
    }

    this.dealerPuck.style.display = 'flex';
    const coords = this.getSeatCoordinates(dealerSeatIndex, userSeatIndex, totalSeats);
    
    // Position puck slightly offset so it never covers cards, avatar, or the VIP girl
    if (coords.isSelf) {
      this.dealerPuck.style.left = `${coords.left - 8.5}%`;
      this.dealerPuck.style.top = `${coords.top - 10}%`;
    } else {
      const deltaX = (50 - coords.left) * 0.22;
      const deltaY = (50 - coords.top) * 0.22;
      this.dealerPuck.style.left = `${coords.left + deltaX - 2}%`;
      this.dealerPuck.style.top = `${coords.top + deltaY - 2}%`;
    }
  }

  updateTurnTimer(state) {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (state.status !== 'PLAYING' || state.currentTurnSeat === -1) {
      return;
    }

    const circle = document.querySelector(`#timer-circle-${state.currentTurnSeat}`);
    if (!circle) return;

    const totalDuration = state.turnDuration || 15;
    let remainingSeconds = state.turnTimeLeft || totalDuration;
    const perimeter = 188; // 2 * pi * 30

    const step = () => {
      const fraction = Math.max(0, remainingSeconds / totalDuration);
      circle.style.strokeDashoffset = perimeter * (1 - fraction);
      remainingSeconds -= 0.1;
      if (remainingSeconds < 0) {
        clearInterval(this.timerInterval);
      }
    };

    step();
    this.timerInterval = setInterval(step, 100);
  }

  getChipStackHtml(amount) {
    let chipClass = 'chip-red';
    let label = '1K';
    if (amount >= 500000) { chipClass = 'chip-purple'; label = '5L'; }
    else if (amount >= 100000) { chipClass = 'chip-gold'; label = '1L'; }
    else if (amount >= 25000) { chipClass = 'chip-black'; label = '25K'; }
    else if (amount >= 5000) { chipClass = 'chip-green'; label = '5K'; }

    const count = Math.min(3, Math.max(1, Math.floor(amount / (amount >= 100000 ? 50000 : 2000))));
    let chips = '';
    for (let i = 0; i < count; i++) {
      chips += `<div class="poker-chip-3d ${chipClass}" style="width:22px;height:22px;margin-top:${i > 0 ? '-14px' : '0'};"><div class="chip-inlay" style="width:11px;height:11px;font-size:6px;">${label}</div></div>`;
    }
    return `<div class="casino-chip-stack">${chips}</div>`;
  }

  getPotClusterHtml(amount) {
    return `
      <div class="casino-chip-stack">
        <div class="poker-chip-3d chip-green"><div class="chip-inlay">5K</div></div>
        <div class="poker-chip-3d chip-green"><div class="chip-inlay">5K</div></div>
      </div>
      <div class="casino-chip-stack">
        <div class="poker-chip-3d chip-gold"><div class="chip-inlay">1L</div></div>
        <div class="poker-chip-3d chip-gold"><div class="chip-inlay">1L</div></div>
        <div class="poker-chip-3d chip-purple"><div class="chip-inlay">5L</div></div>
      </div>
      <div class="casino-chip-stack">
        <div class="poker-chip-3d chip-red"><div class="chip-inlay">1K</div></div>
        <div class="poker-chip-3d chip-black"><div class="chip-inlay">25K</div></div>
      </div>
    `;
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

  getAvatarUrl(avatarId) {
    if (window.HumanAvatars) {
      return window.HumanAvatars.getSvg(avatarId);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#1e293b" stroke="#ffd700" stroke-width="3"/><circle cx="50" cy="38" r="16" fill="#f5d0b0"/><path d="M24 88 C24 64, 76 64, 76 88 Z" fill="#0f172a"/></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  getDealerAvatar() {
    return '/images/dealer_scarlett_transparent.png';
  }

  getDealerKissAvatar() {
    return '/images/dealer_kiss_figure.png';
  }

  setDealerSpeech(text) {
    // Intrusive speech bubble removed per user request.
  }

  // Animate laser duel beam + clashing swords for Sideshow between two seats
  animateSideshowDuel(fromSeat, toSeat, userSeatIndex) {
    const felt = document.getElementById('table-felt');
    if (!felt) return;

    // Get exact seat DOM elements
    const fromSeatEl = document.querySelector(`.player-seat[data-seat-index="${fromSeat}"]`);
    const toSeatEl = document.querySelector(`.player-seat[data-seat-index="${toSeat}"]`);
    if (!fromSeatEl || !toSeatEl) return;

    const feltRect = felt.getBoundingClientRect();
    const fromRect = fromSeatEl.getBoundingClientRect();
    const toRect = toSeatEl.getBoundingClientRect();

    // Exact pixel coordinates relative to table felt
    const x1 = (fromRect.left + fromRect.width / 2) - feltRect.left;
    const y1 = (fromRect.top + fromRect.height / 2) - feltRect.top;
    const x2 = (toRect.left + toRect.width / 2) - feltRect.left;
    const y2 = (toRect.top + toRect.height / 2) - feltRect.top;

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    // Highlight both duel seats with glowing pulse
    fromSeatEl.classList.add('is-sideshow-duel');
    toSeatEl.classList.add('is-sideshow-duel');

    // Create SVG overlay for the duel laser
    const svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgOverlay.setAttribute('class', 'sideshow-duel-svg');
    svgOverlay.setAttribute('viewBox', `0 0 ${feltRect.width} ${feltRect.height}`);
    svgOverlay.style.position = 'absolute';
    svgOverlay.style.inset = '0';
    svgOverlay.style.width = '100%';
    svgOverlay.style.height = '100%';
    svgOverlay.style.pointerEvents = 'none';
    svgOverlay.style.zIndex = '85';

    svgOverlay.innerHTML = `
      <defs>
        <linearGradient id="sideshowGrad" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ec4899" />
          <stop offset="50%" stop-color="#a855f7" />
          <stop offset="100%" stop-color="#3b82f6" />
        </linearGradient>
        <filter id="sideshowGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- Outer wide glow line -->
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
            stroke="rgba(168, 85, 247, 0.45)" stroke-width="14" stroke-linecap="round" filter="url(#sideshowGlow)" />

      <!-- Main vibrant laser beam with dash animation -->
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
            stroke="url(#sideshowGrad)" stroke-width="5" stroke-linecap="round"
            stroke-dasharray="10 6" class="sideshow-laser-dash" />

      <!-- Core white-hot laser core -->
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
            stroke="#ffffff" stroke-width="2" stroke-linecap="round" />

      <!-- Endpoint Energy Nodes -->
      <circle cx="${x1}" cy="${y1}" r="12" fill="#ec4899" opacity="0.8" filter="url(#sideshowGlow)" />
      <circle cx="${x1}" cy="${y1}" r="6" fill="#ffffff" />
      <circle cx="${x2}" cy="${y2}" r="12" fill="#3b82f6" opacity="0.8" filter="url(#sideshowGlow)" />
      <circle cx="${x2}" cy="${y2}" r="6" fill="#ffffff" />
    `;

    felt.appendChild(svgOverlay);

    // Clashing swords badge at midpoint
    const swords = document.createElement('div');
    swords.className = 'sideshow-clash-badge';
    swords.innerHTML = `
      <div class="sideshow-badge-icon">⚔️</div>
      <div class="sideshow-badge-text">SIDESHOW DUEL</div>
    `;
    swords.style.left = `${midX}px`;
    swords.style.top = `${midY}px`;
    felt.appendChild(swords);

    // Sound effect
    if (window.sound && window.sound.playBet) window.sound.playBet();

    // Cleanup after 2.8s
    setTimeout(() => {
      svgOverlay.style.transition = 'opacity 0.5s ease';
      svgOverlay.style.opacity = '0';
      swords.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      swords.style.opacity = '0';
      swords.style.transform = 'translate(-50%, -50%) scale(0.8)';
      
      fromSeatEl.classList.remove('is-sideshow-duel');
      toSeatEl.classList.remove('is-sideshow-duel');

      setTimeout(() => {
        svgOverlay.remove();
        swords.remove();
      }, 500);
    }, 2500);
  }
}

window.GameTable = GameTable;
