const assert = require('node:assert/strict');
const { _test } = require('../server/api/anticheat');

const headers = { White: 'Player', Black: 'Opponent', WhiteElo: '1200', BlackElo: '1250', TimeControl: '600+5', Result: '1-0' };
const base = { isWhite: true, classificationKey: 'BEST', cpLoss: 0, moveUci: 'g1f3', moveSan: 'Nf3', swing: 5,
  alternatives: [{ moveUci: 'g1f3', eval: 22 }, { moveUci: 'b1c3', eval: 8 }, { moveUci: 'd2d4', eval: 2 }], phase: 'opening' };
const results = Array.from({ length: 16 }, (_, index) => ({ ...base, moveIndex: index * 2, isCriticalMoment: index > 11 }));
results.whiteAccuracy = 96; results.blackAccuracy = 72; results.whiteAcpl = 7; results.blackAcpl = 45;
const times = Array.from({ length: 32 }, () => 4);
const metrics = _test.sideMetrics(results, 'white', times, headers);
assert.equal(metrics.rating, 1200);
assert.equal(metrics.timeControl, 'rapid');
assert.equal(metrics.topThreeRate, 100);
assert.equal(metrics.exactBestRate, 100);
assert.equal(metrics.longestExactStreak, 16);
assert.ok(metrics.phaseAccuracy.opening > 90);

const suspicious = _test.scoreMetrics(Array.from({ length: 8 }, (_, index) => ({ ...metrics, accuracy: 95 + (index % 2), win: 1 })));
assert.equal(suspicious.riskLevel, 'High');
assert.equal(suspicious.requiresHumanReview, true);
assert.ok(suspicious.score >= 90, `expected a high evidence score, got ${suspicious.score}`);
assert.ok(suspicious.independentSignals >= 3);
assert.equal(suspicious.modelVersion, 'fairplay-evidence-v2');

const shortSample = _test.scoreMetrics([{ ...metrics, moves: 8 }]);
assert.ok(shortSample.score <= 69);
assert.notEqual(shortSample.riskLevel, 'High');

const strongHuman = _test.scoreMetrics(Array.from({ length: 8 }, () => ({
  ...metrics,
  rating: 2500,
  accuracy: 91,
  acpl: 18,
  exactBestRate: 62,
  topThreeRate: 86,
  criticalExactRate: 58,
  quietBestRate: 18,
  unusualEngineRate: 2,
  fastBestRate: 18,
  fastCriticalRate: 3,
  complexityThinkCorrelation: .35,
  longestExactStreak: 4,
  win: .6,
})));
assert.notEqual(strongHuman.riskLevel, 'High', `ordinary strong play scored ${strongHuman.score}`);
assert.ok(suspicious.score > strongHuman.score + 25);
assert.ok(suspicious.scoreRange[0] <= suspicious.score && suspicious.scoreRange[1] >= suspicious.score);
assert.match(suspicious.explanation, /not a probability or proof/i);
console.log('17 fair-play evidence checks passed.');
