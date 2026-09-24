/**
 * Official Teen Patti Hand Evaluator
 * Hand Rankings (Highest to Lowest):
 * 1. Trail / Trio / Three of a Kind (Set)
 * 2. Pure Sequence / Straight Flush (Pakki Rung) [A-2-3 highest, then A-K-Q, down to 4-3-2]
 * 3. Sequence / Straight (Run) [A-2-3 highest, then A-K-Q, down to 4-3-2]
 * 4. Color / Flush (Rung)
 * 5. Pair (Double)
 * 6. High Card
 */

const HAND_TYPES = {
  TRAIL: { id: 6, name: 'Trail (Trio)', desc: 'Three of a kind' },
  PURE_SEQUENCE: { id: 5, name: 'Pure Sequence', desc: 'Straight Flush' },
  SEQUENCE: { id: 4, name: 'Sequence', desc: 'Normal Run' },
  COLOR: { id: 3, name: 'Color', desc: 'Flush' },
  PAIR: { id: 2, name: 'Pair', desc: 'Two of a kind' },
  HIGH_CARD: { id: 1, name: 'High Card', desc: 'Highest card' }
};

class Evaluator {
  /**
   * Evaluates a 3-card hand and returns its classification, score, and breakdown
   * @param {Array} cards - Array of 3 card objects { rank, suit, value }
   */
  static evaluate(cards) {
    if (!cards || cards.length !== 3) {
      throw new Error('Hand must contain exactly 3 cards');
    }

    // Sort cards descending by value
    const sorted = [...cards].sort((a, b) => b.value - a.value);
    const [c1, c2, c3] = sorted;
    const v1 = c1.value, v2 = c2.value, v3 = c3.value;
    const isFlush = c1.suit === c2.suit && c2.suit === c3.suit;

    // Check Trail / Trio
    if (v1 === v2 && v2 === v3) {
      return {
        type: HAND_TYPES.TRAIL.id,
        typeName: HAND_TYPES.TRAIL.name,
        description: `Trail of ${c1.rank}'s`,
        rankValue: v1,
        tieBreakers: [v1],
        cards: sorted
      };
    }

    // Check Sequence (A-2-3 special rule or consecutive)
    const seqRank = this.getSequenceRank(v1, v2, v3);
    const isSeq = seqRank > 0;

    // Pure Sequence (Straight Flush)
    if (isSeq && isFlush) {
      return {
        type: HAND_TYPES.PURE_SEQUENCE.id,
        typeName: HAND_TYPES.PURE_SEQUENCE.name,
        description: `Pure Sequence ${this.getSequenceLabel(v1, v2, v3, c1.suit)}`,
        rankValue: seqRank,
        tieBreakers: [seqRank],
        cards: sorted
      };
    }

    // Sequence (Normal Run)
    if (isSeq) {
      return {
        type: HAND_TYPES.SEQUENCE.id,
        typeName: HAND_TYPES.SEQUENCE.name,
        description: `Sequence ${this.getSequenceLabel(v1, v2, v3)}`,
        rankValue: seqRank,
        tieBreakers: [seqRank],
        cards: sorted
      };
    }

    // Color (Flush)
    if (isFlush) {
      return {
        type: HAND_TYPES.COLOR.id,
        typeName: HAND_TYPES.COLOR.name,
        description: `Color ${c1.rank}-${c2.rank}-${c3.rank} of ${c1.suit}`,
        rankValue: v1,
        tieBreakers: [v1, v2, v3],
        cards: sorted
      };
    }

    // Pair
    if (v1 === v2 || v2 === v3 || v1 === v3) {
      let pairVal, kickerVal, pairRank;
      if (v1 === v2) {
        pairVal = v1; kickerVal = v3; pairRank = c1.rank;
      } else if (v2 === v3) {
        pairVal = v2; kickerVal = v1; pairRank = c2.rank;
      } else {
        pairVal = v1; kickerVal = v2; pairRank = c1.rank;
      }
      return {
        type: HAND_TYPES.PAIR.id,
        typeName: HAND_TYPES.PAIR.name,
        description: `Pair of ${pairRank}'s with ${sorted.find(c => c.value === kickerVal).rank} kicker`,
        rankValue: pairVal,
        tieBreakers: [pairVal, kickerVal],
        cards: sorted
      };
    }

    // High Card
    return {
      type: HAND_TYPES.HIGH_CARD.id,
      typeName: HAND_TYPES.HIGH_CARD.name,
      description: `High Card ${c1.rank} (${c1.rank}-${c2.rank}-${c3.rank})`,
      rankValue: v1,
      tieBreakers: [v1, v2, v3],
      cards: sorted
    };
  }

  /**
   * Calculates sequence rank.
   * In Teen Patti, A-2-3 is highest sequence (rank 15),
   * followed by A-K-Q (rank 14), K-Q-J (13), ..., 4-3-2 (rank 4).
   * Returns 0 if not a sequence.
   */
  static getSequenceRank(v1, v2, v3) {
    // Normal consecutive: e.g. 14, 13, 12 (A-K-Q) or 5, 4, 3
    if (v1 - v2 === 1 && v2 - v3 === 1) {
      return v1; // 14 for A-K-Q down to 4 for 4-3-2
    }
    // A-2-3: v1 = 14, v2 = 3, v3 = 2
    if (v1 === 14 && v2 === 3 && v3 === 2) {
      return 15; // Highest sequence in Teen Patti!
    }
    return 0;
  }

  static getSequenceLabel(v1, v2, v3, suit = '') {
    if (v1 === 14 && v2 === 3 && v3 === 2) {
      return `A-2-3${suit ? ' ' + suit : ''}`;
    }
    const rankMap = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
    const r1 = rankMap[v1] || v1;
    const r2 = rankMap[v2] || v2;
    const r3 = rankMap[v3] || v3;
    return `${r1}-${r2}-${r3}${suit ? ' ' + suit : ''}`;
  }

  /**
   * Evaluates hand accounting for game variations (Classic, Muflis, AK47)
   */
  static evaluateWithVariation(cards, variation = 'classic') {
    if (variation === 'ak47') {
      return this.evaluateAK47(cards);
    }
    const standard = this.evaluate(cards);
    if (variation === 'muflis') {
      return {
        ...standard,
        isMuflis: true,
        description: `${standard.description} [Muflis: Lowest Wins]`
      };
    }
    return standard;
  }

  /**
   * AK47 Variation: A, K, 4, and 7 are Wild Jokers!
   */
  static evaluateAK47(cards) {
    const jokers = cards.filter(c => ['A', 'K', '4', '7'].includes(c.rank));
    if (jokers.length === 0) {
      return this.evaluate(cards);
    }

    if (jokers.length >= 2) {
      // 2 or 3 jokers easily make Trail of Aces!
      return {
        type: HAND_TYPES.TRAIL.id,
        typeName: 'Trail (Trio)',
        description: 'Trail of A\'s (AK47 Joker)',
        rankValue: 14,
        tieBreakers: [14],
        cards: cards,
        isJokerHand: true
      };
    }

    // 1 Joker: matches the best non-joker card to make a Trail or best combination
    const nonJokers = cards.filter(c => !['A', 'K', '4', '7'].includes(c.rank));
    if (nonJokers.length === 2) {
      const sorted = [...nonJokers].sort((a, b) => b.value - a.value);
      // If pair of non-jokers, joker makes trio!
      if (sorted[0].value === sorted[1].value) {
        return {
          type: HAND_TYPES.TRAIL.id,
          typeName: 'Trail (Trio)',
          description: `Trail of ${sorted[0].rank}'s (AK47 Joker)`,
          rankValue: sorted[0].value,
          tieBreakers: [sorted[0].value],
          cards: cards,
          isJokerHand: true
        };
      }
      // Otherwise joker pairs with highest card
      return {
        type: HAND_TYPES.PAIR.id,
        typeName: 'Pair',
        description: `Pair of ${sorted[0].rank}'s (AK47 Joker)`,
        rankValue: sorted[0].value,
        tieBreakers: [sorted[0].value, sorted[1].value],
        cards: cards,
        isJokerHand: true
      };
    }

    return this.evaluate(cards);
  }

  /**
   * Compares two hands with game variation support.
   */
  static compareHands(cardsA, cardsB, variation = 'classic') {
    const evalA = this.evaluateWithVariation(cardsA, variation);
    const evalB = this.evaluateWithVariation(cardsB, variation);

    let cmp = 0;
    // Primary: Hand Type
    if (evalA.type !== evalB.type) {
      cmp = evalA.type - evalB.type;
    } else {
      // Tie Breakers within same type
      for (let i = 0; i < evalA.tieBreakers.length; i++) {
        const tbA = evalA.tieBreakers[i];
        const tbB = evalB.tieBreakers[i];
        if (tbA !== tbB) {
          cmp = tbA - tbB;
          break;
        }
      }
    }

    // In Muflis mode, the lowest hand wins!
    if (variation === 'muflis') {
      return -cmp;
    }

    return cmp;
  }

  /**
   * Determine winning players among an array of players with hands.
   */
  static getWinners(playersWithHands, variation = 'classic') {
    if (!playersWithHands || playersWithHands.length === 0) return [];
    if (playersWithHands.length === 1) return [playersWithHands[0]];

    let winners = [playersWithHands[0]];

    for (let i = 1; i < playersWithHands.length; i++) {
      const contestant = playersWithHands[i];
      const comparison = this.compareHands(contestant.cards, winners[0].cards, variation);

      if (comparison > 0) {
        winners = [contestant];
      } else if (comparison === 0) {
        winners.push(contestant);
      }
    }

    return winners;
  }
}

module.exports = { Evaluator, HAND_TYPES };
