const { Evaluator } = require('./Evaluator');

const BOT_NAMES = [
  'Vikram Royal', 'Pooja Queen', 'Raj Ace', 'Simran Vegas',
  'Kabir HighRoller', 'Ananya Lucky', 'Arjun Tiger', 'Riya Diamond',
  'Dev Jackpot', 'Kavita Flash'
];

const BOT_AVATARS = [
  'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5',
  'avatar-6', 'avatar-7', 'avatar-8', 'avatar-1'
];

class BotPlayer {
  static createBot(existingNames = []) {
    const availableNames = BOT_NAMES.filter(n => !existingNames.includes(n));
    const name = availableNames.length > 0
      ? availableNames[Math.floor(Math.random() * availableNames.length)]
      : `Bot_${Math.floor(100 + Math.random() * 900)}`;

    const avatar = BOT_AVATARS[Math.floor(Math.random() * BOT_AVATARS.length)];
    
    return {
      id: 'bot_' + Math.random().toString(36).substring(2, 9),
      name: name,
      avatar: avatar,
      chips: 1000000 + Math.floor(Math.random() * 500000), // ~10 - 15 Lakh chips
      isBot: true
    };
  }

  /**
   * Decide action for a bot on its turn
   */
  static decideAction(game, botPlayer) {
    const activePlayers = game.getActivePlayers();
    const canShow = activePlayers.length === 2;
    const canSideshow = game.canRequestSideshow(botPlayer.seatIndex);
    const blindCount = botPlayer.blindCount || 0;

    // Check if opponent is already seen — if so, see cards after 1 turn to enable sideshow duels
    const opponents = activePlayers.filter(p => p.seatIndex !== botPlayer.seatIndex);
    const anyOpponentSeen = opponents.some(p => p.isSeen);

    // 1. If playing blind
    if (!botPlayer.isSeen) {
      // See cards quickly if opponent has seen their cards or after 1-2 blind rounds
      if (blindCount >= 2 || (anyOpponentSeen && blindCount >= 1) || Math.random() < 0.6) {
        return { action: 'see' };
      }

      // If still blind, decide to chaal (blind)
      const multiplier = Math.random() < 0.2 ? 2 : 1;
      return { action: 'chaal', multiplier };
    }

    // 2. If seen cards, evaluate hand strength
    const hand = Evaluator.evaluate(botPlayer.cards);
    const handRank = hand.type; // 6: Trail, 5: Pure Seq, 4: Seq, 3: Color, 2: Pair, 1: High Card

    // Bot sideshow willingness: if eligible, bot will occasionally request sideshow to test/challenge
    if (canSideshow && Math.random() < 0.4) {
      return { action: 'sideshow' };
    }

    // Hand strength strategy — resilient play so user can play full rounds and test sideshow
    switch (handRank) {
      case 6: // Trail - Monster hand!
      case 5: // Pure Sequence
      case 4: // Sequence
      case 3: // Color
        // Always chaal or raise!
        const raiseChance = Math.random() < 0.35 ? 4 : 2;
        return { action: 'chaal', multiplier: raiseChance };

      case 2: // Pair
        // Stay in and play
        return { action: 'chaal', multiplier: 2 };

      case 1: // High Card (bad card)
      default:
        // Bot plays stubbornly for multiple turns so user can test sideshow and showdown
        // Only consider packing if stake is exceptionally huge (>15x boot) and pot is huge
        if (game.currentStake > game.bootAmount * 16 && Math.random() < 0.35) {
          return { action: 'pack' };
        }
        // Otherwise stay in the game and Chaal!
        return { action: 'chaal', multiplier: 2 };
    }
  }

  /**
   * Decide response to a sideshow request
   */
  static decideSideshowResponse(botPlayer) {
    if (!botPlayer.isSeen) return false;
    // Always accept sideshow (90% accept rate) so human player can test sideshow comparison!
    return Math.random() < 0.95;
  }
}

module.exports = BotPlayer;
