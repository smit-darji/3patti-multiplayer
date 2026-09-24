const { TeenPattiGame, TABLE_PRESETS } = require('../engine/TeenPattiGame');
const userStore = require('../models/UserStore');

class TableManager {
  constructor(io) {
    this.io = io;
    this.tables = new Map(); // tableId -> TeenPattiGame
    this.userTableMap = new Map(); // socketId -> { tableId, userId }
    this.initDefaultTables();
  }

  initDefaultTables() {
    // Create pre-configured public tables for each preset
    const presets = [
      { key: 'novice', name: 'Emerald Lounge (Boot ₹1,000)' },
      { key: 'casual', name: 'Ruby Club (Boot ₹5,000)' },
      { key: 'pro', name: 'Sapphire Table (Boot ₹10,000)' },
      { key: 'highroller', name: 'Diamond High Roller (Boot ₹50,000)' },
      { key: 'vip', name: 'Macau VIP Suite (Boot ₹1,00,000)' }
    ];

    presets.forEach(p => {
      this.createTable({
        id: `pub_${p.key}`,
        name: p.name,
        presetKey: p.key,
        isPrivate: false
      });
    });
  }

  createTable(options) {
    const table = new TeenPattiGame({
      ...options,
      onStateChange: (t) => this.broadcastTableState(t),
      onEvent: (event, data) => this.broadcastTableEvent(table.id, event, data),
      onBalanceUpdate: (userId, delta) => {
        userStore.updateBalance(userId, delta);
      },
      onCheckLucky: (userId) => {
        return userStore.consumeLuckyBuff(userId);
      }
    });

    this.tables.set(table.id, table);
    return table;
  }

  getTable(tableId) {
    return this.tables.get(tableId);
  }

  findTableByCode(code) {
    if (!code) return null;
    const clean = code.trim().toUpperCase();
    for (const table of this.tables.values()) {
      if (table.code && table.code.toUpperCase() === clean) {
        return table;
      }
      if (table.id && table.id.toUpperCase() === clean) {
        return table;
      }
      if (table.presetKey && table.presetKey.toUpperCase() === clean) {
        return table;
      }
      if (table.name && table.name.toUpperCase() === clean) {
        return table;
      }
    }
    return null;
  }

  getAllPublicTables() {
    const list = [];
    for (const table of this.tables.values()) {
      list.push({
        id: table.id,
        code: table.code,
        name: table.name,
        presetKey: table.presetKey,
        bootAmount: table.bootAmount,
        potLimit: table.potLimit,
        playerCount: table.getSeatedPlayers().length,
        maxPlayers: table.maxPlayers,
        pot: table.pot,
        status: table.status,
        isPrivate: table.isPrivate,
        variation: table.variation
      });
    }
    return list;
  }

  getAllTablesForMaster() {
    const list = [];
    for (const table of this.tables.values()) {
      list.push({
        id: table.id,
        code: table.code,
        name: table.name,
        presetKey: table.presetKey,
        bootAmount: table.bootAmount,
        potLimit: table.potLimit,
        playerCount: table.getSeatedPlayers().length,
        maxPlayers: table.maxPlayers,
        pot: table.pot,
        status: table.status,
        isPrivate: table.isPrivate,
        variation: table.variation,
        seats: table.seats.map((s, idx) => s ? {
          seatIndex: idx,
          id: s.id,
          name: s.name,
          chips: s.chips,
          status: s.status,
          isBot: s.isBot,
          hasCards: s.cards.length > 0,
          cards: s.cards
        } : null)
      });
    }
    return list;
  }

  broadcastTableState(table) {
    // Send customized sanitized state to each connected player at this table
    const room = this.io.sockets.adapter.rooms.get(table.id);
    if (!room) return;

    for (const socketId of room) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        const userId = socket.data?.user?.id;
        const role = socket.data?.user?.role;
        const isMaster = role === 'master' || role === 'admin';
        socket.emit('TABLE_STATE', table.getStateForPlayer(userId, isMaster));
      }
    }
  }

  broadcastTableEvent(tableId, event, data) {
    if (event === 'SIDESHOW_RESOLVED') {
      const table = this.getTable(tableId);
      const room = this.io.sockets.adapter.rooms.get(tableId);
      if (room && table) {
        for (const socketId of room) {
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            const userId = socket.data?.user?.id;
            const playerSeat = table.seats.findIndex(s => s && s.id === userId);

            // Private comparison: ONLY the 2 participating players receive full cards and evaluation
            if (playerSeat === data.fromSeat || playerSeat === data.toSeat) {
              socket.emit('TABLE_EVENT', { event, data, timestamp: Date.now() });
            } else {
              // Spectators / other players only receive public outcome without cards
              const publicData = {
                fromSeat: data.fromSeat,
                fromName: data.fromName,
                toSeat: data.toSeat,
                toName: data.toName,
                winnerSeat: data.winnerSeat,
                winnerName: data.winnerName,
                loserSeat: data.loserSeat,
                loserName: data.loserName
              };
              socket.emit('TABLE_EVENT', { event, data: publicData, timestamp: Date.now() });
            }
          }
        }
        return;
      }
    }
    this.io.to(tableId).emit('TABLE_EVENT', { event, data, timestamp: Date.now() });
  }

  handleSocket(socket) {
    // 1. Join a table room (as spectator, master/admin, or seated player)
    socket.on('JOIN_TABLE', ({ tableId, user }) => {
      let table = this.getTable(tableId);
      if (!table) {
        table = this.findTableByCode(tableId);
      }
      if (!table) {
        socket.emit('ERROR', { message: 'Table not found' });
        return;
      }

      socket.join(table.id);
      socket.data.user = user;
      socket.data.tableId = table.id;
      this.userTableMap.set(socket.id, { tableId: table.id, userId: user.id });

      // Automatically assign first joiner as owner for private/custom room if not set
      if ((table.isPrivate || !table.id.startsWith('pub_')) && !table.ownerId && user) {
        table.ownerId = user.id;
        table.ownerName = user.username;
      }

      const isMaster = user && (user.role === 'master' || user.role === 'admin');
      // Send immediate state with master vision if applicable
      socket.emit('TABLE_STATE', table.getStateForPlayer(user.id, isMaster));
      socket.emit('SYSTEM_MESSAGE', `Welcome to ${table.name}! Up to ${table.maxPlayers || 10} players can play.`);
    });

    // 2. Take a seat
    socket.on('TAKE_SEAT', ({ seatIndex }) => {
      const tableId = socket.data.tableId;
      const user = socket.data.user;
      if (!tableId || !user) return;

      const table = this.getTable(tableId);
      if (!table) return;

      // Refresh current chip count from store
      const dbUser = userStore.getUserById(user.id);
      if (dbUser) {
        user.chips = dbUser.chips;
      }

      const result = table.joinSeat({
        id: user.id,
        name: user.username,
        avatar: user.avatar,
        chips: user.chips,
        socketId: socket.id
      }, seatIndex);

      if (!result.success) {
        socket.emit('ERROR', { message: result.error });
      }
    });

    // 3. Stand up / leave seat
    socket.on('LEAVE_SEAT', () => {
      const tableId = socket.data.tableId;
      const user = socket.data.user;
      if (!tableId || !user) return;

      const table = this.getTable(tableId);
      if (!table) return;

      const seatIndex = table.seats.findIndex(s => s && s.id === user.id);
      if (seatIndex !== -1) {
        table.leaveSeat(seatIndex);
      }
    });

    // 4. Player Action: See Cards
    socket.on('ACTION_SEE', () => {
      const tableId = socket.data.tableId;
      const user = socket.data.user;
      const table = this.getTable(tableId);
      if (!table || !user) return;

      const seatIndex = table.seats.findIndex(s => s && s.id === user.id);
      if (seatIndex !== -1) {
        table.handleSeeCards(seatIndex);
      }
    });

    // 5. Player Action: Chaal / Bet
    socket.on('ACTION_CHAAL', ({ multiplier }) => {
      const tableId = socket.data.tableId;
      const user = socket.data.user;
      const table = this.getTable(tableId);
      if (!table || !user) return;

      const seatIndex = table.seats.findIndex(s => s && s.id === user.id);
      if (seatIndex !== -1) {
        const res = table.handleChaal(seatIndex, multiplier || 1);
        if (!res.success) {
          socket.emit('ERROR', { message: res.error });
        }
      }
    });

    // 6. Player Action: Pack / Fold
    socket.on('ACTION_PACK', () => {
      const tableId = socket.data.tableId;
      const user = socket.data.user;
      const table = this.getTable(tableId);
      if (!table || !user) return;

      const seatIndex = table.seats.findIndex(s => s && s.id === user.id);
      if (seatIndex !== -1) {
        table.handlePack(seatIndex);
      }
    });

    // 7. Player Action: Request Sideshow
    socket.on('ACTION_SIDESHOW', () => {
      const tableId = socket.data.tableId;
      const user = socket.data.user;
      const table = this.getTable(tableId);
      if (!table || !user) return;

      const seatIndex = table.seats.findIndex(s => s && s.id === user.id);
      if (seatIndex !== -1) {
        const res = table.handleRequestSideshow(seatIndex);
        if (!res.success) {
          socket.emit('ERROR', { message: res.error });
        }
      }
    });

    // 8. Player Action: Respond to Sideshow (Accept/Decline)
    socket.on('RESPOND_SIDESHOW', ({ accept }) => {
      const tableId = socket.data.tableId;
      const user = socket.data.user;
      const table = this.getTable(tableId);
      if (!table || !user) return;

      const seatIndex = table.seats.findIndex(s => s && s.id === user.id);
      if (seatIndex !== -1) {
        table.handleSideshowResponse(seatIndex, !!accept);
      }
    });

    // 9. Player Action: Show
    socket.on('ACTION_SHOW', ({ multiplier }) => {
      const tableId = socket.data.tableId;
      const user = socket.data.user;
      const table = this.getTable(tableId);
      if (!table || !user) return;

      const seatIndex = table.seats.findIndex(s => s && s.id === user.id);
      if (seatIndex !== -1) {
        const res = table.handleShow(seatIndex, multiplier || 1);
        if (!res.success) {
          socket.emit('ERROR', { message: res.error });
        }
      }
    });

    // 10. Player Action: Tip Dealer
    socket.on('TIP_DEALER', (payload = {}) => {
      const amount = typeof payload === 'number' ? payload : (payload.amount || 50);
      const tableId = socket.data.tableId || payload.tableId || (this.userTableMap.get(socket.id) && this.userTableMap.get(socket.id).tableId);
      const userId = (socket.data.user && socket.data.user.id) || payload.userId || (this.userTableMap.get(socket.id) && this.userTableMap.get(socket.id).userId);
      const table = this.getTable(tableId);
      const user = userStore.getUserById(userId) || socket.data.user;

      if (!table || !user) {
        socket.emit('ERROR', { message: 'Table or user session not found for tip' });
        return;
      }

      const numTip = Math.max(1, parseInt(amount, 10) || 50);

      // Exclusive 10K VIP Tip: Only 1 player per complete round can send 10K tip
      if (numTip >= 10000) {
        if (table.round10kTipUserId && table.round10kTipUserId !== user.id) {
          socket.emit('ERROR', {
            message: `👑 10K VIP Dealer is exclusive! ${table.round10kTipUserName || 'Another player'} has her by their side this round. You can tip other amounts (₹50 - ₹5,000)!`
          });
          return;
        }
      }

      try {
        const result = userStore.tipDealer(user.id, numTip);
        const seat = table.seats.find(s => s && s.id === user.id);
        user.chips = result.chips;
        if (seat) {
          seat.chips = result.chips;
        }

        // 10K Tip: Exclusive Carnival VIP Queen sits beside this player
        if (result.tipAmount >= 10000) {
          table.record10kTip(user.id, user.username);
          table.vipCompanion = {
            seatIndex: seat ? seat.seatIndex : -1,
            userId: user.id,
            userName: user.username,
            tier: result.luckyTier,
            tipAmount: result.tipAmount,
            companionImage: '/images/dealer_carnival_vip.png'
          };
        }

        this.broadcastTableState(table);
        this.io.to(table.id).emit('TABLE_EVENT', {
          event: 'DEALER_TIPPED',
          data: {
            seatIndex: seat ? seat.seatIndex : -1,
            userId: user.id,
            userName: user.username,
            tipAmount: result.tipAmount,
            luckyTier: result.luckyTier,
            bonusGift: result.bonusGift,
            blessingMessage: result.blessingMessage
          }
        });
        socket.emit('BALANCE_UPDATE', { chips: result.chips });
      } catch (err) {
        socket.emit('ERROR', { message: err.message });
      }
    });

    // 11. Bot controls (Add 1 Bot, Fill All Seats, Clear Bots)
    socket.on('BOT_ADD_ONE', () => {
      const tableId = socket.data.tableId;
      const table = this.getTable(tableId);
      if (table) {
        table.addBot();
      }
    });

    // Fill to table's maxPlayers
    socket.on('BOT_FILL_10', () => {
      const tableId = socket.data.tableId;
      const table = this.getTable(tableId);
      if (table) {
        table.fillWithBots(table.maxPlayers);
      }
    });

    socket.on('BOT_REMOVE_ALL', () => {
      const tableId = socket.data.tableId;
      const table = this.getTable(tableId);
      if (table) {
        table.removeBots();
      }
    });

    // 11. Chat & Emotes
    socket.on('SEND_CHAT', ({ message }) => {
      const tableId = socket.data.tableId;
      const user = socket.data.user;
      if (tableId && user && message) {
        this.io.to(tableId).emit('CHAT_MESSAGE', {
          sender: user.username,
          avatar: user.avatar,
          text: message.slice(0, 80),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      }
    });

    // 12. Leave Table / Exit Room (full disconnect from the table room)
    socket.on('LEAVE_TABLE', () => {
      const tableId = socket.data.tableId;
      const user = socket.data.user;
      if (!tableId || !user) return;

      const table = this.getTable(tableId);
      if (table) {
        const isOwner = (table.ownerId && table.ownerId === user.id);
        const isCustomRoom = (table.isPrivate || !table.id.startsWith('pub_'));

        if (isOwner && isCustomRoom) {
          // Room Owner is leaving: Close table, refund active bets, notify other players
          table.closeTable();
          this.io.to(table.id).emit('ROOM_CLOSED', {
            tableId: table.id,
            tableName: table.name,
            reason: 'OWNER_LEFT',
            ownerName: table.ownerName || user.username || 'Room Owner',
            message: `The room owner (${table.ownerName || user.username || 'Host'}) has left. The table has been closed.`
          });

          // Disconnect all sockets from this room
          const room = this.io.sockets.adapter.rooms.get(table.id);
          if (room) {
            for (const sId of Array.from(room)) {
              const s = this.io.sockets.sockets.get(sId);
              if (s) {
                s.leave(table.id);
                if (s.data) s.data.tableId = null;
                this.userTableMap.delete(sId);
              }
            }
          }
          this.tables.delete(table.id);
          return;
        }

        const seatIdx = table.seats.findIndex(s => s && s.id === user.id);
        if (seatIdx !== -1) {
          table.leaveSeat(seatIdx);
        }
      }
      socket.leave(tableId);
      socket.data.tableId = null;
      this.userTableMap.delete(socket.id);
    });

    // Disconnect
    socket.on('disconnect', () => {
      const info = this.userTableMap.get(socket.id);
      if (info) {
        const table = this.getTable(info.tableId);
        if (table) {
          const isOwner = (table.ownerId && table.ownerId === info.userId);
          const isCustomRoom = (table.isPrivate || !table.id.startsWith('pub_'));

          if (isOwner && isCustomRoom) {
            // Room owner disconnected from custom/private room: close table
            table.closeTable();
            this.io.to(table.id).emit('ROOM_CLOSED', {
              tableId: table.id,
              tableName: table.name,
              reason: 'OWNER_LEFT',
              ownerName: table.ownerName || 'Room Owner',
              message: `The room owner (${table.ownerName || 'Host'}) has disconnected. The table has been closed.`
            });

            const room = this.io.sockets.adapter.rooms.get(table.id);
            if (room) {
              for (const sId of Array.from(room)) {
                const s = this.io.sockets.sockets.get(sId);
                if (s) {
                  s.leave(table.id);
                  if (s.data) s.data.tableId = null;
                  this.userTableMap.delete(sId);
                }
              }
            }
            this.tables.delete(table.id);
          } else {
            const seatIdx = table.seats.findIndex(s => s && s.id === info.userId);
            if (seatIdx !== -1) {
              // Keep seat for a small reconnect grace window, or leave if idle
              if (table.status !== 'PLAYING') {
                table.leaveSeat(seatIdx);
              }
            }
          }
        }
        this.userTableMap.delete(socket.id);
      }
    });
  }
}

module.exports = TableManager;
