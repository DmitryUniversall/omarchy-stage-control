// A window's title bar and border from the screen capture (WindowTile's
// decoration), without the window itself: the capture there is the window as
// it was, and a translucent window showed it through itself. The rounded
// cut is Hyprland's (shadow.glsl's pointInRoundedRect; Copyright (c)
// 2022-2026, vaxerski, BSD-3-Clause: shaders/LICENSE.hyprland).
//
// Build: shaders/build (Qt's qsb). The .qsb next to this file is what loads.
#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 fullSize;          // the capture as drawn, pixels
    vec4 cutout;            // the window in it, pixels: left, top, right, bottom
    float cutoutRadius;     // the window's corners, pixels
    float roundingPower;
};

layout(binding = 1) uniform sampler2D source;

bool inside(vec2 p, vec2 tl, vec2 br, float r) {
    if (p.x < tl.x || p.x > br.x || p.y < tl.y || p.y > br.y)
        return false;
    if (r <= 0.0)
        return true;
    r = min(r, min((br.x - tl.x) * 0.5, (br.y - tl.y) * 0.5));
    vec2 innerTL = tl + vec2(r);
    vec2 innerBR = br - vec2(r);
    if (p.x >= innerTL.x && p.x <= innerBR.x)
        return true;
    if (p.y >= innerTL.y && p.y <= innerBR.y)
        return true;
    vec2 d = vec2(p.x < innerTL.x ? innerTL.x - p.x : p.x - innerBR.x,
                  p.y < innerTL.y ? innerTL.y - p.y : p.y - innerBR.y);
    return pow(pow(d.x, roundingPower) + pow(d.y, roundingPower), 1.0 / roundingPower) <= r;
}

void main() {
    if (inside(fullSize * qt_TexCoord0, cutout.xy, cutout.zw, cutoutRadius)) {
        fragColor = vec4(0.0);
        return;
    }
    fragColor = texture(source, qt_TexCoord0) * qt_Opacity;
}
