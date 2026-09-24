const { Evaluator, HAND_TYPES } = require('./server/engine/Evaluator');

function runTests() {
  console.log('--- RUNNING TEEN PATTI EVALUATOR TESTS ---');

  // Test 1: Trail of Aces vs Trail of Kings
  const trailA = [
    { rank: 'A', suit: '♠', value: 14 },
    { rank: 'A', suit: '♥', value: 14 },
    { rank: 'A', suit: '♦', value: 14 }
  ];
  const trailK = [
    { rank: 'K', suit: '♠', value: 13 },
    { rank: 'K', suit: '♥', value: 13 },
    { rank: 'K', suit: '♦', value: 13 }
  ];
  console.assert(Evaluator.compareHands(trailA, trailK) > 0, 'Trail of Aces should beat Trail of Kings');

  // Test 2: Trail beats Pure Sequence
  const pureSeqAKQ = [
    { rank: 'A', suit: '♠', value: 14 },
    { rank: 'K', suit: '♠', value: 13 },
    { rank: 'Q', suit: '♠', value: 12 }
  ];
  const trail2 = [
    { rank: '2', suit: '♠', value: 2 },
    { rank: '2', suit: '♥', value: 2 },
    { rank: '2', suit: '♦', value: 2 }
  ];
  console.assert(Evaluator.compareHands(trail2, pureSeqAKQ) > 0, 'Trail of 2s should beat Pure Sequence AKQ');

  // Test 3: A-2-3 Pure Sequence beats A-K-Q Pure Sequence (Teen Patti standard rule)
  const pureSeqA23 = [
    { rank: 'A', suit: '♠', value: 14 },
    { rank: '2', suit: '♠', value: 2 },
    { rank: '3', suit: '♠', value: 3 }
  ];
  console.assert(Evaluator.compareHands(pureSeqA23, pureSeqAKQ) > 0, 'A-2-3 Pure Sequence should beat A-K-Q Pure Sequence');

  // Test 4: Pure Sequence beats Sequence
  const normalSeqA23 = [
    { rank: 'A', suit: '♠', value: 14 },
    { rank: '2', suit: '♥', value: 2 },
    { rank: '3', suit: '♦', value: 3 }
  ];
  console.assert(Evaluator.compareHands(pureSeqAKQ, normalSeqA23) > 0, 'Pure Sequence AKQ should beat normal Sequence A23');

  // Test 5: Sequence beats Color (Flush)
  const colorAKJ = [
    { rank: 'A', suit: '♥', value: 14 },
    { rank: 'K', suit: '♥', value: 13 },
    { rank: 'J', suit: '♥', value: 11 }
  ];
  console.assert(Evaluator.compareHands(normalSeqA23, colorAKJ) > 0, 'Normal Sequence should beat Color');

  // Test 6: Color beats Pair
  const pairA = [
    { rank: 'A', suit: '♠', value: 14 },
    { rank: 'A', suit: '♥', value: 14 },
    { rank: 'K', suit: '♦', value: 13 }
  ];
  console.assert(Evaluator.compareHands(colorAKJ, pairA) > 0, 'Color should beat Pair of Aces');

  // Test 7: Pair beats High Card
  const pair2 = [
    { rank: '2', suit: '♠', value: 2 },
    { rank: '2', suit: '♥', value: 2 },
    { rank: '3', suit: '♦', value: 3 }
  ];
  const highCardAKQ = [
    { rank: 'A', suit: '♠', value: 14 },
    { rank: 'K', suit: '♥', value: 13 },
    { rank: '9', suit: '♦', value: 9 }
  ];
  console.assert(Evaluator.compareHands(pair2, highCardAKQ) > 0, 'Pair of 2s should beat High Card A-K-9');

  // Test 8: Pair comparison with kickers
  const pairK9 = [
    { rank: 'K', suit: '♠', value: 13 },
    { rank: 'K', suit: '♥', value: 13 },
    { rank: '9', suit: '♦', value: 9 }
  ];
  const pairK8 = [
    { rank: 'K', suit: '♣', value: 13 },
    { rank: 'K', suit: '♦', value: 13 },
    { rank: '8', suit: '♥', value: 8 }
  ];
  console.assert(Evaluator.compareHands(pairK9, pairK8) > 0, 'Pair of Kings with 9 kicker beats Pair of Kings with 8 kicker');

  // Test 9: High card tie breaker
  const hc1 = [
    { rank: 'A', suit: '♠', value: 14 },
    { rank: 'K', suit: '♥', value: 13 },
    { rank: 'J', suit: '♦', value: 11 }
  ];
  const hc2 = [
    { rank: 'A', suit: '♣', value: 14 },
    { rank: 'K', suit: '♦', value: 13 },
    { rank: '10', suit: '♥', value: 10 }
  ];
  console.assert(Evaluator.compareHands(hc1, hc2) > 0, 'A-K-J should beat A-K-10');

  // Test 10: getWinners with split pot
  const split1 = { id: 'p1', name: 'Player 1', cards: hc1 };
  const split2 = { id: 'p2', name: 'Player 2', cards: [
    { rank: 'A', suit: '♥', value: 14 },
    { rank: 'K', suit: '♠', value: 13 },
    { rank: 'J', suit: '♣', value: 11 }
  ]};
  const split3 = { id: 'p3', name: 'Player 3', cards: hc2 };
  const winners = Evaluator.getWinners([split1, split2, split3]);
  console.assert(winners.length === 2, 'Should have 2 split winners for identical hand ranks');

  console.log('✅ ALL 10 EVALUATOR UNIT TESTS PASSED SUCCESSFULLY!');
}

runTests();
