let sqlite3 = null;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (e) {
  console.warn('⚠️ SQLite3 native addon could not be loaded on this host. Falling back to persistent JSON store:', e.message);
}

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'teenpatti.db');
const USERS_JSON = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class DatabaseManager {
  constructor() {
    this.db = null;
    if (sqlite3) {
      try {
        this.db = new sqlite3.Database(DB_FILE, (err) => {
          if (err) {
            console.error('Failed connecting to SQLite database:', err.message);
          } else {
            console.log('✅ SQLite Database connected:', DB_FILE);
          }
        });
        this.initTables();
      } catch (err) {
        console.warn('⚠️ SQLite initialization warning:', err.message);
      }
    } else {
      console.log('📦 Operating in persistent JSON document storage mode.');
    }
  }

  initTables() {
    if (!this.db) return;
    this.db.serialize(() => {
      // 1. Users Table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          passwordHash TEXT NOT NULL,
          avatar TEXT DEFAULT 'human-1',
          role TEXT DEFAULT 'player',
          chips INTEGER DEFAULT 1000000,
          handsPlayed INTEGER DEFAULT 0,
          handsWon INTEGER DEFAULT 0,
          luckyBuff INTEGER DEFAULT 0,
          createdAt TEXT,
          updatedAt TEXT
        )
      `);

      // 2. Chip Transactions Log Table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS chip_transactions (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          type TEXT NOT NULL,
          amount INTEGER NOT NULL,
          balanceAfter INTEGER NOT NULL,
          description TEXT,
          createdAt TEXT,
          FOREIGN KEY (userId) REFERENCES users(id)
        )
      `);

      // 3. Game Rooms Table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS game_rooms (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          bootAmount INTEGER NOT NULL,
          potLimit INTEGER NOT NULL,
          isPrivate INTEGER DEFAULT 0,
          variation TEXT DEFAULT 'classic',
          maxPlayers INTEGER DEFAULT 10,
          status TEXT DEFAULT 'WAITING',
          createdAt TEXT
        )
      `);

      // 4. Hand History Table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS hand_history (
          id TEXT PRIMARY KEY,
          tableId TEXT NOT NULL,
          handNumber INTEGER NOT NULL,
          pot INTEGER NOT NULL,
          winnerIds TEXT,
          winningHandType TEXT,
          createdAt TEXT
        )
      `);

      // Migrate existing users.json if present
      this.migrateFromJSON();
    });
  }

  migrateFromJSON() {
    if (fs.existsSync(USERS_JSON)) {
      try {
        const raw = fs.readFileSync(USERS_JSON, 'utf8');
        const users = JSON.parse(raw);
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO users (id, username, passwordHash, avatar, role, chips, handsPlayed, handsWon, luckyBuff, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const u of users) {
          stmt.run([
            u.id,
            u.username,
            u.passwordHash,
            u.avatar || 'human-1',
            u.role || 'player',
            u.chips !== undefined ? u.chips : 1000000,
            u.handsPlayed || 0,
            u.handsWon || 0,
            u.luckyBuff ? 1 : 0,
            u.createdAt || new Date().toISOString(),
            new Date().toISOString()
          ]);
        }
        stmt.finalize();
      } catch (err) {
        console.error('Error migrating users.json to SQLite:', err.message);
      }
    }
  }

  syncToJSON(usersList) {
    try {
      fs.writeFileSync(USERS_JSON, JSON.stringify(usersList, null, 2), 'utf8');
    } catch (err) {
      console.error('Error writing users.json backup:', err.message);
    }
  }

  logTransaction(userId, type, amount, balanceAfter, description = '') {
    if (!this.db) return;
    const txId = 'tx_' + crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO chip_transactions (id, userId, type, amount, balanceAfter, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [txId, userId, type, amount, balanceAfter, description, now],
      (err) => {
        if (err) console.error('Failed logging transaction:', err.message);
      }
    );
  }

  recordHandHistory(tableId, handNumber, pot, winnerIds, winningHandType) {
    if (!this.db) return;
    const id = 'hand_' + crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO hand_history (id, tableId, handNumber, pot, winnerIds, winningHandType, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, tableId, handNumber, pot, JSON.stringify(winnerIds), winningHandType, now],
      (err) => {
        if (err) console.error('Failed recording hand history:', err.message);
      }
    );
  }
}

module.exports = new DatabaseManager();
