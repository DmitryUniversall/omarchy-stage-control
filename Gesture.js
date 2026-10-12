// Gesture.js - following the fingers frame by frame.
//
// Touchpad events come at the touchpad's own rate (often 100 to 140 a
// second) and unevenly (through Lua, Hyprland's event socket and the shell),
// not once per frame of the display. Placing the stage at each event moved
// it two steps in some frames and none in others. Instead the events leave
// a trail of where the fingers were and when, and once a frame the stage
// goes where the fingers were a moment before: in between two events, so it
// moves evenly, at the cost of that moment (about one event apart).
//
// Times are in milliseconds. A trail point is { at, received, offset,
// travel }: `at` is the event's own time when it has one (the touchpad's
// clock, free of the delivery's jitter), else when it arrived; `received` is
// when it arrived, on the clock the frames are timed by; `offset` is the
// difference between the two clocks so far (see trailTime).
//
// Pure functions shared by Service.qml and tests/gesture.test.cjs.

var TRAIL_LENGTH = 8      // points kept
var MAX_DELAY = 12        // ms the stage may trail the fingers

// The trail with one more point, keeping the last TRAIL_LENGTH.
function extendTrail(trail, at, received, travel) {
  var last = trail && trail.length ? trail[trail.length - 1] : null
  var time = at > 0 ? at : received
  // The event that reached us quickest in the whole swipe shows the offset
  // between the clocks best; keeping it steady keeps the frames even.
  var offset = last ? Math.min(last.offset, received - time) : received - time
  var next = (trail || []).slice(-(TRAIL_LENGTH - 1))
  next.push({ at: time, received: received, offset: offset, travel: travel })
  return next
}

// The trail's clock at `received` on the frames' clock.
function trailTime(trail, received) {
  if (!trail || trail.length === 0) return received
  return received - trail[trail.length - 1].offset
}

// How far behind the fingers to show the stage: the usual time between
// recent events, plus how much later than the quickest they have arrived,
// so the next event has usually arrived by the moment shown. At most
// MAX_DELAY.
function trailDelay(trail) {
  if (!trail || trail.length < 2) return 0
  var gaps = []
  var late = 0
  for (var i = 1; i < trail.length; i++) {
    gaps.push(trail[i].at - trail[i - 1].at)
    late = Math.max(late, trail[i].received - trail[i].at - trail[trail.length - 1].offset)
  }
  gaps.sort(function(a, b) { return a - b })
  return Math.max(0, Math.min(MAX_DELAY, gaps[Math.floor(gaps.length / 2)] + late))
}

// The fingers' travel at `time` on the trail's clock: between the points
// around it, the first point's before them all and the last point's after
// (never guessed ahead).
function trailAt(trail, time) {
  if (!trail || trail.length === 0) return 0
  if (time <= trail[0].at) return trail[0].travel
  for (var i = 1; i < trail.length; i++) {
    var b = trail[i]
    if (time > b.at) continue
    var a = trail[i - 1]
    var span = b.at - a.at
    return span > 0 ? a.travel + (b.travel - a.travel) * (time - a.at) / span : b.travel
  }
  return trail[trail.length - 1].travel
}

// The travel to show on a frame drawn at `now` (the frames' clock).
function shownTravel(trail, now) {
  return trailAt(trail, trailTime(trail, now) - trailDelay(trail))
}
