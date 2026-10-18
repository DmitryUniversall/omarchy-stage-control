import QtQuick
import QtQuick.Effects
import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland

// One desktop in the Spaces bar. Collapsed it is just its name; expanded it
// shows the desktop: the wallpaper with its windows where they are. Click to
// go there, hover for the delete button, drag it to reorder desktops, drop
// windows on it to move them there, and right-click it to rename it.
Item {
  id: thumb

  required property var modelData       // desktop (workspace) id
  property var strip: null

  readonly property var overview: strip ? strip.overview : null
  readonly property var service: strip ? strip.service : null
  readonly property var info: overview && overview.desktopData ? (overview.desktopData[modelData] || null) : null
  readonly property bool active: !!info && info.active
  readonly property real ex: strip ? strip.expand : 0
  readonly property bool hovered: hover.hovered
  readonly property bool dropTarget: !!overview && !!overview.dropTarget
    && overview.dropTarget.kind === "desktop" && overview.dropTarget.id === modelData
  readonly property bool beingDragged: !!strip && strip.draggingDesktop === modelData
  // The name you gave it, else a full-screen app's name, else Hyprland's.
  readonly property string customName: service && service.desktopNames ? (service.desktopNames[String(modelData)] || "") : ""
  readonly property string defaultLabel: !info ? "" : info.fullscreenClass
    ? (service ? service.appFor(info.fullscreenClass).name : info.fullscreenClass)
    : /^[0-9]+$/.test(info.name) ? "Desktop " + info.name : info.name
  readonly property string label: customName !== "" ? customName : defaultLabel

  readonly property bool renaming: !!strip && strip.renamingDesktop === modelData
  onRenamingChanged: {
    if (!renaming) return
    nameInput.text = label
    nameInput.selectAll()
    nameInput.forceActiveFocus()
  }

  // Keeping the default name (or clearing it) stores no name.
  function commitRename() {
    if (!renaming) return
    var text = nameInput.text.trim()
    strip.endRename(modelData, text === defaultLabel ? "" : text)
  }

  // The name pill takes the name's width, but collapsed no more than the
  // desktop's share of the bar and expanded no more than its thumbnail: a long
  // name is cut short rather than pushing desktops off the screen.
  readonly property real nameWidth: Math.ceil(renaming ? Math.max(64, nameInput.implicitWidth + 4) : labelText.implicitWidth) + 26
  readonly property real thumbWidth: strip ? strip.thumbW : 0
  readonly property real collapsedWidth: Math.min(nameWidth, strip ? strip.collapsedSlot : nameWidth)
  readonly property real pillWidth: Math.round(collapsedWidth + (Math.min(nameWidth, thumbWidth) - collapsedWidth) * ex)
  // The name's room inside the pill, shown or being edited.
  readonly property real textWidth: Math.max(0, pillWidth - 26)
  width: Math.round(collapsedWidth + (thumbWidth - collapsedWidth) * ex)
  height: strip ? strip.thumbH + strip.labelSpace : 0

  // The windows' previews are made once per opening and kept: the first time
  // the thumbnail shows, or when the stage has finished opening and it's
  // this desktop's turn (SpacesBar.previewTurns), so the bar opens without
  // first starting a capture of every window again.
  property bool previews: false
  // A bar that's always open would otherwise start every desktop's on the
  // stage's first frame, the one a swipe waits for: there only the desktop
  // on screen starts at once (its windows are the stage's own tiles, see
  // tilePreview), and the others take their turns as the stage settles.
  readonly property bool wantsPreviews: !!overview && overview.showsHere && overview.mission
    && ((ex > 0.01 && (!strip || strip.mode === "auto" || active))
      || (!!strip && strip.previewRank(modelData) < strip.previewTurns))
  onWantsPreviewsChanged: if (wantsPreviews) previews = true
  // Thumbnails outlive a closed stage (Overview.rebuild()); their previews
  // don't, so the next opening captures the windows as they are then.
  Connections {
    target: thumb.overview
    function onShowsHereChanged() { if (!thumb.overview.showsHere) thumb.previews = false }
  }
  // Hyprland showed this desktop for a moment, under the stage, and its
  // windows drew themselves at new sizes (Service.showFirst): the frames
  // held from before are taken again.
  Connections {
    target: thumb.service
    function onDesktopRedrawn(desktop) {
      if (desktop !== thumb.modelData) return
      for (var i = 0; i < minis.count; i++) {
        var item = minis.itemAt(i)
        if (item) item.recapture()
      }
    }
  }
  Component.onCompleted: {
    if (wantsPreviews) previews = true
    if (strip) strip.registerThumb(modelData, thumb)
  }

  // Where the thumbnail is, in the overview's coordinates (for drops).
  function pictureRect() {
    var point = picture.mapToItem(overview.stage, 0, 0)
    return { x: point.x, y: point.y, w: picture.width * picture.scale, h: picture.height * picture.scale }
  }

  // Where the desktop opens from with the bar folded into names
  // (Overview.closeOnDesktop): the screen's shape (`aspect`, width over
  // height), as tall as the name and centered on it.
  function nameRect(aspect) {
    var center = pill.mapToItem(overview.stage, pill.width / 2, pill.height / 2)
    var h = pill.height
    var w = h * aspect
    return { x: center.x - w / 2, y: center.y - h / 2, w: w, h: h }
  }

  // Dragged, it follows the pointer; another desktop dragged across this
  // one moves it aside to make room (SpacesBar.makeRoom).
  transform: Translate {
    x: thumb.beingDragged ? thumb.strip.desktopDragOffset : (thumb.strip ? thumb.strip.makeRoom(thumb.modelData) : 0)
    Behavior on x {
      // Not under the pointer, only on its way into the room let go in.
      enabled: !!thumb.strip && thumb.strip.roomAnimated && (!thumb.beingDragged || thumb.strip.settling)
      NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
    }
  }
  z: beingDragged ? 10 : 0

  Item {
    id: picture
    anchors.horizontalCenter: parent.horizontalCenter
    width: strip ? strip.thumbW : 0
    height: strip ? strip.thumbH : 0
    opacity: thumb.ex
    visible: opacity > 0.01
    scale: (0.72 + 0.28 * thumb.ex) * (thumb.dropTarget ? 1.06 : thumb.hovered && !thumb.beingDragged ? 1.03 : 1)
    transformOrigin: Item.Top
    Behavior on scale { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }

    RectangularShadow {
      anchors.fill: parent
      radius: 9
      offset: Qt.vector2d(0, 5)
      blur: 16
      spread: -2
      color: Qt.rgba(0, 0, 0, 0.45)
    }

    Rounded {
      id: screenPicture
      anchors.fill: parent
      radius: 9
      color: Qt.rgba(0.1, 0.1, 0.12, 1)

      Image {
        anchors.fill: parent
        source: thumb.service ? thumb.service.wallpaperUrl : ""
        fillMode: Image.PreserveAspectCrop
        sourceSize.width: Math.round(thumb.strip ? thumb.strip.thumbW * 2 : 0)
        asynchronous: true
        cache: true
        smooth: true
      }

      // The desktop's windows, where they are on the display.
      Repeater {
        id: minis
        model: ScriptModel { values: thumb.info && thumb.previews ? thumb.info.windows : [] }
        delegate: Item {
          id: mini
          required property var modelData
          readonly property var win: thumb.overview ? thumb.overview.windowFor(modelData) : null
          readonly property var mon: thumb.overview ? thumb.overview.monitor : null
          readonly property real s: mon ? picture.width / Math.max(1, mon.w) : 0
          readonly property var handle: {
            Hyprland.toplevels.values
            return thumb.service ? thumb.service.toplevelFor(modelData) : null
          }
          visible: !!win && !!mon
          x: win && mon ? (win.x - mon.x) * s : 0
          y: win && mon ? (win.y - mon.y) * s : 0
          width: win ? Math.max(2, win.w * s) : 0
          height: win ? Math.max(2, win.h * s) : 0
          z: win ? (win.floating ? 200 : 0) + (100 - Math.min(99, win.focus)) : 0
          // On the desktop on screen every window is also a tile on the stage,
          // already captured live: show the tile's picture instead of
          // capturing the window a second time (once it has one, so a desktop
          // that just came on screen doesn't blank). Other desktops capture
          // theirs.
          readonly property Item tilePreview: {
            if (!thumb.active || !thumb.overview) return null
            var tile = thumb.overview.tileFor(modelData)
            return tile && tile.hasContent ? tile.preview : null
          }

          Rectangle {
            anchors.fill: parent
            anchors.margins: -1
            radius: 2
            color: Qt.rgba(0, 0, 0, 0.25)
          }
          Loader {
            anchors.fill: parent
            active: !!mini.tilePreview
            sourceComponent: ShaderEffect {
              property var source: mini.tilePreview
            }
          }
          // Its windows drew themselves anew (Service.desktopRedrawn).
          function recapture() {
            if (shot.captureSource) shot.captureFrame()
          }
          ScreencopyView {
            id: shot
            anchors.fill: parent
            visible: !mini.tilePreview
            captureSource: !mini.tilePreview && thumb.overview && thumb.overview.showsHere && mini.handle
              ? mini.handle.wayland : null
            // A window on the desktop on screen without a tile is live while you
            // can see it; the other desktops hold the frame they had.
            live: thumb.active && thumb.ex > 0.01
          }
        }
      }
    }

    // Frame: bright for the desktop on screen, the highlight color for drops.
    Rectangle {
      anchors.fill: parent
      anchors.margins: -3
      radius: 12
      color: "transparent"
      border.width: thumb.dropTarget ? 3 : thumb.active ? 2.5 : 1
      border.color: thumb.dropTarget || thumb.active ? (thumb.overview ? thumb.overview.highlight : "#0a84ff")
        : Qt.rgba(1, 1, 1, thumb.hovered ? 0.45 : 0.16)
      Behavior on border.color { ColorAnimation { duration: 140 } }
    }

    // Delete, top-left, like macOS. The last desktop can't be removed.
    Glass {
      id: removeButton
      readonly property bool wanted: thumb.hovered && thumb.ex > 0.9 && !!thumb.strip && thumb.strip.count > 1
        && !thumb.overview.dragging && thumb.strip.draggingDesktop === 0 && thumb.strip.renamingDesktop === 0
      x: -9
      y: -9
      width: 22
      height: 22
      radius: 11
      style: "solid"
      selected: removeMouse.containsMouse
      selectedColor: "#ff5f57"
      selectedStrength: 0.95
      opacity: wanted ? 1 : 0
      visible: opacity > 0.01
      scale: wanted ? 1 : 0.6
      Behavior on opacity { NumberAnimation { duration: 140 } }
      Behavior on scale { NumberAnimation { duration: 180; easing.type: Easing.OutBack } }
      z: 5

      Text {
        anchors.centerIn: parent
        anchors.verticalCenterOffset: -1
        text: "×"
        textFormat: Text.PlainText
        color: removeMouse.containsMouse ? Qt.rgba(0.36, 0.04, 0.02, 1) : "white"
        font.pixelSize: 16
        font.weight: Font.DemiBold
        font.family: thumb.overview ? thumb.overview.uiFont : ""
      }
      MouseArea {
        id: removeMouse
        anchors.fill: parent
        anchors.margins: -4
        hoverEnabled: true
        enabled: removeButton.wanted
        cursorShape: Qt.PointingHandCursor
        onClicked: thumb.service.removeDesktop(thumb.overview.screenName, thumb.modelData)
      }
    }
  }

  // Name: a glass pill under the thumbnail (or on its own when collapsed).
  // With names hidden it shows over the thumbnail's bottom edge, only while
  // the desktop is pointed at or renamed.
  readonly property bool namesHidden: !!strip && strip.namesHidden
  Glass {
    id: pill
    anchors.horizontalCenter: parent.horizontalCenter
    y: thumb.namesHidden ? (thumb.strip ? thumb.strip.thumbH - height - 8 : 0)
      : Math.round((thumb.strip ? thumb.strip.thumbH + 10 : 0) * thumb.ex)
    z: 4
    opacity: !thumb.namesHidden || thumb.renaming || (thumb.hovered && !thumb.beingDragged) ? 1 : 0
    visible: opacity > 0.01
    Behavior on opacity { NumberAnimation { duration: 140 } }
    width: thumb.pillWidth
    height: thumb.strip ? thumb.strip.labelH : 24
    radius: height / 2
    style: thumb.overview ? thumb.overview.glassStyle : "liquid"
    backdrop: thumb.overview ? thumb.overview.glassBackdrop : null
    backdropIsWindow: true
    shadow: thumb.ex < 0.5
    hovered: thumb.hovered && !thumb.active
    selected: thumb.active
    selectedColor: thumb.overview ? thumb.overview.highlight : "#0a84ff"
    selectedStrength: 0.26
    outlineColor: thumb.overview ? thumb.overview.highlight : "#0a84ff"
    outlineWidth: thumb.active || thumb.renaming ? 1.5 : 0

    Text {
      id: labelText
      anchors.centerIn: parent
      width: thumb.textWidth
      visible: !thumb.renaming
      text: thumb.label
      textFormat: Text.PlainText
      elide: Text.ElideRight
      horizontalAlignment: Text.AlignHCenter
      color: Qt.rgba(1, 1, 1, thumb.active ? 1 : 0.78)
      font.family: thumb.overview ? thumb.overview.uiFont : ""
      font.pixelSize: 12
      font.weight: thumb.active ? Font.DemiBold : Font.Medium
    }

    // The name, editable, while renaming. Enter keeps it, Esc cancels; the
    // keys stop here, so the stage's own (Esc closes it) never see them.
    TextInput {
      id: nameInput
      anchors.centerIn: parent
      width: thumb.textWidth
      visible: thumb.renaming
      enabled: thumb.renaming
      horizontalAlignment: TextInput.AlignHCenter
      clip: true
      maximumLength: 32
      selectByMouse: true
      color: "white"
      selectionColor: thumb.overview ? thumb.overview.highlight : "#0a84ff"
      selectedTextColor: "white"
      font.family: thumb.overview ? thumb.overview.uiFont : ""
      font.pixelSize: 12
      font.weight: Font.DemiBold
      onActiveFocusChanged: if (!activeFocus && thumb.renaming) thumb.commitRename()
      Keys.onReturnPressed: function(event) { event.accepted = true; thumb.commitRename() }
      Keys.onEnterPressed: function(event) { event.accepted = true; thumb.commitRename() }
      Keys.onEscapePressed: function(event) { event.accepted = true; thumb.strip.endRename(thumb.modelData, null) }
      Keys.onTabPressed: function(event) { event.accepted = true }
      Keys.onBacktabPressed: function(event) { event.accepted = true }
    }
  }

  // Where the desktop takes the pointer: what it shows. Collapsed that's
  // only its name; the room its thumbnail opens into stays clear, so the
  // pointer there neither lights the name nor goes to the desktop. A
  // desktop scrolled out of view takes nothing.
  Item {
    id: hitArea
    width: parent.width
    height: thumb.namesHidden ? (thumb.strip ? thumb.strip.thumbH : 0) : pill.y + pill.height
    containmentMask: QtObject {
      function contains(point: point): bool {
        return point.x >= 0 && point.y >= 0 && point.x <= hitArea.width && point.y <= hitArea.height
          && (!thumb.strip || thumb.strip.inView(hitArea, point))
      }
    }

    HoverHandler {
      id: hover
      enabled: !!thumb.service && thumb.service.interactive
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: hitArea
    containmentMask: hitArea.containmentMask
    // Off while any desktop is renamed: a click then only keeps the name.
    enabled: !!thumb.service && thumb.service.interactive && !!thumb.strip && thumb.strip.renamingDesktop === 0
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    cursorShape: thumb.beingDragged ? Qt.ClosedHandCursor : Qt.PointingHandCursor
    // Under the delete button.
    z: -1
    property real pressedX: 0

    onPressed: function(event) {
      if (event.button === Qt.RightButton) {
        thumb.strip.beginRename(thumb.modelData)
        return
      }
      pressedX = mapToItem(thumb.strip, event.x, event.y).x
    }
    onPositionChanged: function(event) {
      if (!(pressedButtons & Qt.LeftButton) || thumb.ex < 0.9) return
      var x = mapToItem(thumb.strip, event.x, event.y).x
      if (thumb.strip.draggingDesktop === 0 && Math.abs(x - pressedX) > 12) thumb.strip.beginDesktopDrag(thumb.modelData, pressedX)
      if (thumb.strip.draggingDesktop === thumb.modelData) thumb.strip.moveDesktopDrag(x)
    }
    onReleased: function(event) {
      if (event.button !== Qt.LeftButton) return
      if (thumb.strip.draggingDesktop === thumb.modelData) {
        thumb.strip.endDesktopDrag()
        return
      }
      // The desktop on screen opens from its thumbnail too (closeOnDesktop).
      thumb.overview.closeOnDesktop(thumb.modelData)
    }
    onCanceled: if (thumb.strip.draggingDesktop === thumb.modelData) thumb.strip.cancelDesktopDrag()
  }

  Component.onDestruction: {
    if (!strip) return
    strip.unregisterThumb(modelData, thumb)
    if (renaming) strip.endRename(modelData, null)
  }
}
