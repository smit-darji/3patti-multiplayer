const Deck = require('./Deck');
const { Evaluator } = require('./Evaluator');
const BotPlayer = require('./BotPlayer');

const TABLE_PRESETS = {
  novice: { name: 'Novice Table', bootAmount: 1000, maxChaal: 100000, potLimit: 1024000 },
  casual: { name: 'Casual Table', bootAmount: 5000, maxChaal: 100000, potLimit: 5120000 },
  pro: { name: 'Pro Table', bootAmount: 10000, maxChaal: 100000, potLimit: 10240000 },
  highroller: { name: 'High Roller Table', bootAmount: 50000, maxChaal: 100000, potLimit: 51200000 },
  vip: { name: 'VIP Suite Table', bootAmount: 100000, maxChaal: 100000, potLimit: 102400000 }
};

class TeenPattiGame {
  constructor(options = {}) {
    this.id = options.id || 'table_' + Math.random().toString(36).substring(2, 9);
    this.presetKey = options.presetKey || 'novice';
    const preset = TABLE_PRESETS[this.presetKey] || TABLE_PRESETS.novice;

    this.name = options.name || preset.name;
    this.bootAmount = options.bootAmount || preset.bootAmount;
    this.maxChaal = options.maxChaal || preset.maxChaal || 100000;
    this.potLimit = options.potLimit || preset.potLimit;
    // Configurable table size: 5, 10, 15, or 20 players
    const rawSize = parseInt(options.maxPlayers, 10) || 10;
    this.maxPlayers = [5, 10, 15, 20].includes(rawSize) ? rawSize : 10;
    this.isPrivate = !!options.isPrivate;
    this.variation = (options.variation || 'classic').toLowerCase();
    this.code = options.code || (options.id && options.id.startsWith('pub_') ? options.id.replace('pub_', '').toUpperCase() : Math.floor(100000 + Math.random() * 900000).toString());

    // Seats array sized to maxPlayers
    this.seats = new Array(this.maxPlayers).fill(null);

    // Game state
    this.status = 'WAITING'; // 'WAITING', 'COUNTDOWN', 'PLAYING', 'SIDESHOW_PENDING', 'SHOWDOWN'
    this.pot = 0;
    this.currentStake = this.bootAmount;
    this.dealerSeat = -1;
    this.currentTurnSeat = -1;
    this.lastActionSeat = -1;
    this.handNumber = 0;
    this.history = []; // Hand action history

    // Timers & callbacks
    this.turnDuration = 15; // 15 seconds
    this.turnTimer = null;
    this.turnStartTime = 0;
    this.countdownTimer = null;
    this.showdownTimer = null;
    this.sideshowTimer = null;

    // Sideshow state
    this.sideshowRequest = null; // { fromSeat, toSeat, amount }

    // Last showdown result
    this.lastShowdown = null;

    // VIP Companion state (set on 5K/10K tip)
    this.vipCompanion = null; // { seatIndex, userId, userName, tier, tipAmount }

    // Exclusive 10K VIP Tip per game (only 1 player can send 10K tip per game round)
    this.round10kTipUserId = null;
    this.round10kTipUserName = null;
    this.round10kHandCompleted = false;

    // Room Owner / Host info
    this.ownerId = options.ownerId || null;
    this.ownerName = options.ownerName || null;

    // Event broadcaster hook
    this.onStateChange = options.onStateChange || (() => {});
    this.onEvent = options.onEvent || (() => {});
    this.onBalanceUpdate = options.onBalanceUpdate || (() => {});
  }

  closeTable() {
    this.status = 'CLOSED';
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    if (this.showdownTimer) clearTimeout(this.showdownTimer);
    if (this.sideshowTimer) clearTimeout(this.sideshowTimer);
    this.turnTimer = null;
    this.countdownTimer = null;
    this.showdownTimer = null;
    this.sideshowTimer = null;

    // Refund active players who contributed to this unfinished hand's pot
    if (this.pot > 0) {
      const activeContributors = this.seats.filter(s => s && s.currentBet > 0);
      if (activeContributors.length > 0) {
        activeContributors.forEach(p => {
          if (p.currentBet > 0) {
            p.chips += p.currentBet;
            if (this.onBalanceUpdate) {
              this.onBalanceUpdate(p.id, p.currentBet);
            }
          }
        });
      }
      this.pot = 0;
    }
  }

  canSend10kTip(userId) {
    if (!this.round10kTipUserId) return true;
    return this.round10kTipUserId === userId;
  }

  record10kTip(userId, userName) {
    this.round10kTipUserId = userId;
    this.round10kTipUserName = userName;
    this.round10kHandCompleted = false;
  }

  // --- SEAT MANAGEMENT ---

  joinSeat(player, preferredSeat = -1) {
    if (player && (player.role === 'master' || player.role === 'admin')) {
      return { success: false, error: '👑 Master & Admin accounts are in dedicated Spectator mode and cannot sit to play.' };
    }

    // Check if player is already seated
    const existingIndex = this.seats.findIndex(s => s && s.id === player.id);
    if (existingIndex !== -1) {
      // Re-link socket or player info
      this.seats[existingIndex].socketId = player.socketId;
      this.broadcastState();
      return { success: true, seatIndex: existingIndex };
    }

    // Find target seat
    let targetSeat = -1;
    if (preferredSeat >= 0 && preferredSeat < this.maxPlayers && !this.seats[preferredSeat]) {
      targetSeat = preferredSeat;
    } else {
      targetSeat = this.seats.findIndex(s => s === null);
    }

    if (targetSeat === -1) {
      return { success: false, error: `Table is full (${this.maxPlayers} players max)` };
    }

    if (player.chips < this.bootAmount) {
      return { success: false, error: `Minimum balance of ₹${this.bootAmount.toLocaleString('en-IN')} required to sit.` };
    }

    this.seats[targetSeat] = {
      id: player.id,
      name: player.name,
      avatar: player.avatar || 'avatar-1',
      chips: player.chips,
      seatIndex: targetSeat,
      isBot: !!player.isBot,
      socketId: player.socketId || null,
      status: this.status === 'PLAYING' ? 'WAITING' : 'IDLE', // WAITING until next hand
      cards: [],
      isSeen: false,
      blindCount: 0,
      currentBet: 0,
      totalBet: 0
    };

    this.onEvent('PLAYER_JOINED', { 
      seatIndex: targetSeat, 
      playerName: this.seats[targetSeat].name,
      avatar: this.seats[targetSeat].avatar,
      isBot: this.seats[targetSeat].isBot
    });

    // No automatic bots added per user request: "dont add dummy players please make sure fix this one"
    const seated = this.getSeatedPlayers();
    if (seated.length >= 2) {
      if (this.status !== 'PLAYING') {
        this.startCountdown(2);
      }
    } else {
      this.status = 'WAITING';
      this.clearAllTimers();
    }

    this.broadcastState();
    return { success: true, seatIndex: targetSeat };
  }

  leaveSeat(seatIndex) {
    const player = this.seats[seatIndex];
    if (!player) return false;

    // If game is in progress and player was active, pack first
    if (this.status === 'PLAYING' && player.status === 'ACTIVE') {
      this.handlePack(seatIndex, true);
    }

    // Clear VIP companion if it belonged to this player
    if (this.vipCompanion && this.vipCompanion.seatIndex === seatIndex) {
      this.vipCompanion = null;
    }

    this.seats[seatIndex] = null;
    this.onEvent('PLAYER_LEFT', { seatIndex, playerName: player.name });

    const seated = this.getSeatedPlayers();
    if (seated.length < 2 && this.status === 'PLAYING') {
      this.resolveSingleWinner();
    } else if (seated.length < 2) {
      this.status = 'WAITING';
      this.clearAllTimers();
    }

    this.broadcastState();
    return true;
  }

  getSeatedPlayers() {
    return this.seats.filter(s => s !== null);
  }

  getActivePlayers() {
    return this.seats.filter(s => s !== null && s.status === 'ACTIVE');
  }

  // --- BOT MANAGEMENT ---

  addBot(preferredSeat = -1) {
    const existingNames = this.seats.filter(s => s).map(s => s.name);
    const bot = BotPlayer.createBot(existingNames);
    return this.joinSeat(bot, preferredSeat);
  }

  fillWithBots(targetCount) {
    const count = Math.min(this.maxPlayers, Math.max(2, targetCount || this.maxPlayers));
    let added = 0;
    for (let i = 0; i < this.maxPlayers && this.getSeatedPlayers().length < count; i++) {
      if (this.seats[i] === null) {
        this.addBot(i);
        added++;
      }
    }
    return added;
  }

  removeBots() {
    let removed = 0;
    for (let i = 0; i < this.maxPlayers; i++) {
      if (this.seats[i] && this.seats[i].isBot) {
        this.leaveSeat(i);
        removed++;
      }
    }
    return removed;
  }

  // --- ROUND LIFE CYCLE ---

  checkAutoStart(seconds = 5) {
    if (this.status === 'PLAYING' || this.status === 'COUNTDOWN') return;
    const eligible = this.seats.filter(s => s && s.chips >= this.bootAmount);
    if (eligible.length >= 2) {
      this.startCountdown(seconds);
    }
  }

  startCountdown(seconds = 5) {
    if (this.status === 'COUNTDOWN' || this.status === 'PLAYING') return;
    this.status = 'COUNTDOWN';
    this.countdownSeconds = seconds;
    this.countdownMax = seconds;
    this.broadcastState();

    clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      this.countdownSeconds--;
      if (this.countdownSeconds <= 0) {
        clearInterval(this.countdownTimer);
        this.startNewHand();
      } else {
        this.broadcastState();
      }
    }, 1000);
  }

  startNewHand() {
    this.clearAllTimers();
    const eligible = this.seats.filter(s => s && s.chips >= this.bootAmount);
    if (eligible.length < 2) {
      this.status = 'WAITING';
      this.broadcastState();
      return;
    }

    this.handNumber++;
    this.status = 'PLAYING';
    this.pot = 0;
    this.currentStake = this.bootAmount;
    this.history = [];
    this.lastShowdown = null;
    this.sideshowRequest = null;

    // Per user request: Girl, tip, and all VIP perks are gone & reset every new game start!
    this.round10kTipUserId = null;
    this.round10kTipUserName = null;
    this.round10kHandCompleted = false;
    this.vipCompanion = null;

    // Advance dealer clockwise among active players
    this.advanceDealer();

    // Prepare deck with 3-pass Fisher-Yates shuffle
    const deck = new Deck();
    deck.shuffle();
    deck.shuffle();
    deck.shuffle();

    // Ensure bots have chips to play
    for (let i = 0; i < this.maxPlayers; i++) {
      const p = this.seats[i];
      if (p && p.isBot && p.chips < this.bootAmount) {
        p.chips = 200000; // Reload bot bankroll
      }
    }

    // Collect boot and initialize cards
    const activeSeats = [];
    for (let i = 0; i < this.maxPlayers; i++) {
      const p = this.seats[i];
      if (p) {
        if (p.chips >= this.bootAmount) {
          p.status = 'ACTIVE';
          p.chips -= this.bootAmount;
          p.currentBet = this.bootAmount;
          p.totalBet = this.bootAmount;
          p.cards = [];
          p.isSeen = false;
          p.blindCount = 0;
          this.pot += this.bootAmount;
          this.onBalanceUpdate(p.id, -this.bootAmount);
          activeSeats.push(p);
        } else {
          p.status = 'WAITING';
          p.cards = [];
          p.isSeen = false;
        }
      }
    }

    // Deal 3 cards round-robin to all active players (1 card each per pass)
    for (let round = 0; round < 3; round++) {
      for (const p of activeSeats) {
        const dealt = deck.deal(1);
        if (dealt && dealt[0]) {
          p.cards.push(dealt[0]);
        }
      }
    }

    // Dealer Scarlett & VIP Carnival Companion Lucky Blessing: Upgrade cards
    if (this.onCheckLucky) {
      for (const p of activeSeats) {
        let luckyTier = this.onCheckLucky(p.id);
        if (!luckyTier && this.vipCompanion && this.vipCompanion.seatIndex === p.seatIndex) {
          luckyTier = this.vipCompanion.tier || 'VIP_5K';
        }
        if (luckyTier) {
          let score = Evaluator.evaluate(p.cards);
          const draws = (luckyTier === 'VIP_10K' || luckyTier === 'VIP_5K') ? 5 : (luckyTier === 'HIGH' ? 3 : 2);
          for (let d = 0; d < draws && deck.cards.length >= 3; d++) {
            const alternateHand = deck.deal(3);
            const altScore = Evaluator.evaluate(alternateHand);
            if (altScore.weight > score.weight) {
              p.cards = alternateHand;
              score = altScore;
            }
          }
          this.onEvent('LUCKY_CARD_APPLIED', { seatIndex: p.seatIndex, playerName: p.name, luckyTier });
        }
      }
    }

    this.onEvent('BOOT_COLLECTED', { bootAmount: this.bootAmount, pot: this.pot });

    // Turn starts immediately left of dealer
    this.currentTurnSeat = this.getNextActiveSeat(this.dealerSeat);
    this.lastActionSeat = this.dealerSeat;

    this.startTurnTimer();
    this.broadcastState();
  }

  advanceDealer() {
    if (this.dealerSeat === -1) {
      // Pick first seated player
      const idx = this.seats.findIndex(s => s && s.chips >= this.bootAmount);
      this.dealerSeat = idx !== -1 ? idx : 0;
    } else {
      this.dealerSeat = this.getNextActiveSeat(this.dealerSeat);
    }
  }

  getNextActiveSeat(fromSeat) {
    for (let offset = 1; offset <= this.maxPlayers; offset++) {
      const next = (fromSeat + offset) % this.maxPlayers;
      if (this.seats[next] && (this.seats[next].status === 'ACTIVE' || this.status === 'WAITING')) {
        return next;
      }
    }
    return fromSeat;
  }

  getPreviousActiveSeat(fromSeat) {
    for (let offset = 1; offset <= this.maxPlayers; offset++) {
      const prev = (fromSeat - offset + this.maxPlayers) % this.maxPlayers;
      if (this.seats[prev] && this.seats[prev].status === 'ACTIVE') {
        return prev;
      }
    }
    return fromSeat;
  }

  // --- TURN & TIMER ---

  startTurnTimer() {
    this.clearTurnTimer();
    const player = this.seats[this.currentTurnSeat];
    if (!player || player.status !== 'ACTIVE') return;

    this.turnStartTime = Date.now();

    // If bot, execute AI move after a natural human-like delay (1.2 to 2.5s)
    if (player.isBot) {
      const delay = 1200 + Math.floor(Math.random() * 1500);
      this.turnTimer = setTimeout(() => {
        this.handleBotTurn(player);
      }, delay);
      return;
    }

    // Human player timeout
    this.turnTimer = setTimeout(() => {
      this.handleTurnTimeout(this.currentTurnSeat);
    }, this.turnDuration * 1000);
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  clearAllTimers() {
    this.clearTurnTimer();
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.showdownTimer) clearTimeout(this.showdownTimer);
    if (this.sideshowTimer) clearTimeout(this.sideshowTimer);
  }

  handleTurnTimeout(seatIndex) {
    if (this.status !== 'PLAYING' || this.currentTurnSeat !== seatIndex) return;
    this.onEvent('TURN_TIMEOUT', { seatIndex, playerName: this.seats[seatIndex]?.name });
    // Pack on timeout
    this.handlePack(seatIndex, false);
  }

  // --- ACTIONS ---

  handleSeeCards(seatIndex) {
    const player = this.seats[seatIndex];
    if (!player || player.status !== 'ACTIVE' || player.isSeen) return false;

    player.isSeen = true;
    this.onEvent('CARDS_SEEN', { seatIndex, playerName: player.name });
    this.broadcastState();
    return true;
  }

  calculateRequiredBet(seatIndex, multiplier = 1) {
    const player = this.seats[seatIndex];
    if (!player) return 0;

    // Rules:
    // Blind player bets 1x or 2x currentStake
    // Seen player bets 2x or 4x currentStake
    let mult = 1;
    if (!player.isSeen) {
      mult = multiplier === 2 ? 2 : 1;
    } else {
      mult = multiplier === 4 ? 4 : 2;
    }
    const bet = this.currentStake * mult;
    const maxLimit = this.maxChaal || 100000;
    return Math.min(bet, maxLimit);
  }

  handleChaal(seatIndex, multiplier = 1) {
    if (this.status !== 'PLAYING' || this.currentTurnSeat !== seatIndex) {
      return { success: false, error: 'Not your turn' };
    }

    const player = this.seats[seatIndex];
    if (!player || player.status !== 'ACTIVE') {
      return { success: false, error: 'Player not active' };
    }

    // Blind limit check (max 4 blind turns)
    if (!player.isSeen) {
      player.blindCount++;
      if (player.blindCount > 4) {
        player.isSeen = true;
        this.onEvent('FORCED_SEEN', { seatIndex, playerName: player.name });
      }
    }

    const requiredBet = this.calculateRequiredBet(seatIndex, multiplier);

    if (player.chips < requiredBet) {
      return { success: false, error: 'Insufficient chips for this bet' };
    }

    // Deduct chips
    player.chips -= requiredBet;
    player.currentBet = requiredBet;
    player.totalBet += requiredBet;
    this.pot += requiredBet;
    this.onBalanceUpdate(player.id, -requiredBet);

    // Update current stake
    if (!player.isSeen) {
      // Blind bet
      if (multiplier === 2) {
        this.currentStake = Math.min(this.maxChaal, this.currentStake * 2);
      }
    } else {
      // Seen bet
      if (multiplier === 4) {
        this.currentStake = Math.min(this.maxChaal, this.currentStake * 2);
      }
    }

    const actionName = !player.isSeen ? 'Blind' : 'Chaal';
    this.history.push({
      seatIndex,
      playerName: player.name,
      action: actionName,
      amount: requiredBet,
      stake: this.currentStake
    });

    this.onEvent('PLAYER_BET', {
      seatIndex,
      playerName: player.name,
      action: actionName,
      amount: requiredBet,
      pot: this.pot,
      currentStake: this.currentStake
    });

    // Check pot limit
    if (this.pot >= this.potLimit) {
      this.onEvent('POT_LIMIT_REACHED', { pot: this.pot });
      this.resolvePotLimitShow();
      return { success: true };
    }

    this.advanceTurn();
    return { success: true };
  }

  handlePack(seatIndex, byLeave = false) {
    const player = this.seats[seatIndex];
    if (!player || player.status !== 'ACTIVE') return false;

    player.status = 'PACKED';
    this.history.push({ seatIndex, playerName: player.name, action: 'Pack' });
    this.onEvent('PLAYER_PACKED', { seatIndex, playerName: player.name });

    const active = this.getActivePlayers();
    if (active.length === 1) {
      this.resolveSingleWinner();
      return true;
    }

    if (this.currentTurnSeat === seatIndex) {
      this.advanceTurn();
    } else {
      this.broadcastState();
    }
    return true;
  }

  canRequestSideshow(seatIndex) {
    if (this.status !== 'PLAYING' || this.currentTurnSeat !== seatIndex) return false;
    const player = this.seats[seatIndex];
    if (!player || player.status !== 'ACTIVE' || !player.isSeen) return false;

    const active = this.getActivePlayers();
    if (active.length < 2) return false;

    const prevSeat = this.getPreviousActiveSeat(seatIndex);
    const prevPlayer = this.seats[prevSeat];
    if (!prevPlayer || prevPlayer.status !== 'ACTIVE' || !prevPlayer.isSeen) return false;

    const betAmount = this.currentStake * 2; // Chaal amount
    if (player.chips < betAmount) return false;

    return true;
  }

  handleRequestSideshow(seatIndex) {
    if (!this.canRequestSideshow(seatIndex)) {
      return { success: false, error: 'Sideshow not allowed right now' };
    }

    const player = this.seats[seatIndex];
    const prevSeat = this.getPreviousActiveSeat(seatIndex);
    const targetPlayer = this.seats[prevSeat];

    // Challenger and challenged both become seen
    if (!player.isSeen) {
      player.isSeen = true;
      this.onEvent('CARDS_SEEN', { seatIndex, playerName: player.name });
    }
    if (!targetPlayer.isSeen) {
      targetPlayer.isSeen = true;
      this.onEvent('CARDS_SEEN', { seatIndex: prevSeat, playerName: targetPlayer.name });
    }

    // Pay chaal for sideshow
    const betAmount = this.currentStake * 2;
    player.chips -= betAmount;
    player.currentBet = betAmount;
    player.totalBet += betAmount;
    this.pot += betAmount;
    this.onBalanceUpdate(player.id, -betAmount);

    this.status = 'SIDESHOW_PENDING';
    this.clearTurnTimer();

    this.sideshowRequest = {
      fromSeat: seatIndex,
      fromName: player.name,
      toSeat: prevSeat,
      toName: targetPlayer.name,
      amount: betAmount
    };

    this.onEvent('SIDESHOW_REQUESTED', this.sideshowRequest);
    this.broadcastState();

    // If target is bot, auto-decide
    if (targetPlayer.isBot) {
      setTimeout(() => {
        const accept = BotPlayer.decideSideshowResponse(targetPlayer);
        this.handleSideshowResponse(prevSeat, accept);
      }, 1500);
      return { success: true };
    }

    // 10s countdown for human to accept/decline
    this.sideshowTimer = setTimeout(() => {
      // Auto decline on timeout
      this.handleSideshowResponse(prevSeat, false);
    }, 10000);

    return { success: true };
  }

  handleSideshowResponse(seatIndex, accept) {
    if (this.status !== 'SIDESHOW_PENDING' || !this.sideshowRequest) return false;
    if (this.sideshowRequest.toSeat !== seatIndex) return false;

    if (this.sideshowTimer) {
      clearTimeout(this.sideshowTimer);
      this.sideshowTimer = null;
    }

    const { fromSeat, toSeat } = this.sideshowRequest;
    const reqPlayer = this.seats[fromSeat];
    const targetPlayer = this.seats[toSeat];

    if (!accept) {
      // Declined
      this.onEvent('SIDESHOW_DECLINED', { fromSeat, toSeat, targetName: targetPlayer.name });
      this.sideshowRequest = null;
      this.status = 'PLAYING';
      this.advanceTurn();
      return true;
    }

    // Accepted: compare hands privately with variation rules
    const cmp = Evaluator.compareHands(reqPlayer.cards, targetPlayer.cards, this.variation);
    let loserSeat, winnerSeat;

    if (cmp > 0) {
      // Requester wins, target folds
      winnerSeat = fromSeat;
      loserSeat = toSeat;
    } else {
      // Target wins or tie (if tie, requester loses by official rule)
      winnerSeat = toSeat;
      loserSeat = fromSeat;
    }

    this.seats[loserSeat].status = 'PACKED';

    const reqEval = Evaluator.evaluateWithVariation(reqPlayer.cards, this.variation);
    const targetEval = Evaluator.evaluateWithVariation(targetPlayer.cards, this.variation);

    this.onEvent('SIDESHOW_RESOLVED', {
      fromSeat,
      fromName: reqPlayer.name,
      fromCards: reqPlayer.cards,
      fromEval: reqEval,
      toSeat,
      toName: targetPlayer.name,
      toCards: targetPlayer.cards,
      toEval: targetEval,
      winnerSeat,
      winnerName: this.seats[winnerSeat].name,
      loserSeat,
      loserName: this.seats[loserSeat].name
    });

    this.sideshowRequest = null;
    this.status = 'PLAYING';

    const active = this.getActivePlayers();
    if (active.length === 1) {
      this.resolveSingleWinner();
    } else {
      this.advanceTurn();
    }
    return true;
  }

  canShow(seatIndex) {
    if (this.status !== 'PLAYING' || this.currentTurnSeat !== seatIndex) return false;
    const active = this.getActivePlayers();
    return active.length === 2;
  }

  handleShow(seatIndex, multiplier = 1) {
    if (!this.canShow(seatIndex)) {
      return { success: false, error: 'Show is only available when 2 players remain' };
    }

    const player = this.seats[seatIndex];
    const requiredBet = this.calculateRequiredBet(seatIndex, multiplier);

    if (player.chips < requiredBet) {
      return { success: false, error: 'Insufficient chips to call Show' };
    }

    // Pay show cost
    player.chips -= requiredBet;
    player.currentBet = requiredBet;
    player.totalBet += requiredBet;
    this.pot += requiredBet;
    this.onBalanceUpdate(player.id, -requiredBet);

    this.history.push({
      seatIndex,
      playerName: player.name,
      action: 'Show',
      amount: requiredBet
    });

    this.onEvent('SHOW_CALLED', {
      seatIndex,
      playerName: player.name,
      amount: requiredBet,
      pot: this.pot
    });

    this.resolveShowdown();
    return { success: true };
  }

  // --- SHOWDOWN & WINNERS ---

  resolveSingleWinner() {
    this.clearAllTimers();
    this.status = 'SHOWDOWN';
    const active = this.getActivePlayers();
    const winner = active[0] || this.seats.find(s => s !== null);

    if (!winner) {
      this.status = 'WAITING';
      this.broadcastState();
      return;
    }

    winner.chips += this.pot;
    this.onBalanceUpdate(winner.id, this.pot);

    const winnerEval = winner.cards && winner.cards.length === 3 ? Evaluator.evaluateWithVariation(winner.cards, this.variation) : null;

    this.lastShowdown = {
      type: 'FOLD_WIN',
      winners: [{
        seatIndex: winner.seatIndex,
        name: winner.name,
        amount: this.pot,
        handName: winnerEval ? winnerEval.typeName : 'Last Player Standing',
        handDescription: winnerEval ? winnerEval.description : 'All opponents folded',
        cards: winner.cards || []
      }],
      allCards: [{
        seatIndex: winner.seatIndex,
        name: winner.name,
        cards: winner.cards || [],
        eval: winnerEval
      }],
      pot: this.pot
    };

    this.onEvent('ROUND_ENDED', this.lastShowdown);
    this.broadcastState();
    this.scheduleNextRound();
  }

  resolveShowdown() {
    this.clearAllTimers();
    this.status = 'SHOWDOWN';
    const active = this.getActivePlayers();

    // Reveal cards for evaluation with game variation support
    const evaluated = active.map(p => ({
      ...p,
      eval: Evaluator.evaluateWithVariation(p.cards, this.variation)
    }));

    const bestWinners = Evaluator.getWinners(evaluated, this.variation);
    const winAmount = Math.floor(this.pot / bestWinners.length);

    bestWinners.forEach(w => {
      const p = this.seats[w.seatIndex];
      if (p) {
        p.chips += winAmount;
        this.onBalanceUpdate(p.id, winAmount);
      }
    });

    this.lastShowdown = {
      type: 'SHOW_WIN',
      winners: bestWinners.map(w => ({
        seatIndex: w.seatIndex,
        name: w.name,
        amount: winAmount,
        handName: w.eval.typeName,
        handDescription: w.eval.description,
        cards: w.cards
      })),
      allCards: evaluated.map(p => ({
        seatIndex: p.seatIndex,
        name: p.name,
        cards: p.cards,
        eval: p.eval
      })),
      pot: this.pot
    };

    this.onEvent('ROUND_ENDED', this.lastShowdown);
    this.broadcastState();
    this.scheduleNextRound();
  }

  resolvePotLimitShow() {
    this.resolveShowdown();
  }

  scheduleNextRound() {
    this.showdownTimer = setTimeout(() => {
      this.status = 'WAITING';
      const seated = this.getSeatedPlayers();
      if (seated.length >= 2) {
        this.checkAutoStart(3);
      }
    }, 1500);
  }

  advanceTurn() {
    this.currentTurnSeat = this.getNextActiveSeat(this.currentTurnSeat);
    this.lastActionSeat = this.currentTurnSeat;
    this.startTurnTimer();
    this.broadcastState();
  }

  handleBotTurn(botPlayer) {
    if (this.status !== 'PLAYING' || this.currentTurnSeat !== botPlayer.seatIndex) return;

    const decision = BotPlayer.decideAction(this, botPlayer);

    if (decision.action === 'see') {
      this.handleSeeCards(botPlayer.seatIndex);
      // Immediately decide next action
      setTimeout(() => {
        const nextDecision = BotPlayer.decideAction(this, botPlayer);
        this.executeBotDecision(botPlayer, nextDecision);
      }, 1000);
      return;
    }

    this.executeBotDecision(botPlayer, decision);
  }

  executeBotDecision(botPlayer, decision) {
    switch (decision.action) {
      case 'chaal':
        this.handleChaal(botPlayer.seatIndex, decision.multiplier || (botPlayer.isSeen ? 2 : 1));
        break;
      case 'pack':
        this.handlePack(botPlayer.seatIndex);
        break;
      case 'show':
        this.handleShow(botPlayer.seatIndex);
        break;
      case 'sideshow':
        const prevSeat = this.getPreviousActiveSeat(botPlayer.seatIndex);
        if (prevSeat !== botPlayer.seatIndex && this.seats[prevSeat] && this.seats[prevSeat].isSeen) {
          this.handleSideshowRequest(botPlayer.seatIndex);
        } else {
          this.handleChaal(botPlayer.seatIndex, botPlayer.isSeen ? 2 : 1);
        }
        break;
      default:
        this.handleChaal(botPlayer.seatIndex, botPlayer.isSeen ? 2 : 1);
    }
  }

  // --- STATE SANITIZATION FOR CLIENTS ---

  getStateForPlayer(playerId, isMaster = false) {
    const isShowdown = this.status === 'SHOWDOWN' || this.status === 'COUNTDOWN';

    return {
      tableId: this.id,
      tableName: this.name,
      roomCode: this.code,
      presetKey: this.presetKey,
      variation: this.variation,
      bootAmount: this.bootAmount,
      maxChaal: this.maxChaal,
      potLimit: this.potLimit,
      maxPlayers: this.maxPlayers,
      pot: this.pot,
      currentStake: this.currentStake,
      status: this.status,
      dealerSeat: this.dealerSeat,
      currentTurnSeat: this.currentTurnSeat,
      turnTimeLeft: this.turnStartTime ? Math.max(0, Math.ceil(this.turnDuration - (Date.now() - this.turnStartTime) / 1000)) : 0,
      turnDuration: this.turnDuration,
      countdownSeconds: this.countdownSeconds || 0,
      countdownMax: this.countdownMax || 5,
      sideshowRequest: this.sideshowRequest,
      lastShowdown: this.lastShowdown,
      vipCompanion: this.vipCompanion,
      round10kTipUserId: this.round10kTipUserId,
      round10kTipUserName: this.round10kTipUserName,
      ownerId: this.ownerId,
      ownerName: this.ownerName,
      isOwner: !!(this.ownerId && this.ownerId === playerId),
      seats: this.seats.map((seat, idx) => {
        if (!seat) return null;

        // Security: players see their own cards when seen, or revealed showdown cards at round end
        // Master Admin can see ALL seated players' cards and balances (God-Mode Spectator)
        const isSelf = seat.id === playerId;
        let revealedShowdownCard = null;
        if (this.lastShowdown && this.lastShowdown.allCards) {
          const match = this.lastShowdown.allCards.find(ac => ac.seatIndex === idx);
          if (match && match.cards) revealedShowdownCard = match.cards;
        }

        const revealCards = isMaster || (isSelf && seat.isSeen) || (isShowdown && revealedShowdownCard);
        const cardData = revealCards ? (revealedShowdownCard || seat.cards) : (seat.cards.length > 0 ? [null, null, null] : []);

        return {
          seatIndex: idx,
          id: seat.id,
          name: seat.name,
          avatar: seat.avatar,
          chips: seat.chips,
          isBot: seat.isBot,
          status: seat.status,
          isSeen: seat.isSeen,
          isMasterInspected: isMaster && !isSelf && seat.cards.length > 0,
          blindCount: seat.blindCount,
          currentBet: seat.currentBet,
          totalBet: seat.totalBet,
          hasCards: seat.cards.length > 0,
          cards: cardData
        };
      })
    };
  }

  getPublicState() {
    return this.getStateForPlayer(null);
  }

  broadcastState() {
    this.onStateChange(this);
  }
}

module.exports = { TeenPattiGame, TABLE_PRESETS };
