const { io } = require('socket.io-client');

async function testFullMultiplayer() {
  console.log('--- STARTING 10-PLAYER TEEN PATTI SOCKET SIMULATION TEST ---');

  const socket1 = io('http://localhost:3001');
  const user1 = { id: 'usr_test1', username: 'Tester1', avatar: 'avatar-1', chips: 1000000 };

  await new Promise((resolve) => {
    socket1.on('connect', () => {
      console.log('✅ Socket 1 connected');
      resolve();
    });
  });

  // 1. Join table
  socket1.emit('JOIN_TABLE', { tableId: 'pub_novice', user: user1 });

  // Wait for initial state
  const state1 = await new Promise(resolve => {
    socket1.once('TABLE_STATE', (state) => {
      console.log(`✅ Received table state for: ${state.tableName}, status: ${state.status}, pot: ${state.pot}`);
      resolve(state);
    });
  });

  // 2. Take seat 0
  socket1.emit('TAKE_SEAT', { seatIndex: 0 });
  await new Promise(r => setTimeout(r, 600));

  // 3. Fill table with bots to 10 players
  console.log('🤖 Triggering BOT_FILL_10 to fill table to 10 players...');
  socket1.emit('BOT_FILL_10');

  // Listen for table state with 10 players
  await new Promise((resolve) => {
    const handler = (state) => {
      const seated = state.seats.filter(s => s !== null);
      console.log(`   Table seated players count: ${seated.length}/10, status: ${state.status}`);
      if (seated.length === 10) {
        console.log('✅ Successfully seated 10 players at the table!');
        socket1.off('TABLE_STATE', handler);
        resolve(state);
      }
    };
    socket1.on('TABLE_STATE', handler);
  });

  // Wait for PLAYING status and card dealing
  console.log('⏳ Waiting for round to start and deal 3 cards...');
  await new Promise((resolve) => {
    const handler = (state) => {
      if (state.status === 'PLAYING') {
        const mySeat = state.seats[0];
        console.log(`✅ Hand started! Pot: ${state.pot}, Current Stake: ${state.currentStake}`);
        console.log(`   Player 1 cards dealt:`, mySeat.cards.length === 3 ? '3 cards dealt' : '0');
        socket1.off('TABLE_STATE', handler);
        resolve(state);
      }
    };
    socket1.on('TABLE_STATE', handler);
  });

  // 4. Test See Cards
  console.log('👀 Player 1 seeing cards...');
  socket1.emit('ACTION_SEE');
  await new Promise(r => setTimeout(r, 800));

  // 5. Test Chaal
  console.log('💰 Player 1 playing Chaal...');
  socket1.emit('ACTION_CHAAL', { multiplier: 2 });
  await new Promise(r => setTimeout(r, 1200));

  console.log('✅ 10-Player simulation completed with success!');
  socket1.disconnect();
  process.exit(0);
}

testFullMultiplayer().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
