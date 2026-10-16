import QtQuick

// The wallpaper blurred the way Hyprland blurs what's behind a window: what
// a translucent window (a terminal at 55%, a translucent browser theme)
// shows through it. With new_optimizations, Hyprland's default, a window
// tiled on its desktop is blurred over the wallpaper alone, once, like this.
// It's made the way Hyprland makes it (OpenGL.cpp,
// blurFramebufferWithDamage), from Hyprland's own settings
// (decoration:blur:*, Service.looks), at the display's own pixels: so a
// window that lands where it is looks, at the end of the stage's animation,
// the way Hyprland then draws it. (It was the stage's own blur, softer,
// brighter and at half the size: the picture sharpened the moment the stage
// was gone.)
//
// Hyprland's steps: blurprepare, `passes` steps down to half the size, as
// many back up, blurfinish. Here the first step down reads the wallpaper
// through blurprepare and the last step up adds blurfinish; each step is a
// layer. They're drawn once per wallpaper and settings: nothing moves in
// them.
Item {
  id: hyprBlur

  property var source: null           // the wallpaper (an Image)
  property vector4d crop: Qt.vector4d(0, 0, 1, 1)   // the part of it on screen
  property var config: null           // Service.looks.blur
  property size pixels: Qt.size(1, 1) // the display's size, in its pixels

  readonly property bool blurs: !!config && config.enabled === true && !!source
  readonly property int passes: blurs ? Math.max(1, Math.min(8, Math.round(config.passes))) : 0
  readonly property real radius: blurs ? Math.max(0, config.size) : 0
  readonly property int pixelWidth: Math.max(1, Math.round(pixels.width))
  readonly property int pixelHeight: Math.max(1, Math.round(pixels.height))

  // The blur, at the display's size: null while there's none (blur off).
  readonly property var texture: passes > 0 && ups.length === passes ? (ups[0] || null) : null

  // The steps as they're made, by index: down 0 is level 1 (half size), up 0
  // the last one, at full size.
  property var downs: []
  property var ups: []

  function levelWidth(level) { return Math.max(1, Math.round(pixelWidth / Math.pow(2, level))) }
  function levelHeight(level) { return Math.max(1, Math.round(pixelHeight / Math.pow(2, level))) }

  Repeater {
    model: hyprBlur.passes
    onItemAdded: function(index, item) {
      var next = hyprBlur.downs.slice()
      next[index] = item
      hyprBlur.downs = next
    }
    onItemRemoved: function(index, item) {
      var next = hyprBlur.downs.slice()
      if (next[index] === item) next[index] = null
      hyprBlur.downs = next
    }

    delegate: ShaderEffectSource {
      id: down
      required property int index
      readonly property int level: index + 1
      // The first step reads the wallpaper, the others the step before.
      readonly property var input: index === 0 ? hyprBlur.source : (hyprBlur.downs[index - 1] || null)
      readonly property real inputWidth: index === 0 ? hyprBlur.pixelWidth : hyprBlur.levelWidth(index)
      readonly property real inputHeight: index === 0 ? hyprBlur.pixelHeight : hyprBlur.levelHeight(index)
      width: 1
      height: 1
      visible: false
      hideSource: true
      smooth: true
      textureSize: Qt.size(hyprBlur.levelWidth(level), hyprBlur.levelHeight(level))
      sourceItem: input ? pass : null

      ShaderEffect {
        id: pass
        width: down.textureSize.width
        height: down.textureSize.height
        visible: false
        property var source: down.input
        property vector2d offset: Qt.vector2d(hyprBlur.radius / down.inputWidth, hyprBlur.radius / down.inputHeight)
        property vector4d crop: down.index === 0 ? hyprBlur.crop : Qt.vector4d(0, 0, 1, 1)
        property real prepare: down.index === 0 ? 1 : 0
        property real contrast: hyprBlur.config ? hyprBlur.config.contrast : 1
        property real brightness: hyprBlur.config ? hyprBlur.config.brightness : 1
        property real passes: hyprBlur.passes
        property real vibrancy: hyprBlur.config ? hyprBlur.config.vibrancy : 0
        property real vibrancyDarkness: hyprBlur.config ? hyprBlur.config.vibrancyDarkness : 0
        fragmentShader: Qt.resolvedUrl("shaders/blurdown.frag.qsb")
      }
    }
  }

  Repeater {
    model: hyprBlur.passes
    onItemAdded: function(index, item) {
      var next = hyprBlur.ups.slice()
      next[index] = item
      hyprBlur.ups = next
    }
    onItemRemoved: function(index, item) {
      var next = hyprBlur.ups.slice()
      if (next[index] === item) next[index] = null
      hyprBlur.ups = next
    }

    // Up `index` makes level `index` from the level above it: the last step
    // down, then the step up before this one.
    delegate: ShaderEffectSource {
      id: up
      required property int index
      readonly property int level: index
      readonly property var input: index === hyprBlur.passes - 1 ? (hyprBlur.downs[hyprBlur.passes - 1] || null)
        : (hyprBlur.ups[index + 1] || null)
      width: 1
      height: 1
      visible: false
      hideSource: true
      smooth: true
      textureSize: Qt.size(hyprBlur.levelWidth(level), hyprBlur.levelHeight(level))
      sourceItem: input ? pass : null

      ShaderEffect {
        id: pass
        width: up.textureSize.width
        height: up.textureSize.height
        visible: false
        property var source: up.input
        // Hyprland's halfpixel * radius: a quarter of the radius in pixels
        // of the level read.
        property vector2d offset: Qt.vector2d(hyprBlur.radius / 4 / hyprBlur.levelWidth(up.level + 1),
                                              hyprBlur.radius / 4 / hyprBlur.levelHeight(up.level + 1))
        property real finish: up.index === 0 ? 1 : 0
        property real noise: hyprBlur.config ? hyprBlur.config.noise : 0
        property real brightness: hyprBlur.config ? hyprBlur.config.brightness : 1
        fragmentShader: Qt.resolvedUrl("shaders/blurup.frag.qsb")
      }
    }
  }
}
