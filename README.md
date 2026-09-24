# Teen Patti Royale - 10-Player Multiplayer Web Application

A casino-grade, real-time multiplayer **Teen Patti (3 Patti / Indian Poker)** web application built with Node.js, Express, Socket.IO, and vanilla HTML5/CSS3. Adheres 100% to official Teen Patti rules and supports up to **10 players per table**.

![Teen Patti Royale](public/css/style.css)

---

## 🌟 Key Features

1. **User Registration & Wallet**:
   - Instant account creation / login with custom avatar selection.
   - **Default Balance of 10 Lakh (₹10,00,000) chips** automatically credited upon registration.
   - **Free Daily Refill / Bonus (+₹2,00,000)** button when chips run low.

2. **Official Teen Patti Game Rules**:
   - **Ante / Boot Collection**: Automatically gathered into the pot before cards are dealt.
   - **Card Dealing**: 3 cards dealt face-down to each seated active player with rotating dealer puck.
   - **Blind vs. Seen Dynamics**:
     - **Blind**: Bet 1x or 2x current stake (max 4 blind rounds allowed).
     - **Seen**: Tap "SEE CARDS" to inspect hand; bet 2x or 4x current stake.
   - **Actions**:
     - **Chaal**: Bet with dynamic stake multipliers (1x, 2x, 4x).
     - **Pack (Fold)**: Forfeit current round (Key `F`).
     - **Sideshow**: Request secret card comparison against previous seen player with 10s timer to Accept or Decline.
     - **Show**: Enabled when 2 players remain to declare the winner.
   - **Standard Indian Teen Patti Hand Hierarchy**:
     1. **Trail / Trio / Set**: Three of a kind (A-A-A > K-K-K > ... > 2-2-2).
     2. **Pure Sequence / Straight Flush**: Same suit consecutive run (A-2-3 highest, then A-K-Q, down to 4-3-2).
     3. **Sequence / Normal Run**: Mixed suit consecutive run (A-2-3 > A-K-Q down to 4-3-2).
     4. **Color / Flush**: Three cards of same suit.
     5. **Pair**: Two cards of same rank with kicker.
     6. **High Card**: Highest card comparison.

3. **Multiplayer 10-Player Table**:
   - Symmetrical 10-seat radial layout around an emerald felt oval casino table.
   - Dynamic point-of-view perspective rotation (your seat is always placed at the bottom center).
   - Real-time multiplayer synchronization with WebSockets.
   - **AI Bot Integration**: "🤖 Fill 10 Players", "+1 Bot", or "Clear Bots" buttons for instant full-table play.

4. **Table Stakes & Lobby**:
   - **Novice Table**: Boot ₹1,000 | Pot Limit ₹10.24 Lakh
   - **Casual Table**: Boot ₹5,000 | Pot Limit ₹51.2 Lakh
   - **Pro Table**: Boot ₹10,000 | Pot Limit ₹1.02 Crore
   - **High Roller Table**: Boot ₹50,000 | Pot Limit ₹5.12 Crore
   - **VIP Suite Table**: Boot ₹1,00,000 | Pot Limit ₹10.24 Crore
   - **Private Rooms**: Create custom table with 6-digit room code for friends.

5. **Aesthetics & Audio**:
   - Monte Carlo / Macau Royale casino styling with emerald green felt, golden borders, and 3D card flips.
   - Web Audio API procedural sound engine (chips, card slide whoosh, turn alert chime, winner fanfare).

---

## 🚀 Getting Started

### Local Setup
```bash
# 1. Install dependencies
npm install

# 2. Run unit tests for Hand Evaluator
npm test

# 3. Start the server
npm start
# Server will run on http://localhost:3000 (or port 3001 if 3000 is busy)
```

### Docker Setup
```bash
# Build and run containerized with Docker Compose
docker-compose up -d --build

# Open http://localhost:3000 in your browser
```

---

## 📁 Project Structure

```
3pati/
├── Dockerfile                  # Production container definition
├── docker-compose.yml          # Container orchestration
├── package.json
├── test_evaluator.js           # Unit tests for official hand rankings
├── test_multiplayer_game.js    # Automated 10-player socket integration test
├── server/
│   ├── server.js               # Express & Socket.IO HTTP server
│   ├── engine/
│   │   ├── Deck.js             # 52-card standard deck & Fisher-Yates shuffle
│   │   ├── Evaluator.js        # Official Teen Patti hand evaluation engine
│   │   ├── BotPlayer.js        # Realistic AI decision-making
│   │   └── TeenPattiGame.js    # 10-seat table state machine & timers
│   ├── models/
│   │   └── UserStore.js        # User auth, wallet balances & persistence
│   └── sockets/
│       └── gameSocket.js       # Real-time WebSocket room & action handlers
└── public/
    ├── index.html              # 10-player casino table, HUD & modals
    ├── css/
    │   ├── style.css           # Luxury casino table theme & radial seats
    │   └── cards.css           # 3D card flips & chip animations
    ├── js/
    │   ├── api.js              # REST API client
    │   ├── sound.js            # Web Audio procedural sound synthesizer
    │   ├── gameTable.js        # Radial 10-player table renderer
    │   └── app.js              # Client controller & socket events
    └── vendor/
        └── elements.cardmeister.min.js
```
