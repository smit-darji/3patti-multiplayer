const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbManager = require('./Database');

const DATA_DIR = path.join(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const DEFAULT_BALANCE = 1000000; // 10 Lakh (1,000,000) chips default

class UserStore {
  constructor() {
    this.users = new Map(); // username.toLowerCase() -> user
    this.init();
  }

  init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(USERS_FILE)) {
      try {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        const list = JSON.parse(raw);
        for (const u of list) {
          this.users.set(u.username.toLowerCase(), u);
        }
      } catch (err) {
        console.error('Failed reading users.json:', err);
      }
    }

    // Ensure master account exists
    if (!this.users.has('master')) {
      const masterUser = {
        id: 'usr_master_001',
        username: 'master',
        passwordHash: this.hashPassword('master123'),
        avatar: 'human-5',
        role: 'master',
        chips: 100000000, // 10 Crore chips
        handsPlayed: 0,
        handsWon: 0,
        luckyBuff: false,
        createdAt: new Date().toISOString()
      };
      this.users.set('master', masterUser);
    }

    // Ensure admin account exists as master
    if (!this.users.has('admin')) {
      const adminUser = {
        id: 'usr_master_002',
        username: 'admin',
        passwordHash: this.hashPassword('admin123'),
        avatar: 'human-2',
        role: 'master',
        chips: 100000000, // 10 Crore chips
        handsPlayed: 0,
        handsWon: 0,
        luckyBuff: false,
        createdAt: new Date().toISOString()
      };
      this.users.set('admin', adminUser);
    }

    this.save();
  }

  save() {
    try {
      const list = Array.from(this.users.values());
      fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf8');
      dbManager.syncToJSON(list);
    } catch (err) {
      console.error('Failed writing users.json:', err);
    }
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  register(username, password, avatar = 'human-1') {
    const cleanUsername = username.trim();
    if (!cleanUsername || cleanUsername.length < 2) {
      throw new Error('Username must be at least 2 characters');
    }
    if (!password || password.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }

    const key = cleanUsername.toLowerCase();
    if (this.users.has(key)) {
      throw new Error(`Username "${cleanUsername}" is already registered. Please choose another username or log in.`);
    }

    const isMaster = key === 'master' || key === 'admin';

    const user = {
      id: 'usr_' + crypto.randomUUID().slice(0, 8),
      username: cleanUsername,
      passwordHash: this.hashPassword(password),
      avatar: avatar,
      role: isMaster ? 'master' : 'player',
      chips: isMaster ? 100000000 : DEFAULT_BALANCE, // 10 Lakh starting chips
      handsPlayed: 0,
      handsWon: 0,
      luckyBuff: false,
      createdAt: new Date().toISOString()
    };

    this.users.set(key, user);
    this.save();
    dbManager.logTransaction(user.id, 'REGISTER_BONUS', user.chips, user.chips, 'Initial Signup Bankroll');

    return this.sanitize(user);
  }

  login(username, password) {
    const key = username.trim().toLowerCase();
    const user = this.users.get(key);
    if (!user) {
      throw new Error(`User "${username.trim()}" not found. Please register first or check your username.`);
    }

    const hash = this.hashPassword(password);
    if (user.passwordHash !== hash) {
      throw new Error('Incorrect password. Please try again.');
    }

    return this.sanitize(user);
  }

  getUserById(id) {
    for (const u of this.users.values()) {
      if (u.id === id) return this.sanitize(u);
    }
    return null;
  }

  getUserByIdOrUsername(idOrUsername) {
    if (!idOrUsername) return null;
    const clean = idOrUsername.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.id === idOrUsername || u.username.toLowerCase() === clean) {
        return this.sanitize(u);
      }
    }
    return null;
  }

  getAllUsers(requestingUserId) {
    const reqUser = this.getUserByIdOrUsername(requestingUserId);
    if (!reqUser || reqUser.role !== 'master') {
      throw new Error('Unauthorized. Only master account can view user management.');
    }

    const list = [];
    for (const u of this.users.values()) {
      list.push(this.sanitize(u));
    }
    return list;
  }

  masterManageChips(requestingUserId, targetUserId, amount, action) {
    const reqUser = this.getUserByIdOrUsername(requestingUserId);
    if (!reqUser || reqUser.role !== 'master') {
      throw new Error('Unauthorized. Only master account can add or remove chips.');
    }

    const numAmount = parseInt(amount, 10);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Invalid chip amount');
    }

    let targetUser = null;
    const cleanTarget = (targetUserId || '').trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.id === targetUserId || u.username.toLowerCase() === cleanTarget) {
        targetUser = u;
        break;
      }
    }

    if (!targetUser) {
      throw new Error('Target player not found');
    }

    if (action === 'add') {
      targetUser.chips += numAmount;
      dbManager.logTransaction(targetUser.id, 'MASTER_ADD', numAmount, targetUser.chips, `Added by Master ${reqUser.username}`);
    } else if (action === 'deduct') {
      targetUser.chips = Math.max(0, targetUser.chips - numAmount);
      dbManager.logTransaction(targetUser.id, 'MASTER_DEDUCT', numAmount, targetUser.chips, `Deducted by Master ${reqUser.username}`);
    } else {
      throw new Error('Action must be add or deduct');
    }

    this.save();
    return { targetUser: this.sanitize(targetUser), newBalance: targetUser.chips };
  }

  masterBulkResetZero(requestingUserId) {
    const reqUser = this.getUserByIdOrUsername(requestingUserId);
    if (!reqUser || reqUser.role !== 'master') {
      throw new Error('Unauthorized. Only master account can perform bulk reset.');
    }

    let affectedCount = 0;
    for (const u of this.users.values()) {
      if (u.role !== 'master') {
        u.chips = 0;
        affectedCount++;
        dbManager.logTransaction(u.id, 'MASTER_RESET_ZERO', 0, 0, `Reset to 0 by Master ${reqUser.username}`);
      }
    }
    this.save();
    return { success: true, affectedCount, message: `Reset chips to 0 for all ${affectedCount} players.` };
  }

  masterBulkAddChips(requestingUserId, amount = 2000000) {
    const reqUser = this.getUserByIdOrUsername(requestingUserId);
    if (!reqUser || reqUser.role !== 'master') {
      throw new Error('Unauthorized. Only master account can perform bulk chip additions.');
    }

    const numAmount = parseInt(amount, 10) || 2000000;
    let affectedCount = 0;
    for (const u of this.users.values()) {
      if (u.role !== 'master') {
        u.chips += numAmount;
        affectedCount++;
        dbManager.logTransaction(u.id, 'MASTER_BULK_ADD', numAmount, u.chips, `Bulk grant by Master ${reqUser.username}`);
      }
    }
    this.save();
    return { success: true, affectedCount, amountAdded: numAmount, message: `Added ${numAmount.toLocaleString('en-IN')} chips to all ${affectedCount} players.` };
  }

  tipDealer(userId, amount) {
    const tip = Math.max(50, parseInt(amount, 10) || 50);
    for (const u of this.users.values()) {
      if (u.id === userId) {
        if (u.chips < tip) {
          throw new Error('Insufficient chips for tip');
        }
        
        // Directly deduct tip amount from user account
        u.chips = Math.max(0, u.chips - tip);

        // 🍀 Dealer Lucky Blessing Perk: Scarlett grants lucky card weighting buff for next hand!
        u.luckyBuff = true;
        u.luckyTier = tip >= 10000 ? 'VIP_10K' : (tip >= 5000 ? 'VIP_5K' : (tip >= 1000 ? 'HIGH' : 'STANDARD'));

        this.save();
        dbManager.logTransaction(u.id, 'TIP_DEALER', tip, u.chips, `Tipped Dealer ₹${tip} - Lucky Blessing (${u.luckyTier}) Activated!`);

        const isVipCompanion = tip >= 5000;
        const blessingMessage = tip >= 10000
          ? `VIP Carnival Queen sat beside you, gave you a passionate kiss & blessed your cards with 10K Gold Luck! 💋👑✨`
          : (tip >= 5000
            ? `VIP Companion arrived at your seat, blew a sweet kiss & blessed your cards with Lucky Hands! 💋🍀✨`
            : `Scarlett blew you a sweet kiss & blessed your next hand with Lucky Cards! 💋🍀✨`);

        return { 
          success: true, 
          chips: u.chips, 
          tipAmount: tip, 
          luckyBuff: true,
          luckyTier: u.luckyTier,
          blessingMessage 
        };
      }
    }
    throw new Error('User not found');
  }

  consumeLuckyBuff(userId) {
    for (const u of this.users.values()) {
      if (u.id === userId && u.luckyBuff) {
        u.luckyBuff = false;
        const tier = u.luckyTier || 'STANDARD';
        u.luckyTier = null;
        this.save();
        return tier;
      }
    }
    return false;
  }

  updateBalance(userId, deltaChips) {
    for (const u of this.users.values()) {
      if (u.id === userId) {
        u.chips = Math.max(0, u.chips + deltaChips);
        this.save();
        return u.chips;
      }
    }
    return null;
  }

  recordHandResult(userId, won, chipsDelta) {
    for (const u of this.users.values()) {
      if (u.id === userId) {
        u.handsPlayed++;
        if (won) u.handsWon++;
        u.chips = Math.max(0, u.chips + chipsDelta);
        this.save();
        return;
      }
    }
  }

  sanitize(user) {
    const { passwordHash, ...clean } = user;
    return clean;
  }
}

module.exports = new UserStore();
