// An edge of the screen capture (the top bar, Overview.qml) drawn as part of
// a desktop opening from its thumbnail: cut to the desktop's rounded corners
// (zoomCard, card.frag) where it runs into them.
//
// Build: shaders/build (Qt's qsb). The .qsb next to this file is what loads.
#version 440
#extension GL_GOOGLE_include_directive : require

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 rectSize;      // the strip as drawn, in pixels
    vec4 card;          // the desktop it's part of, in the same pixels from the strip's corner (x, y, w, h)
    float radius;       // the desktop's corner radius, in the same pixels
};

layout(binding = 1) uniform sampler2D source;

#include "roundrect.glsl"

void main() {
    vec2 half_size = card.zw * 0.5;
    vec2 p = qt_TexCoord0 * rectSize - card.xy - half_size;
    float r = clamp(radius, 0.0, min(half_size.x, half_size.y));
    float coverage = edgeCoverage(roundBox(p, half_size, r));
    fragColor = texture(source, qt_TexCoord0) * coverage * qt_Opacity;
}
