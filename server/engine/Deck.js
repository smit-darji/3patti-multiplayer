/**
 * 52-Card Standard Playing Deck for Teen Patti
 */
class Deck {
  static SUITS = ['♠', '♥', '♦', '♣'];
  static SUIT_NAMES = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
  static SUIT_COLORS = { '♠': 'black', '♥': 'red', '♦': 'red', '♣': 'black' };
  
  static RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  static RANK_VALUES = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };

  constructor() {
    this.cards = [];
    this.reset();
  }

  reset() {
    this.cards = [];
    for (const suit of Deck.SUITS) {
      for (const rank of Deck.RANKS) {
        this.cards.push({
          suit,
          rank,
          value: Deck.RANK_VALUES[rank],
          color: Deck.SUIT_COLORS[suit],
          code: `${rank}${suit}`
        });
      }
    }
  }

  shuffle() {
    // Fisher-Yates shuffle
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    return this;
  }

  deal(count = 3) {
    return this.cards.splice(0, count);
  }

  remaining() {
    return this.cards.length;
  }
}

module.exports = Deck;
