const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const userStore = require('./models/UserStore');
const TableManager = require('./sockets/gameSocket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const tableManager = new TableManager(io);

// Socket.IO connection
io.on('connection', (socket) => {
  tableManager.handleSocket(socket);
});

// REST API

// 1. User Registration (10 Lakh chips default)
app.post('/api/register', (req, res) => {
  try {
    const { username, password, avatar } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = userStore.register(username, password, avatar);
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2. User Login
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = userStore.login(username, password);
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. User Me / Refresh
app.get('/api/me/:userId', (req, res) => {
  const user = userStore.getUserById(req.params.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ success: true, user });
});

// 4. Master Admin: Get All Users
app.get('/api/admin/users', (req, res) => {
  try {
    const masterId = req.query.masterId;
    const users = userStore.getAllUsers(masterId);
    res.json({ success: true, users });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// 5. Master Admin: Add / Deduct Chips
app.post('/api/admin/chips', (req, res) => {
  try {
    const { masterId, targetUserId, amount, action } = req.body;
    const result = userStore.masterManageChips(masterId, targetUserId, amount, action);
    
    // Live sync seated chips on any active table
    if (tableManager && tableManager.tables) {
      for (const [, table] of tableManager.tables) {
        const seat = table.seats.find(s => s && s.id === targetUserId);
        if (seat) {
          seat.chips = result.newBalance;
          table.broadcastState();
        }
      }
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5b. Master Admin: Bulk Reset All Users to 0 Chips
app.post('/api/admin/bulk-reset-zero', (req, res) => {
  try {
    const { masterId } = req.body;
    const result = userStore.masterBulkResetZero(masterId);

    // Sync all active table seats
    if (tableManager && tableManager.tables) {
      for (const [, table] of tableManager.tables) {
        for (const seat of table.seats) {
          if (seat && !seat.isBot) {
            const u = userStore.getUserById(seat.id);
            if (u && u.role !== 'master') {
              seat.chips = 0;
            }
          }
        }
        table.broadcastState();
      }
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5c. Master Admin: Bulk Add 20 Lakh (or custom) Chips to ALL Users
app.post('/api/admin/bulk-add-chips', (req, res) => {
  try {
    const { masterId, amount } = req.body;
    const result = userStore.masterBulkAddChips(masterId, amount || 2000000);

    // Sync all active table seats
    if (tableManager && tableManager.tables) {
      for (const [, table] of tableManager.tables) {
        for (const seat of table.seats) {
          if (seat && !seat.isBot) {
            const u = userStore.getUserById(seat.id);
            if (u && u.role !== 'master') {
              seat.chips = u.chips;
            }
          }
        }
        table.broadcastState();
      }
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Tip Live Dealer
app.post('/api/table/tip-dealer', (req, res) => {
  try {
    const { userId, tipAmount } = req.body;
    const numTip = Math.max(1, parseInt(tipAmount, 10) || 50);

    // If 10k tip, verify round exclusivity: only 1 player per round can send 10k tip
    if (tableManager && tableManager.tables && numTip >= 10000) {
      for (const [, table] of tableManager.tables) {
        const seat = table.seats.find(s => s && s.id === userId);
        if (seat) {
          if (table.round10kTipUserId && table.round10kTipUserId !== userId) {
            return res.status(400).json({
              error: `👑 10K VIP Dealer is exclusive! ${table.round10kTipUserName || 'Another player'} has her by their side this round. You can tip other amounts (₹50 - ₹5,000)!`
            });
          }
        }
      }
    }

    const result = userStore.tipDealer(userId, numTip);

    // Live sync seated chips on any active table & broadcast to all players in the room
    if (tableManager && tableManager.tables) {
      for (const [, table] of tableManager.tables) {
        const seat = table.seats.find(s => s && s.id === userId);
        if (seat) {
          seat.chips = result.chips;
          if (result.tipAmount >= 10000) {
            table.record10kTip(userId, seat.name);
            table.vipCompanion = {
              seatIndex: seat.seatIndex,
              userId,
              userName: seat.name,
              tier: result.luckyTier,
              tipAmount: result.tipAmount,
              companionImage: '/images/dealer_carnival_vip.png'
            };
          }
          table.broadcastState();
          tableManager.broadcastTableEvent(table.id, 'DEALER_TIPPED', {
            seatIndex: seat.seatIndex,
            userId,
            userName: seat.name,
            tipAmount: result.tipAmount,
            luckyTier: result.luckyTier,
            bonusGift: result.bonusGift,
            blessingMessage: result.blessingMessage
          });
        }
      }
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4b. Master Admin: Get All Live Tables & Inspect Rooms
app.get('/api/admin/tables', (req, res) => {
  try {
    const masterId = req.query.masterId;
    const reqUser = userStore.getUserByIdOrUsername(masterId);
    if (!reqUser || reqUser.role !== 'master') {
      return res.status(403).json({ error: 'Unauthorized. Only master account can inspect all tables.' });
    }
    const tables = tableManager.getAllTablesForMaster();
    res.json({ success: true, tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Get All Active Tables / Rooms
app.get('/api/tables', (req, res) => {
  const tables = tableManager.getAllPublicTables();
  res.json({ success: true, tables });
});

// 8. Create Custom / Private Table Room
app.post('/api/tables/create', (req, res) => {
  try {
    const { name, bootAmount, potLimit, isPrivate, variation, maxPlayers, ownerId, ownerName } = req.body;
    const boot = parseInt(bootAmount, 10) || 1000;
    const limit = parseInt(potLimit, 10) || (boot * 1024);
    const size = parseInt(maxPlayers, 10) || 10;

    const table = tableManager.createTable({
      name: name || 'Private Club Room',
      bootAmount: boot,
      maxChaal: boot * 128,
      potLimit: limit,
      isPrivate: !!isPrivate,
      variation: variation || 'classic',
      maxPlayers: size,
      ownerId: ownerId || null,
      ownerName: ownerName || null
    });

    res.json({
      success: true,
      table: {
        id: table.id,
        name: table.name,
        bootAmount: table.bootAmount,
        potLimit: table.potLimit,
        code: table.code,
        isPrivate: table.isPrivate,
        variation: table.variation,
        maxPlayers: table.maxPlayers
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Join Table by Room Code
app.post('/api/tables/join-code', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Room code required' });

  let table = tableManager.findTableByCode(code);
  if (!table) {
    table = tableManager.getTable(code);
  }
  if (table) {
    return res.json({ success: true, tableId: table.id, tableCode: table.code, tableName: table.name });
  }
  res.status(404).json({ error: 'Table with this room code was not found' });
});

// Direct Room / Table URL routes: /room/CODE or /table/CODE
app.get(['/room/:code', '/table/:code'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Fallback index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`🚀 Teen Patti Server is running on port ${port} - http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${port} is in use, trying port ${port + 1}...`);
      server.close();
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(DEFAULT_PORT);
