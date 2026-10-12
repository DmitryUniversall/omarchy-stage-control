import QtQuick

// Content clipped to a rounded rectangle over a background color, drawn in
// one pass (shaders/rounded.frag). Quickshell's ClippingRectangle renders two
// layers at its own size, a mask and the content, so a window preview that
// changes size on every frame of the opening animation reallocated and redrew
// both on every frame. This renders only the content, laid out at
// contentWidth x contentHeight, and scales the result to fill the item: give
// it a fixed content size and the layer is redrawn only when the content
// itself changes.
Item {
  id: rounded

  property real radius: 0
  property color color: "transparent"
  // The size the content is laid out and rendered at.
  property real contentWidth: width
  property real contentHeight: height

  default property alias data: content.data
  // The content as rendered, before the corners are cut: a texture anything
  // else can show without rendering it again.
  readonly property alias contentLayer: content

  Item {
    id: content
    width: Math.max(1, rounded.contentWidth)
    height: Math.max(1, rounded.contentHeight)
    transform: Scale {
      xScale: rounded.width / content.width
      yScale: rounded.height / content.height
    }

    layer.enabled: true
    layer.smooth: true
    layer.effect: ShaderEffect {
      property size rectSize: Qt.size(rounded.width, rounded.height)
      property real radius: rounded.radius
      property vector4d background: Qt.vector4d(rounded.color.r, rounded.color.g, rounded.color.b, rounded.color.a)
      fragmentShader: Qt.resolvedUrl("shaders/rounded.frag.qsb")
    }
  }
}
