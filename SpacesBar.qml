import QtQuick
import Quickshell
import "Layout.js" as Layout

// The Spaces bar along the top of the stage. Like macOS it shows the
// desktops' names and expands into thumbnails when the pointer comes up to it
// or a window is dragged toward it. The "+" on the right adds a desktop; drop
// a window on it to put the window on a new desktop. Right-click a desktop to
// rename it.
Item {
  id: bar

  property var overview: null

  readonly property var service: overview ? overview.service : null
  readonly property var monitor: overview ? overview.monitor : null
  readonly property var settings: service && service.settings ? service.settings : ({})
  readonly property real p: service ? service.progress : 0
  readonly property real e: settings.reduceMotion ? 1 : p
  readonly property int count: overview ? overview.desktopIds.length : 0

  // Sized so every desktop and the "+" fit on the screen (Layout.spacesBar).
  readonly property var metrics: Layout.spacesBar(width, count, monitor ? monitor.h / Math.max(1, monitor.w) : 0.625)
  readonly property real thumbW: metrics.thumbW
  readonly property real thumbH: metrics.thumbH
  // The most a desktop's name may take while the bar is collapsed.
  readonly property real collapsedSlot: metrics.collapsedSlot
  readonly property real labelH: 24
  readonly property real inset: 14
  readonly property real collapsedHeight: inset + labelH + 16
  readonly property real expandedHeight: inset + thumbH + 10 + labelH + 18

  readonly property bool expanded: settings.spacesBar === "expanded" || hover.hovered
    || (!!overview && (overview.dragging || overview.forceExpanded)) || draggingDesktop !== 0
    || renamingDesktop !== 0
  property real expand: expanded ? 1 : 0
  Behavior on expand { NumberAnimation { duration: 280; easing.type: Easing.OutCubic } }

  // The space the spread must leave free (the target, not the animation).
  readonly property real reservedHeight: expanded ? expandedHeight : collapsedHeight

  width: overview ? overview.width : 0
  height: collapsedHeight + (expandedHeight - collapsedHeight) * expand
  // Slides down from the top edge as the stage opens. Drawn while the stage
  // prepares, so its glass is ready by the first frame (Overview.preparing).
  y: -Math.round(height * 0.7 * (1 - e))
  opacity: overview && overview.preparing ? 0.5 : e

  HoverHandler {
    id: hover
    enabled: !!bar.service && bar.service.interactive
  }

  // ---- desktops ---------------------------------------------------------------

  property var thumbs: ({})

  function registerThumb(id, item) { thumbs[id] = item }
  function unregisterThumb(id, item) { if (thumbs[id] === item) delete thumbs[id] }

  Row {
    id: row
    // Centered, but clear of the screen's edges and, as the bar opens, of
    // the "+" on the right.
    x: Math.round(Math.max(bar.metrics.margin, Math.min((bar.width - width) / 2,
      bar.width - bar.metrics.margin - (addButton.width + bar.metrics.addGap) * bar.expand - width)))
    y: bar.inset
    spacing: Math.round(bar.metrics.collapsedSpacing + (bar.metrics.spacing - bar.metrics.collapsedSpacing) * bar.expand)

    Repeater {
      model: ScriptModel { values: bar.overview ? bar.overview.desktopIds : [] }
      delegate: DesktopThumb { strip: bar }
    }
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
