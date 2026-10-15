import QtQuick
import Quickshell
import "Layout.js" as Layout

// The Spaces bar along the top of the stage. Like macOS it shows the
// desktops' names and expands into thumbnails when the pointer comes up to it
// or a window is dragged toward it; or, as you set it, always shows the
// thumbnails, with or without the names under them. The "+" on the right
// adds a desktop; drop a window on it to put the window on a new desktop.
// Right-click a desktop to rename it. When the desktops don't all fit, the
// row scrolls: with the wheel or two fingers over the bar, and by itself
// toward the end a window is dragged to.
Item {
  id: bar

  property var overview: null

  readonly property var service: overview ? overview.service : null
  readonly property var monitor: overview ? overview.monitor : null
  readonly property var settings: service && service.settings ? service.settings : ({})
  readonly property real p: service ? service.progress : 0
  readonly property real e: settings.reduceMotion ? 1 : p
  readonly property int count: overview ? overview.desktopIds.length : 0

  // "auto" (names, thumbnails on hover), "expanded" (thumbnails and names)
  // or "thumbnails" (thumbnails, a name only while pointed at or renamed).
  readonly property string mode: settings.spacesBar || "auto"
  readonly property bool namesHidden: mode === "thumbnails"

  // Sized so every desktop and the "+" fit on the screen, down to a
  // smallest size; past that the row scrolls (Layout.spacesBar).
  readonly property var metrics: Layout.spacesBar(width, count, monitor ? monitor.h / Math.max(1, monitor.w) : 0.625)
  readonly property real thumbW: metrics.thumbW
  readonly property real thumbH: metrics.thumbH
  // The most a desktop's name may take while the bar is collapsed.
  readonly property real collapsedSlot: metrics.collapsedSlot
  readonly property real labelH: 24
  // Under each thumbnail: its name, unless names are hidden.
  readonly property real labelSpace: namesHidden ? 0 : 10 + labelH
  readonly property real inset: 14
  readonly property real collapsedHeight: inset + labelH + 16
  readonly property real expandedHeight: inset + thumbH + labelSpace + 18

  readonly property bool expanded: mode !== "auto" || hover.hovered
    || (!!overview && (overview.dragging || overview.forceExpanded)) || draggingDesktop !== 0
    || renamingDesktop !== 0
  property real expand: expanded ? 1 : 0
  Behavior on expand { NumberAnimation { duration: 280; easing.type: Easing.OutCubic } }

  // The space the spread must leave free (the target, not the animation).
  readonly property real reservedHeight: expanded ? expandedHeight : collapsedHeight

  // Between the screen's edges that stay uncovered (Overview.edges): with the
  // top bar kept, the Spaces bar slides out from under it.
  readonly property var edges: overview ? overview.edges : ({ top: 0, left: 0, right: 0, bottom: 0 })
  x: edges.left
  width: overview ? overview.stageWidth - edges.left - edges.right : 0
  height: collapsedHeight + (expandedHeight - collapsedHeight) * expand
  // Slides down from the top edge as the stage opens. Drawn while the stage
  // prepares, so its glass is ready by the first frame (Overview.preparing).
  y: edges.top - Math.round(height * 0.7 * (1 - e))
  opacity: overview && overview.preparing ? 0.5 : e

  HoverHandler {
    id: hover
    enabled: !!bar.service && bar.service.interactive
  }

  // ---- desktops ---------------------------------------------------------------

  property var thumbs: ({})

  function registerThumb(id, item) { thumbs[id] = item }
  function unregisterThumb(id, item) { if (thumbs[id] === item) delete thumbs[id] }

  // The room the desktops have: between the margins, clear of the "+" on
  // the right as the bar opens.
  readonly property real viewLeft: metrics.margin
  readonly property real viewWidth: Math.max(0, width - 2 * metrics.margin - (addButton.width + metrics.addGap) * expand)
  readonly property bool scrolls: row.width > viewWidth + 0.5

  Item {
    id: viewport
    // A little past the margins, for a desktop's × and its hover zoom.
    readonly property real pad: 14
    x: bar.viewLeft - pad
    width: bar.viewWidth + 2 * pad
    // Tall enough for the thumbnails' shadows.
    height: bar.height + 40
    // Clipped only while it scrolls, so a row that fits draws as before.
    clip: bar.scrolls

    Row {
      id: row
      // Centered, but clear of the screen's edges and, as the bar opens, of
      // the "+" on the right. Scrolled when it doesn't fit.
      x: Math.round(viewport.pad + (bar.scrolls
        ? Layout.scrolledOffset(width, bar.viewWidth, bar.scrollFraction)
        : Math.max(0, Math.min((bar.width - width) / 2 - bar.viewLeft, bar.viewWidth - width))))
      y: bar.inset
      spacing: Math.round(bar.metrics.collapsedSpacing + (bar.metrics.spacing - bar.metrics.collapsedSpacing) * bar.expand)

      Repeater {
        model: ScriptModel { values: bar.overview ? bar.overview.desktopIds : [] }
        delegate: DesktopThumb { strip: bar }
      }
    }
  }

  // ---- scrolling --------------------------------------------------------------
  //
  // How far along the row is scrolled, from 0 (its left end) to 1 (its right
  // end): a fraction rather than pixels, so the same desktops stay in view
  // while the bar expands and collapses.

  property real scrollTarget: 0
  property bool animateScroll: false
  property real scrollFraction: scrollTarget
  Behavior on scrollFraction {
    enabled: bar.animateScroll
    NumberAnimation { duration: 240; easing.type: Easing.OutCubic }
  }

  function scrollBy(pixels, animated) {
    var over = row.width - viewWidth
    if (over <= 0) return
    animateScroll = animated === true
    scrollTarget = Math.max(0, Math.min(1, scrollTarget + pixels / over))
  }

  // Brings a desktop to the middle of the bar, as far as the row allows.
  function showDesktop(id, animated) {
    var thumb = thumbs[id]
    if (!thumb) return
    // Desktops just added may not be in place yet.
    row.forceLayout()
    animateScroll = animated === true
    scrollTarget = Layout.fractionToShow(row.width, viewWidth, thumb.x, thumb.x + thumb.width)
  }

  // Whether `point` in `item`'s coordinates lies where the bar shows its
  // desktops: a desktop scrolled out of view takes no pointer.
  function inView(item, point) {
    if (!scrolls) return true
    var at = item.mapToItem(viewport, point.x, point.y)
    return at.x >= viewport.pad && at.x <= viewport.pad + viewWidth
  }

  WheelHandler {
    target: null
    enabled: bar.scrolls && !!bar.service && bar.service.interactive
    acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
    onWheel: function(event) {
      var px = event.pixelDelta
      if (px.x !== 0 || px.y !== 0) {
        // Two fingers: the row follows them, either way they move.
        bar.scrollBy(-(Math.abs(px.x) > Math.abs(px.y) ? px.x : px.y), false)
      } else {
        var steps = (Math.abs(event.angleDelta.x) > Math.abs(event.angleDelta.y) ? event.angleDelta.x : event.angleDelta.y) / 120
        bar.scrollBy(-steps * Math.max(bar.thumbW, bar.collapsedSlot) * 0.75, true)
      }
    }
  }

  // The desktop on screen is in view when the stage opens.
  Connections {
    target: bar.overview
    function onShowsHereChanged() {
      if (bar.overview.showsHere) Qt.callLater(bar.showActive, false)
    }
  }
  function showActive(animated) {
    if (monitor) showDesktop(monitor.activeWorkspace, animated)
  }
  property int shownActive: monitor ? monitor.activeWorkspace : 0
  onShownActiveChanged: if (scrolls) Qt.callLater(showActive, true)
  // A desktop just added is the last one, next to the "+". (Not one that
  // came with the stage opening: that shows the desktop on screen.)
  property int lastCount: 0
  onCountChanged: {
    var added = count > lastCount && lastCount > 0 && !!overview && overview.showsHere
    lastCount = count
    if (added && scrolls) {
      animateScroll = true
      scrollTarget = 1
    }
  }

  // Dragging a window toward either end of a row that doesn't fit scrolls
  // it, the faster the nearer the edge.
  FrameAnimation {
    running: bar.scrolls && !!bar.overview && bar.overview.dragging
    onTriggered: {
      var at = bar.mapFromItem(bar.overview.stage, bar.overview.dragPoint.x, bar.overview.dragPoint.y)
      if (at.y < 0 || at.y > bar.height + 40) return
      var edge = 80
      var left = at.x - bar.viewLeft
      var right = bar.viewLeft + bar.viewWidth - at.x
      var speed = left < edge ? -(edge - Math.max(0, left)) / edge
        : right < edge ? (edge - Math.max(0, right)) / edge : 0
      if (speed === 0) return
      bar.scrollBy(speed * 1100 * frameTime, false)
      // What the window would land on moved under it.
      bar.overview.moveDrag(bar.overview.dragPoint)
    }
  }

  // ---- previews -----------------------------------------------------------------
  //
  // Each desktop's thumbnail starts a capture of every window on it. Once the
  // stage has opened they start one desktop a frame, the one on screen first
  // and then outward, rather than all on the frame the stage settles.
  // Pointing at the bar starts any that are left at once.

  readonly property var previewOrder: {
    var ids = overview ? overview.desktopIds : []
    var at = Math.max(0, ids.indexOf(monitor ? monitor.activeWorkspace : 0))
    var order = []
    for (var k = 0; order.length < ids.length; k++) {
      if (at + k < ids.length) order.push(ids[at + k])
      if (k > 0 && at - k >= 0) order.push(ids[at - k])
    }
    return order
  }
  property int previewTurns: 0

  function previewRank(id) {
    var rank = previewOrder.indexOf(id)
    return rank < 0 ? count : rank
  }

  // Only for this display's own stage: `settled` is the service's, so it's
  // also true while App Exposé is open on another display.
  FrameAnimation {
    running: !!bar.overview && bar.overview.showsHere && bar.overview.mission && bar.overview.settled
      && bar.previewTurns < bar.count
    onTriggered: bar.previewTurns++
  }

  Connections {
    target: bar.overview
    function onShowsHereChanged() { if (!bar.overview.showsHere) bar.previewTurns = 0 }
    function onMissionChanged() { if (!bar.overview.mission) bar.previewTurns = 0 }
  }

  // ---- reordering desktops ------------------------------------------------------

  property int draggingDesktop: 0
  property real desktopDragStart: 0
  property real desktopDragOffset: 0
  property int reorderTargetId: 0

  function beginDesktopDrag(id, x) {
    draggingDesktop = id
    desktopDragStart = x
    desktopDragOffset = 0
    reorderTargetId = 0
  }

  function moveDesktopDrag(x) {
    desktopDragOffset = x - desktopDragStart
    var dragged = thumbs[draggingDesktop]
    if (!dragged) return
    // Every desktop's center where the row puts it, and the dragged one's
    // moved by the drag. From the row, not the items: the dragged item's
    // Translate already holds the drag, so mapping it would count it twice.
    var slots = []
    for (var id in thumbs) {
      var item = thumbs[id]
      slots.push({ id: Number(id), center: row.mapToItem(bar, item.x + item.width / 2, 0).x })
    }
    var center = row.mapToItem(bar, dragged.x + dragged.width / 2, 0).x + desktopDragOffset
    var target = Layout.nearestSlot(slots, center)
    reorderTargetId = target && target !== draggingDesktop ? target : 0
  }

  function endDesktopDrag() {
    var from = draggingDesktop
    var to = reorderTargetId
    cancelDesktopDrag()
    if (from && to && from !== to) service.reorderDesktop(overview.screenName, from, to)
  }

  function cancelDesktopDrag() {
    draggingDesktop = 0
    desktopDragOffset = 0
    reorderTargetId = 0
  }

  // ---- renaming desktops ----------------------------------------------------------
  //
  // The desktop being renamed edits its name in place (DesktopThumb). Enter
  // keeps the name, Esc cancels, and a click anywhere else keeps it too: the
  // overview catches that click (Overview.qml) and calls commitRename().

  property int renamingDesktop: 0

  function beginRename(id) {
    if (!service || !service.interactive || renamingDesktop !== 0) return
    cancelDesktopDrag()
    renamingDesktop = id
  }

  // `name` null cancels; "" goes back to the default name.
  function endRename(id, name) {
    if (renamingDesktop !== id) return
    renamingDesktop = 0
    if (name !== null) service.renameDesktop(id, name)
    if (overview) overview.focusKeys()
  }

  function commitRename() {
    if (renamingDesktop === 0) return
    var thumb = thumbs[renamingDesktop]
    if (thumb) thumb.commitRename()
    else endRename(renamingDesktop, null)
  }

  // ---- adding desktops ----------------------------------------------------------

  Glass {
    id: addButton
    readonly property bool dropTarget: !!bar.overview && !!bar.overview.dropTarget && bar.overview.dropTarget.kind === "new"
    width: bar.metrics.add
    height: width
    radius: 12
    x: bar.width - width - bar.metrics.margin
    y: bar.inset + Math.round((bar.thumbH - height) / 2)
    style: bar.overview ? bar.overview.glassStyle : "liquid"
    backdrop: bar.overview ? bar.overview.glassBackdrop : null
    backdropIsWindow: true
    hovered: addMouse.containsMouse
    selected: dropTarget
    selectedColor: bar.overview ? bar.overview.highlight : "#0a84ff"
    opacity: bar.expand
    visible: opacity > 0.01
    scale: dropTarget ? 1.12 : addMouse.containsMouse ? 1.06 : 1
    Behavior on scale { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }

    Text {
      anchors.centerIn: parent
      anchors.verticalCenterOffset: -2
      text: "+"
      textFormat: Text.PlainText
      color: "white"
      font.pixelSize: Math.round(parent.height * 0.6)
      font.weight: Font.Light
      font.family: bar.overview ? bar.overview.uiFont : ""
    }

    MouseArea {
      id: addMouse
      anchors.fill: parent
      hoverEnabled: true
      enabled: !!bar.service && bar.service.interactive && addButton.visible && bar.renamingDesktop === 0
      cursorShape: Qt.PointingHandCursor
      onClicked: bar.service.addDesktop(bar.overview.screenName)
    }
  }

  // ---- drops ----------------------------------------------------------------------

  // What a window dropped at `point` (overview coordinates) lands on.
  function targetAt(point) {
    if (expand < 0.5) return null
    var add = addButton.mapToItem(overview.stage, 0, 0)
    var pad = 10
    if (point.x >= add.x - pad && point.x <= add.x + addButton.width + pad
        && point.y >= add.y - pad && point.y <= add.y + addButton.height + pad)
      return { kind: "new" }
    // Not on a desktop scrolled out of view.
    if (!inView(overview.stage, point)) return null
    for (var id in thumbs) {
      var rect = thumbs[id].pictureRect()
      if (point.x >= rect.x - pad && point.x <= rect.x + rect.w + pad
          && point.y >= rect.y - pad && point.y <= rect.y + rect.h + pad)
        return { kind: "desktop", id: Number(id) }
    }
    return null
  }

  function rectFor(target) {
    if (!target) return null
    if (target.kind === "new") {
      var add = addButton.mapToItem(overview.stage, 0, 0)
      return { x: add.x, y: add.y, w: addButton.width, h: addButton.height }
    }
    var thumb = thumbs[target.id]
    return thumb ? thumb.pictureRect() : null
  }
}
