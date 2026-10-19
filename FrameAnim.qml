import QtQuick

// A NumberAnimation that steps once per frame the stage draws (Service,
// "frames") rather than on Qt's animation timer: with the shell's other
// windows up, that timer ticks 8 ms apart against the display's 8.33, and a
// desktop sliding across the screen moved two steps on some frames and none
// on others. Used like a NumberAnimation: target, propertyName, from, to,
// duration, easing (Easing.OutCubic, Easing.InOutCubic or Easing.Linear),
// start(), stop(), restart(), running, currentTime and finished(). It
// starts from `from`, so set it (to the property's value) before start().
QtObject {
  id: anim

  property var service: null
  property QtObject target: null
  property string propertyName: ""
  property real from: 0
  property real to: 0
  property real duration: 250
  property int easing: Easing.OutCubic

  property bool running: false
  property real currentTime: 0        // ms into it
  property real startedAt: 0          // Date.now() when it started
  signal finished()

  function start() {
    currentTime = 0
    startedAt = Date.now()
    running = true
    apply(0)
    // No stage to time it: straight to the end.
    if (!service) {
      advance(startedAt, duration, duration)
      return
    }
    service.addFrameAnim(anim)
  }

  function stop() {
    if (!running) return
    running = false
    if (service) service.removeFrameAnim(anim)
  }

  function restart() {
    stop()
    start()
  }

  // A frame on, by `step` ms (Service.stepFrames), never well ahead of the
  // clock.
  function advance(now, step, frameMs) {
    if (!running) return
    currentTime = Math.max(currentTime, Math.min(currentTime + step, now - startedAt + 2 * frameMs))
    var t = duration > 0 ? Math.min(1, currentTime / duration) : 1
    apply(t)
    if (t >= 1) {
      stop()
      finished()
    }
  }

  function apply(t) {
    var eased = easing === Easing.Linear ? t
      : easing === Easing.InOutCubic ? (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2)
      : 1 - Math.pow(1 - t, 3)
    if (target && propertyName !== "") target[propertyName] = from + (to - from) * eased
  }

  Component.onDestruction: stop()
}
