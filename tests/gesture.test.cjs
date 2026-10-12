// Checks how the stage follows the fingers (Gesture.js): the trail of
// touchpad events, and that a frame-by-frame stage moves evenly when the
// events don't come once per frame.
// Usage (from the plugin directory): node tests/gesture.test.cjs

const assert = require("node:assert/strict");
const { load, plain } = require("./load.cjs");

const Gesture = load("Gesture.js");
let passed = 0;

// The trail keeps the last few points, timed by the event when it has a time.
{
  let trail = [];
  for (let i = 0; i < 12; i++) trail = plain(Gesture.extendTrail(trail, 1000 + i * 8, 5000 + i * 8, -i * 4));
  assert.equal(trail.length, 8);
  assert.deepEqual(trail[0], { at: 1032, received: 5032, offset: 4000, travel: -16 });
  const untimed = plain(Gesture.extendTrail([], 0, 77, 3));
  assert.deepEqual(untimed, [{ at: 77, received: 77, offset: 0, travel: 3 }], "no event time: when it arrived");
  passed++;
}

// Travel at a moment: in between the points around it, never guessed ahead.
{
  const trail = [
    { at: 100, received: 100, travel: 0 },
    { at: 110, received: 110, travel: 10 },
    { at: 120, received: 120, travel: 30 },
  ];
  assert.equal(Gesture.trailAt(trail, 105), 5);
  assert.equal(Gesture.trailAt(trail, 115), 20);
  assert.equal(Gesture.trailAt(trail, 90), 0, "before the trail: its first point");
  assert.equal(Gesture.trailAt(trail, 200), 30, "after it: its last point");
  assert.equal(Gesture.trailAt([], 50), 0);
  passed++;
}

// The delay is the usual gap between events plus how late deliveries ran,
// at most 12 ms; the trail's clock follows the quickest delivery.
{
  const at = [0, 8, 16, 24, 40, 48];
  let trail = [];
  at.forEach((t, i) => { trail = Gesture.extendTrail(trail, 1000 + t, 9000 + t + (i % 3), t); });
  assert.equal(Gesture.trailDelay(trail), 8 + 2, "8 ms apart, delivered up to 2 ms late");
  assert.equal(Gesture.trailDelay(trail.slice(0, 1)), 0);
  let slow = [];
  for (const t of [1, 31, 61]) slow = Gesture.extendTrail(slow, t, t, t);
  assert.equal(Gesture.trailDelay(slow), 12, "at most 12 ms behind");
  assert.equal(Gesture.trailTime(trail, 9050), 1050, "offset of the quickest delivery");
  passed++;
}

// A steady swipe on a 125 Hz touchpad, delivered 1 to 4 ms after each event,
// shown on a 120 Hz display. Placed at the latest event, the stage moves 0,
// 1 or 2 events' worth from frame to frame; following the trail, it moves
// the same distance every frame, and stays about one event (plus the
// delivery's jitter) behind the fingers.
{
  const speed = -0.6;                       // pixels per ms
  const eventGap = 8;                       // 125 Hz
  const frameGap = 1000 / 120;
  let seed = 7;
  const jitter = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 3;
  const events = [];
  for (let t = 0; t <= 600; t += eventGap) events.push({ at: 50000 + t, received: 900000 + t + 1 + jitter(), travel: speed * t });

  const stepsLatest = [];
  const stepsTrail = [];
  let lastLatest = null;
  let lastTrail = null;
  let worstLag = 0;
  for (let frame = 6; frame * frameGap <= 560; frame++) {
    const now = 900000 + frame * frameGap;
    const arrived = events.filter(e => e.received <= now);
    let trail = [];
    for (const e of arrived) trail = Gesture.extendTrail(trail, e.at, e.received, e.travel);
    const latest = arrived[arrived.length - 1].travel;
    const shown = Gesture.shownTravel(trail, now);
    if (lastLatest !== null) stepsLatest.push(Math.abs(latest - lastLatest));
    if (lastTrail !== null) stepsTrail.push(Math.abs(shown - lastTrail));
    lastLatest = latest;
    lastTrail = shown;
    worstLag = Math.max(worstLag, Math.abs(speed * (frame * frameGap) - shown) / Math.abs(speed));
  }
  const even = Math.abs(speed) * frameGap;
  const spread = steps => Math.max(...steps) - Math.min(...steps);
  assert.ok(spread(stepsLatest) >= even, `at the latest event the steps vary by a whole event or more (${spread(stepsLatest).toFixed(2)} px)`);
  assert.ok(spread(stepsTrail) < even * 0.15, `along the trail every frame moves about the same (${spread(stepsTrail).toFixed(2)} px vs ${even.toFixed(2)})`);
  assert.ok(worstLag <= 1 + 12, `the stage trails the fingers by at most 12 ms more than delivery (${worstLag.toFixed(1)} ms)`);
  passed++;
}

console.log(`gesture: ${passed} checks passed`);
