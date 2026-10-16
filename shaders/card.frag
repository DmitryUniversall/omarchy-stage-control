// A desktop opening from its thumbnail in the Spaces bar (Overview.qml,
// zoomCard): the wallpaper as the screen shows it, scaled into a rounded
// rectangle that grows to the screen.
//
// Build: shaders/build (Qt's qsb). The .qsb next to this file is what loads.
#version 440
#extension GL_GOOGLE_include_directive : require

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 rectSize;      // the card as drawn, in pixels
    float radius;       // corner radius, in the same pixels
    vec4 crop;          // the part of the wallpaper on screen, 0..1 (x, y, w, h)
    vec4 edges;         // the screen's edges Hyprland keeps room for, 0..1 of the screen: top, bottom, left, right
    float edgesOpen;    // how much the real bar shows through them, 0..1
    vec4 place;         // the card on the screen, 0..1 (x, y, w, h)
};

layout(binding = 1) uniform sampler2D wallpaper;

#include "roundrect.glsl"

void main() {
    vec2 half_size = rectSize * 0.5;
    vec2 p = qt_TexCoord0 * rectSize - half_size;
    float r = clamp(radius, 0.0, min(half_size.x, half_size.y));
    float coverage = edgeCoverage(roundBox(p, half_size, r));
    fragColor = texture(wallpaper, crop.xy + qt_TexCoord0 * crop.zw) * coverage * qt_Opacity;
    vec2 at = place.xy + qt_TexCoord0 * place.zw;
    if (at.y < edges.x || at.y > 1.0 - edges.y || at.x < edges.z || at.x > 1.0 - edges.w)
        fragColor *= 1.0 - edgesOpen;
}
