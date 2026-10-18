import QtQuick
import QtQuick.Effects
import QtQuick.Shapes
import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import "Model.js" as Model

// One window on the stage: a live preview that travels from where the
// window really is (progress 0) to its place in the spread (progress 1), with
// the macOS hover outline, its title, and its app icon. Drag it onto a desktop
// in the Spaces bar; click it to go to it; its × (or a middle-click) closes it.
Item {
  id: tile

  required property var modelData       // the window's address
  property var overview: null

  readonly property var service: overview ? overview.service : null
  readonly property var info: overview && overview.tileData ? (overview.tileData[modelData] || null) : null
  readonly property real p: service ? service.progress : 0
  readonly property bool reduceMotion: !!(service && service.settings && service.settings.reduceMotion)
  // With reduced motion the windows wait in their spots on the stage and
  // the whole overlay fades in and out instead.
  readonly property real e: reduceMotion ? 1 : p
  readonly property bool onScreen: !!info && info.onScreen
  readonly property bool hovered: !!overview && overview.hoverAddress === modelData
  readonly property bool selected: !!overview && overview.selectedAddress === modelData
  // Pointed at or picked from the keyboard: shows its title (with titles on
  // hover). `lit` adds the lift and the highlight outline, which the
  // pointer only gives as windowHighlight allows; the keyboard always does.
  readonly property bool active: (hovered || selected) && !!service && service.interactive && !dragging && !dropping && !closingOut
  readonly property bool lit: active && (selected || (!!overview && overview.windowHighlight !== "never"))
  readonly property bool exiting: !!service && service.exitAddress === modelData
  readonly property bool dragging: !!overview && overview.dragAddress === modelData

  // ---- at rest, as Hyprland draws it ----------------------------------------------
  //
  // Where the stage meets the screen (progress 0: as the stage opens, and as
  // it ends closing) a window is drawn the way Hyprland draws it there: on
  // the display's pixels, at its opacity, over Hyprland's blur, with its
  // border and shadow (Service.looks). Nothing changes the moment the stage
  // goes, or the moment it comes.
  readonly property var looks: service ? service.looks : null
  // What window rules give this window (Service.windowLooks), or null.
  readonly property var rules: service && service.windowLooks ? (service.windowLooks[modelData] || null) : null
  readonly property real dpr: overview ? overview.dpr : 1
  // Opening from a desktop's thumbnail (Overview.closeOnDesktop).
  readonly property bool zooms: !!info && info.zoom === true
  // Another app's window in App Exposé, staying where it is on the desktop
  // (Overview.rebuild()).
  readonly property bool stays: !!info && info.stays === true
  // Fullscreen, Hyprland draws neither border nor shadow, nor corners.
  readonly property bool fullscreen: !!info && (info.fullscreen & 2) !== 0
  // Gets the keys once the stage is gone: the active window's looks.
  readonly property bool focusTarget: !!overview && overview.focusTarget === modelData
  readonly property real restAlpha: Model.windowAlpha(rules, looks, fullscreen ? "fullscreen" : focusTarget ? "active" : "inactive")
  // Its border and corners at rest: its rules', else the settings'.
  readonly property real restBorder: rules && rules.border !== null ? rules.border : service ? service.decor.border : 0
  readonly property bool decorated: !rules || rules.decorate
  // Opaque on the stage, as Hyprland draws it at rest.
  readonly property real windowAlpha: restAlpha + (1 - restAlpha) * e
  readonly property bool atRest: e <= 0 && !dragging && !dropping
  // Where Hyprland puts it on the display's pixels (CBox::round): at rest
  // its pixels land on the screen's one for one, and text is as sharp as on
  // the desktop. In display pixels.
  readonly property int restLeft: Math.round(from.x * dpr)
  readonly property int restTop: Math.round(from.y * dpr)
  readonly property int restWidth: Math.max(1, Math.round(from.x * dpr + from.w * dpr - restLeft))
  readonly property int restHeight: Math.max(1, Math.round(from.y * dpr + from.h * dpr - restTop))
  readonly property bool hasContent: capture.hasContent
  // The live preview as rendered here, for the Spaces bar's picture of this
  // desktop (DesktopThumb), so it needn't capture the window again.
  readonly property Item preview: frame.contentLayer
  readonly property var handle: {
    Hyprland.toplevels.values
    return service ? service.toplevelFor(modelData) : null
  }
  // The window's title, live: Hyprland's toplevel follows every retitle on
  // its own, so a new title needn't read all of Hyprland's state again. As
  // in a read of Hyprland's state, a window without a title shows its first.
  // Only while the stage shows: a kept tile (Overview.rebuild()) needn't
  // lay out every new title of a busy terminal while the stage is closed.
  readonly property string title: overview && overview.showsHere && handle
    ? (handle.title || (info ? info.initialTitle : "")) : (info ? info.title : "")

  function lerp(a, b, t) { return a + (b - a) * t }
  function smooth(edge0, edge1, x) {
    var t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }

  // Place in the spread. Animates when the layout changes while open (a
  // window closes, the Spaces bar expands), not while opening or closing.
  // Nor once it's closing: the stage then goes where the windows are, from
  // where they were (a desktop picked in the Spaces bar opens from its
  // thumbnail, Overview.closeOnDesktop).
  readonly property bool animateLayout: !!service && service.revealed && !service.tracking && !service.closing && p > 0.99
  property real tx: info ? info.to.x : 0
  property real ty: info ? info.to.y : 0
  property real tw: info ? info.to.w : 1
  property real th: info ? info.to.h : 1
  Behavior on tx { enabled: tile.animateLayout; NumberAnimation { duration: 320; easing.type: Easing.OutCubic } }
  Behavior on ty { enabled: tile.animateLayout; NumberAnimation { duration: 320; easing.type: Easing.OutCubic } }
  Behavior on tw { enabled: tile.animateLayout; NumberAnimation { duration: 320; easing.type: Easing.OutCubic } }
  Behavior on th { enabled: tile.animateLayout; NumberAnimation { duration: 320; easing.type: Easing.OutCubic } }

  readonly property var from: info ? info.from : ({ x: 0, y: 0, w: 1, h: 1 })

  // Dragging: follow the pointer, shrinking near the Spaces bar.
  property real dragScale: dragging ? overview.dragShrink : 1
  Behavior on dragScale { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }

  // After a drop the window flies from where it was let go: into a desktop's
  // thumbnail (fading, until it leaves this desktop), or back to its place.
  property bool dropping: false
  property bool dropFades: false
  property var dropFrom: ({ x: 0, y: 0, w: 1, h: 1 })
  property var dropTo: ({ x: 0, y: 0, w: 1, h: 1 })
  property real dropT: 0
  NumberAnimation {
    id: dropAnimation
    target: tile
    property: "dropT"
    from: 0
    to: 1
    duration: 300
    easing.type: Easing.InOutCubic
    onFinished: if (!tile.dropFades || tile.peek) tile.endDrop()
  }

  // Fitted into `rect` as it is, or, `exact`, onto it: a window taking its
  // new desktop's size on the way takes that shape (Overview.presizedRect).
  function flyTo(rect, fade, exact) {
    dropFrom = { x: x, y: y, w: width, h: height }
    var scale = Math.min(rect.w / Math.max(1, width), rect.h / Math.max(1, height))
    var w = exact === true ? rect.w : width * scale
    var h = exact === true ? rect.h : height * scale
    dropTo = { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w: w, h: h }
    dropFades = fade === true
    dropping = true
    dropAnimation.restart()
  }

  // A new snapshot means the move landed (the tile goes away) or failed (it
  // comes back to its spot).
  Connections {
    target: tile.service
    function onSnapVersionChanged() {
      if (tile.dropping && !dropAnimation.running) tile.endDrop()
    }
  }

  // A window moved to another desktop stays a tile, waiting off the
  // screen's edge for a swipe (peek): it goes there once its flight is
  // over, rather than staying, faded, where the desktop's thumbnail was. In
  // the Spaces bar's "auto" mode the thumbnails fold away into names and
  // left it behind as a ghost of the window.
  function endDrop() {
    dropping = false
    if (peek) placeAt(info.peekPage * overview.pageShift)
  }

  // Switching desktops on the open stage (Overview, "sliding desktops"):
  // the window slides out with the desktop it's on, or in with the new one.
  // A shift on top of where it is, so the slide leaves its place, its
  // hover zoom and its layout animations alone.
  readonly property bool leaving: !!info && info.leaving === true
  // A window of another desktop, waiting off the screen's edge for a swipe
  // (Overview, "swiping between desktops"), with one picture rather than a
  // live preview.
  readonly property bool peek: !!info && info.peek === true
  // A window that left for another desktop some other way (not dropped,
  // nor sliding out) goes off screen with that desktop's windows.
  onPeekChanged: if (peek && !dropping) placeAt(info.peekPage * overview.pageShift)
  property real slideX: 0
  // The swipe moves every tile at once (Overview.trackX).
  transform: Translate { x: tile.slideX + (tile.overview ? tile.overview.trackX : 0) }
  NumberAnimation {
    id: slideAnimation
    target: tile
    property: "slideX"
    easing.type: Easing.OutCubic
  }

  function slideTo(target, duration) {
    slideAnimation.stop()
    slideAnimation.from = slideX
    slideAnimation.to = target
    slideAnimation.duration = duration
    slideAnimation.start()
  }

  // Straight to `offset` (a peeking window's place beside the screen),
  // unless it's on its way somewhere.
  // A fresh picture for a waiting window, as a swipe starts.
  function refreshPreview() {
    if (capture.captureSource) capture.captureFrame()
  }

  function placeAt(offset) {
    if (!slideAnimation.running) slideX = offset
  }

  // Straight to `offset`, whatever it was doing.
  function settleAt(offset) {
    slideAnimation.stop()
    slideX = offset
  }

  // Moves by `shift` while the swipe's own shift (Overview.trackX) moves
  // back by as much, so the window stays where it is on screen. One on its
  // way somewhere keeps going there, as far again.
  function shiftBy(shift) {
    if (!slideAnimation.running) {
      slideX += shift
      return
    }
    var target = slideAnimation.to + shift
    var left = Math.max(60, slideAnimation.duration * (1 - Math.min(1, slideAnimation.currentTime / Math.max(1, slideAnimation.duration))))
    slideAnimation.stop()
    slideX += shift
    slideTo(target, left)
  }

  // In from `offset`, or, for a window already off its place (on its way
  // out, or waiting beside the screen during a swipe), from where it is.
  function slideIn(offset, duration) {
    if (!slideAnimation.running && Math.abs(slideX) < 0.5) slideX = offset
    slideTo(0, duration)
  }

  Component.onCompleted: {
    if (!overview) return
    overview.registerTile(modelData, tile)
    if (peek) placeAt(info.peekPage * overview.pageShift)
    var offset = overview.takeSlideIn(modelData)
    if (offset !== undefined) slideIn(offset, overview.slideDuration)
  }

  // Tiles outlive a closed stage (Overview.rebuild()): the next opening
  // starts them afresh.
  Connections {
    target: tile.overview
    function onShowsHereChanged() {
      if (tile.overview.showsHere) return
      slideAnimation.stop()
      tile.slideX = 0
      dropAnimation.stop()
      tile.dropping = false
      closeTimeout.stop()
      tile.closingOut = false
    }
  }

  x: atRest ? restLeft / dpr
    : dropping ? lerp(dropFrom.x, dropTo.x, dropT)
    : dragging ? overview.dragPoint.x - overview.dragGrab.x * tw * dragScale
    : lerp(from.x, tx, e)
  y: atRest ? restTop / dpr
    : dropping ? lerp(dropFrom.y, dropTo.y, dropT)
    : dragging ? overview.dragPoint.y - overview.dragGrab.y * th * dragScale
    : lerp(from.y, ty, e)
  width: atRest ? restWidth / dpr : dropping ? lerp(dropFrom.w, dropTo.w, dropT) : dragging ? tw * dragScale : lerp(from.w, tw, e)
  height: atRest ? restHeight / dpr : dropping ? lerp(dropFrom.h, dropTo.h, dropT) : dragging ? th * dragScale : lerp(from.h, th, e)
  // Above the Spaces bar (z 1100) while dragged or flying into a desktop.
  // Opening from a desktop's thumbnail, over the Spaces bar it starts in.
  // Going back to its place over the desktop on screen opening from its
  // thumbnail (info.overCard), above it too.
  z: dragging || dropping ? 2000 : info && (info.zoom || info.overCard) ? 1500 + info.z : exiting ? 900 : lit ? 500 : (info ? info.z : 0)
  opacity: (dropping && dropFades ? 1 - dropT * 0.85 : onScreen ? 1 : smooth(0.15, 0.85, p)) * closeFade
    * (zooms && overview ? overview.zoomShown : 1) * (stays ? 1 - smooth(0.05, 0.45, e) : 1)
  visible: !!info

  // Hover lift, like macOS.
  scale: closingOut ? 0.94 : lit ? 1.025 : 1
  Behavior on scale { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }

  // Hyprland's corners at rest (none fullscreen), the stage's on the stage.
  // Opening from a thumbnail, the corners grow with the window.
  readonly property real restRadius: fullscreen || !overview ? 0 : rules && rules.rounding !== null ? rules.rounding : overview.windowRounding
  readonly property real cornerRadius: zooms ? restRadius * width / Math.max(1, from.w)
    : lerp(restRadius, 10, smooth(0, 0.5, e))

  // Hyprland's shadow, where the window comes to rest; the stage's own
  // takes over as it leaves. (It came in only once the stage was gone.)
  ShaderEffect {
    id: hyprShadow
    readonly property var config: tile.looks ? tile.looks.shadow : null
    readonly property var d: tile.service ? tile.service.decor : null
    // The window's size here to its real size.
    readonly property real s: tile.width / Math.max(1, tile.from.w)
    readonly property real borderSize: tile.restBorder * s
    readonly property real reach: config ? config.range * s : 0
    readonly property real boxScale: config ? config.scale : 1
    // The window with its border, out by `range`, scaled about its center
    // and moved by `offset` (CHyprDropShadowDecoration).
    readonly property real boxWidth: (tile.width + 2 * borderSize + 2 * reach) * boxScale
    readonly property real boxHeight: (tile.height + 2 * borderSize + 2 * reach) * boxScale
    x: (tile.width - boxWidth) / 2 + (config ? config.offset.x * s : 0)
    y: (tile.height - boxHeight) / 2 + (config ? config.offset.y * s : 0)
    width: boxWidth
    height: boxHeight
    visible: !!config && config.enabled && config.range > 0 && !!d && tile.onScreen && !tile.fullscreen
      && tile.decorated && (!tile.rules || tile.rules.shadow)
      && !tile.dragging && !tile.dropping && !tile.closingOut && opacity > 0.01
    opacity: 1 - tile.smooth(0, 0.3, tile.e)
    property size fullSize: Qt.size(width * tile.dpr, height * tile.dpr)
    // Hyprland's whole display pixels: the corners of the window with its
    // border, and the reach.
    property real radius: tile.restRadius > 0 ? Math.floor((tile.restRadius + tile.restBorder) * s * tile.dpr) : 0
    property real range: config ? Math.floor(config.range * s * tile.dpr) : 0
    property real power: config ? config.renderPower : 3
    property real roundingPower: tile.rules && tile.rules.roundingPower !== null ? tile.rules.roundingPower
      : tile.looks ? tile.looks.roundingPower : 2
    property real sharp: config && config.sharp ? 1 : 0
    readonly property color shade: !config ? "transparent"
      : tile.focusTarget || !config.colorInactive ? config.color : config.colorInactive
    property vector4d color: Qt.vector4d(shade.r, shade.g, shade.b, shade.a * tile.restAlpha)
    property vector4d cutout: Qt.vector4d(-x * tile.dpr, -y * tile.dpr, (tile.width - x) * tile.dpr, (tile.height - y) * tile.dpr)
    property real windowRadius: Math.round(tile.restRadius * s * tile.dpr)
    fragmentShader: Qt.resolvedUrl("shaders/hyprshadow.frag.qsb")
  }

  RectangularShadow {
    anchors.fill: frame
    radius: frame.radius
    offset: Qt.vector2d(0, 12 * tile.e)
    blur: 34 * tile.e + (tile.dragging ? 20 : 0)
    spread: -4
    color: Qt.rgba(0, 0, 0, (tile.dragging ? 0.6 : 0.5) * tile.e)
    // Not in a thumbnail opening into the screen: the thumbnail has none.
    visible: tile.e > 0.02 && !tile.zooms && !tile.stays
  }

  // The window's title bar and border from the screen capture, following the
  // window and fading as it leaves its spot (and returning as it comes back).
  ShaderEffectSource {
    id: decoration
    readonly property var d: tile.service ? tile.service.decor : ({ border: 0, bar: 0 })
    readonly property var at: tile.overview ? tile.overview.ghostRects[tile.modelData] : null
    // As captured: in its place, and active or not as it was then (with
    // no title bars to keep, Hyprland's border is drawn instead).
    readonly property bool matches: !!at && !!tile.info && tile.info.ghost === true
      && at.x === tile.from.x && at.y === tile.from.y && at.w === tile.from.w && at.h === tile.from.h
      && (d.bar > 0 || (!!tile.overview && tile.overview.ghostActive === tile.modelData) === tile.focusTarget)
    readonly property real s: tile.width / Math.max(1, tile.from.w)
    readonly property real above: d.border + d.bar
    sourceItem: matches && !tile.dragging && !tile.dropping ? tile.overview.screenCapture : null
    sourceRect: Qt.rect(tile.from.x - d.border, tile.from.y - above, tile.from.w + d.border * 2, tile.from.h + d.border + above)
    x: -d.border * s
    y: -above * s
    width: sourceRect.width * s
    height: sourceRect.height * s
    // Drawn as a ring (decorationRing): its middle is the window as it was.
    visible: false
    live: false
    hideSource: false
    // A tile outlives the overlay's window (Overview.rebuild()), but a copy
    // that isn't live is taken once per ShaderEffectSource. Take it again
    // when the source comes back for a new opening, and when the new screen
    // capture is in.
    onSourceItemChanged: if (sourceItem) scheduleUpdate()
    Connections {
      target: tile.overview ? tile.overview.screenCapture : null
      function onHasContentChanged() {
        if (decoration.sourceItem && tile.overview.screenCapture.hasContent) decoration.scheduleUpdate()
      }
    }
  }

  // The capture of the title bar and border, around the window: not the
  // window as it was, which a translucent window showed through itself.
  ShaderEffect {
    id: decorationRing
    x: decoration.x
    y: decoration.y
    width: decoration.width
    height: decoration.height
    opacity: 1 - tile.smooth(0, 0.3, tile.p)
    visible: !!decoration.sourceItem && opacity > 0.01 && (decoration.d.border + decoration.d.bar) > 0
    property var source: decoration
    property size fullSize: Qt.size(width * tile.dpr, height * tile.dpr)
    readonly property real k: decoration.s * tile.dpr
    property vector4d cutout: Qt.vector4d(decoration.d.border * k, decoration.above * k,
      (decoration.d.border + tile.from.w) * k, (decoration.above + tile.from.h) * k)
    property real cutoutRadius: tile.restRadius * k
    property real roundingPower: tile.rules && tile.rules.roundingPower !== null ? tile.rules.roundingPower
      : tile.looks ? tile.looks.roundingPower : 2
    fragmentShader: Qt.resolvedUrl("shaders/ring.frag.qsb")
  }

  // The live preview is rendered at the window's size times the first power
  // of 0.8 at or above the tile's scale: never below the size it shows at,
  // never far above it, and while the tile travels it's rendered at a new size
  // a few times instead of on every frame.
  readonly property real renderScale: {
    var s = info ? width / Math.max(1, info.size.w) : 1
    if (!(s < 1)) return 1
    return Math.max(0.2, Math.pow(0.8, Math.floor(Math.log(s) / Math.log(0.8))))
  }

  // Hyprland's border, where the screen capture has none to give
  // (decoration): a window of another desktop the stage closes on, the
  // windows of a desktop opening from its thumbnail. It comes in as the
  // window lands, as the captured one does, rather than popping up the
  // moment the stage is gone. The active border for the window that gets
  // the keys (Overview.focusTarget). A ring, under the window's pane.
  Shape {
    id: border
    readonly property var d: tile.service ? tile.service.decor : null
    readonly property var gradient: !d ? null : tile.focusTarget ? d.active : d.inactive
    readonly property var colors: gradient ? gradient.colors : []
    // The window's size here to its real size.
    readonly property real s: tile.width / Math.max(1, tile.from.w)
    readonly property real size: tile.restBorder * s
    readonly property real outer: frame.radius > 0 ? frame.radius + size : 0
    // Hyprland's angle, turning clockwise from left to right.
    readonly property real angle: (gradient ? gradient.angle : 0) * Math.PI / 180
    readonly property real dx: Math.cos(angle) * width / 2
    readonly property real dy: Math.sin(angle) * height / 2
    anchors.fill: frame
    anchors.margins: -size
    visible: tile.onScreen && !decoration.matches && !tile.dragging && !tile.dropping && !tile.fullscreen
      && tile.decorated && colors.length > 0 && size > 0.3 && opacity > 0.01
    opacity: (1 - tile.smooth(0, 0.3, tile.p)) * tile.restAlpha
    preferredRendererType: Shape.CurveRenderer

    ShapePath {
      strokeWidth: -1
      fillRule: ShapePath.OddEvenFill
      fillGradient: LinearGradient {
        x1: border.width / 2 - border.dx
        y1: border.height / 2 - border.dy
        x2: border.width / 2 + border.dx
        y2: border.height / 2 + border.dy
        GradientStop { position: 0; color: border.colors.length ? border.colors[0] : "transparent" }
        GradientStop { position: 1; color: border.colors.length ? border.colors[border.colors.length - 1] : "transparent" }
      }
      PathRectangle {
        width: border.width
        height: border.height
        radius: border.outer
      }
      PathRectangle {
        x: border.size
        y: border.size
        width: Math.max(0, border.width - 2 * border.size)
        height: Math.max(0, border.height - 2 * border.size)
        radius: frame.radius
      }
    }
  }

  // Under the window, what Hyprland shows through it where it's
  // translucent: the blurred wallpaper (Overview.windowBackdrop), the part
  // that's behind the window on its desktop (info.place). It goes where the
  // window goes and shrinks with it, as part of the window: taken from
  // wherever the window was on the stage instead, the wallpaper slid
  // through it as it flew. (The window used to sit on a flat dark gray,
  // which turned translucent terminals and themed browsers gray the moment
  // the stage showed.) The pane is Glass's shader with nothing but its
  // sampling and rounded corners.
  ShaderEffect {
    anchors.fill: frame
    visible: !!backdrop
    // Hyprland draws it at the window's opacity, unless blur:ignore_opacity.
    // Where Hyprland doesn't blur behind the window (its app asked it not
    // to: foot, unless told to blur), it fades as the window lands, and the
    // wallpaper shows through sharp, as on the desktop (Overview's blur
    // probe). It used to stay blurred to the end, and the picture sharpened
    // the moment the stage was gone.
    readonly property bool blurred: !tile.overview || tile.overview.blurBehindFor(tile.modelData, tile.info ? tile.info.cls : "")
    opacity: (tile.looks && tile.looks.blur.ignoreOpacity ? 1 : tile.windowAlpha) * (blurred ? 1 : tile.smooth(0, 0.3, tile.e))
    property var backdrop: tile.overview ? tile.overview.windowBackdrop : null
    property size itemSize: Qt.size(width, height)
    property real radius: frame.radius
    property real bevel: 0.001
    property real refraction: 0
    property real frost: 0
    property real rim: 0
    property real flip: 0
    property real windowSpace: 0
    readonly property var place: tile.info && tile.info.place ? tile.info.place : tile.from
    readonly property real stageW: tile.overview ? Math.max(1, tile.overview.stageWidth) : 1
    readonly property real stageH: tile.overview ? Math.max(1, tile.overview.stageHeight) : 1
    property vector4d area: Qt.vector4d(place.x / stageW, place.y / stageH, place.w / stageW, place.h / stageH)
    property vector4d tint: Qt.vector4d(0, 0, 0, 0)
    property vector4d fill: Qt.vector4d(0, 0, 0, 0)
    fragmentShader: Qt.resolvedUrl("shaders/glass.frag.qsb")
  }

  Rounded {
    id: frame
    anchors.fill: parent
    radius: tile.cornerRadius
    // Clear: the window shows over the backdrop above, translucent where it
    // is translucent.
    color: "transparent"
    contentWidth: tile.info ? tile.info.size.w * tile.renderScale : width
    contentHeight: tile.info ? tile.info.size.h * tile.renderScale : height
    // At full size, rendered at the size it has at rest on the display, one
    // for one with the screen's pixels.
    textureSize: tile.renderScale >= 1 ? Qt.size(tile.restWidth, tile.restHeight) : Qt.size(0, 0)
    pixelRatio: tile.dpr
    opacity: tile.windowAlpha

    ScreencopyView {
      id: capture
      anchors.fill: parent
      captureSource: tile.overview && tile.overview.showsHere && tile.handle ? tile.handle.wayland : null
      // Not while the stage opens or closes by itself: Hyprland renders a
      // live capture again on every frame, changed or not, and those frames
      // are the ones with the least time to spare. The window flies with the
      // frame it has and comes alive again when it lands. While the fingers
      // hold the stage, it stays live.
      // Nor while desktops slide or follow a swipe (Overview.moving).
      live: !!tile.overview && tile.overview.showsHere && !(tile.service && tile.service.animating) && !tile.overview.moving
        && !tile.peek && !(tile.stays && tile.opacity < 0.01)
    }
  }

  // The macOS selection outline, in the highlight color.
  Rectangle {
    anchors.fill: frame
    anchors.margins: -5
    radius: frame.radius + 5
    color: "transparent"
    border.width: 3
    border.color: tile.overview ? tile.overview.highlight : "#0a84ff"
    opacity: tile.lit ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: 140 } }
  }

  // App icon, riding on the bottom edge. It's sized from the window, so its
  // size changes as the window travels. It's rasterized once, at its size in
  // the spread, and scaled on the way: IconImage loads an icon at the size it
  // shows, which rendered it again at every size the animation went through.
  Image {
    id: badge
    readonly property bool wanted: !!tile.overview && tile.overview.showIcons && !tile.overview.grouped && !!tile.info && tile.info.icon !== ""
      && !tile.zooms && !tile.stays
    readonly property real size: Math.round(Math.max(26, Math.min(44, frame.width * 0.11)))
    readonly property real restSize: tile.info ? Math.round(Math.max(26, Math.min(44, tile.info.to.w * 0.11))) : size
    source: wanted ? tile.info.icon : ""
    sourceSize: Qt.size(restSize, restSize)
    width: size
    height: size
    fillMode: Image.PreserveAspectFit
    anchors.horizontalCenter: frame.horizontalCenter
    anchors.verticalCenter: frame.bottom
    opacity: wanted && !tile.dragging && !tile.dropping ? tile.smooth(0.55, 1, tile.p) : 0
    visible: opacity > 0.01
    asynchronous: true
  }

  // Its title shows (titlePill): its app's label under the group gives way
  // (Overview), the two would sit on top of each other.
  readonly property bool titleShown: titlePill.wanted

  // Window title, under the window. Grouped by app, windows sit too close for
  // a title under each, and the group's label names the app, so titles show
  // on hover only.
  Glass {
    id: titlePill
    readonly property string titles: tile.overview ? tile.overview.windowTitles : "hover"
    readonly property bool wanted: !!tile.info && tile.title !== "" && !tile.dragging && !tile.dropping && !tile.zooms && !tile.stays
      && ((titles === "always" && !tile.overview.grouped) || (titles !== "never" && tile.active))
    anchors.horizontalCenter: frame.horizontalCenter
    anchors.top: frame.bottom
    anchors.topMargin: badge.visible ? badge.size / 2 + 6 : 10
    width: Math.min(Math.max(frame.width, 200), titleText.implicitWidth + 28)
    height: 26
    radius: 13
    style: tile.overview ? tile.overview.glassStyle : "liquid"
    backdrop: tile.overview ? tile.overview.glassBackdrop : null
    backdropIsWindow: true
    opacity: wanted ? tile.smooth(0.7, 1, tile.p) : 0
    // Not even fading out, in a thumbnail opening into the screen.
    visible: opacity > 0.01 && !tile.zooms
    Behavior on opacity { NumberAnimation { duration: 150 } }

    Text {
      id: titleText
      anchors.centerIn: parent
      width: Math.min(implicitWidth, parent.width - 24)
      text: tile.title
      textFormat: Text.PlainText
      elide: Text.ElideRight
      horizontalAlignment: Text.AlignHCenter
      color: Qt.rgba(1, 1, 1, 0.95)
      font.family: tile.overview ? tile.overview.uiFont : ""
      font.pixelSize: 12
      font.weight: Font.Medium
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: frame
    enabled: !!tile.service && tile.service.interactive && !tile.dropping && !tile.leaving && !tile.peek && !tile.stays
    hoverEnabled: true
    acceptedButtons: Qt.LeftButton | Qt.MiddleButton
    cursorShape: tile.dragging ? Qt.ClosedHandCursor : Qt.PointingHandCursor

    property point pressedAt: Qt.point(0, 0)

    onEntered: tile.hoverIn()
    onExited: tile.hoverOut()
    onPressed: function(event) {
      pressedAt = mapToItem(tile.overview.stage, event.x, event.y)
      tile.overview.dragGrab = Qt.point(event.x / Math.max(1, width), event.y / Math.max(1, height))
    }
    onPositionChanged: function(event) {
      if (!pressed || !(event.buttons & Qt.LeftButton)) return
      var at = mapToItem(tile.overview.stage, event.x, event.y)
      if (!tile.dragging && Math.abs(at.x - pressedAt.x) + Math.abs(at.y - pressedAt.y) > 10)
        tile.overview.beginDrag(tile.modelData, at)
      if (tile.dragging) tile.overview.moveDrag(at)
    }
    onReleased: function(event) {
      var at = mapToItem(tile.overview.stage, event.x, event.y)
      if (tile.dragging) {
        tile.overview.endDrag(at)
        return
      }
      if (event.button === Qt.MiddleButton) tile.overview.closeWindow(tile.modelData, "middle")
      else tile.overview.activate(tile.modelData)
    }
    onCanceled: if (tile.dragging) tile.overview.cancelDrag()
  }

  // ---- closing --------------------------------------------------------------------

  function hoverIn() {
    hoverGrace.stop()
    // Brought under a pointer that hasn't moved: not yet (Overview.hoverHeld).
    if (overview.hoverHeld) return
    overview.hoverAddress = modelData
  }

  // The pointer moved: the window it's on takes it now.
  Connections {
    target: tile.overview
    function onHoverHeldChanged() {
      if (!tile.overview.hoverHeld && (mouse.containsMouse || closeMouse.containsMouse)) tile.hoverIn()
    }
  }

  function hoverOut() {
    hoverGrace.restart()
  }

  Timer {
    id: hoverGrace
    interval: 80
    onTriggered: {
      if (!mouse.containsMouse && !closeMouse.containsMouse && tile.overview.hoverAddress === tile.modelData)
        tile.overview.hoverAddress = ""
    }
  }

  // The window fades while its app closes it. An app that asks first (unsaved
  // changes) keeps it open; then the window comes back and its dialog shows up
  // as a window of its own.
  property bool closingOut: false
  property real closeFade: closingOut ? 0.35 : 1
  Behavior on closeFade { NumberAnimation { duration: 180 } }

  function markClosing() {
    closingOut = true
    closeTimeout.restart()
  }

  Timer {
    id: closeTimeout
    interval: 1600
    onTriggered: tile.closingOut = false
  }

  // Close button: top left, where macOS puts it, like the × on desktops.
  Glass {
    id: closeButton
    readonly property bool wanted: !!tile.overview && tile.overview.showCloseButtons && tile.hovered
      && !!tile.service && tile.service.interactive && !tile.dragging && !tile.dropping && !tile.closingOut
    x: -9
    y: -9
    z: 10
    width: 24
    height: 24
    radius: 12
    style: "solid"
    selected: closeMouse.containsMouse
    selectedColor: "#ff5f57"
    selectedStrength: 0.95
    opacity: wanted ? 1 : 0
    visible: opacity > 0.01
    scale: wanted ? 1 : 0.6
    Behavior on opacity { NumberAnimation { duration: 140 } }
    Behavior on scale { NumberAnimation { duration: 180; easing.type: Easing.OutBack } }

    Text {
      anchors.centerIn: parent
      anchors.verticalCenterOffset: -1
      text: "×"
      textFormat: Text.PlainText
      color: closeMouse.containsMouse ? Qt.rgba(0.36, 0.04, 0.02, 1) : "white"
      font.pixelSize: 17
      font.weight: Font.DemiBold
      font.family: tile.overview ? tile.overview.uiFont : ""
    }

    MouseArea {
      id: closeMouse
      anchors.fill: parent
      anchors.margins: -4
      hoverEnabled: true
      enabled: closeButton.wanted
      cursorShape: Qt.PointingHandCursor
      onEntered: tile.hoverIn()
      onExited: tile.hoverOut()
      onClicked: tile.overview.closeWindow(tile.modelData, "button")
    }
  }

  Component.onDestruction: if (overview) overview.unregisterTile(modelData, tile)
}
