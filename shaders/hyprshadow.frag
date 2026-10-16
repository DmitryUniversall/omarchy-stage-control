// A window's shadow the way Hyprland draws it (src/render/shaders/shadow.glsl
// and CHyprDropShadowDecoration; Copyright (c) 2022-2026, vaxerski,
// BSD-3-Clause: shaders/LICENSE.hyprland): full strength out to `range`
// from the box's edges, falling off by `power`, round at the corners, and
// cut out under the window. WindowTile draws it where the window comes to
// rest, so the shadow doesn't appear only once the stage is gone.
//
// Build: shaders/build (Qt's qsb). The .qsb next to this file is what loads.
#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 fullSize;          // the shadow's box, in display pixels
    float radius;           // the corners of the window with its border, pixels (Hyprland's `round`)
    float range;            // decoration:shadow:range, pixels
    float power;            // decoration:shadow:render_power
    float roundingPower;    // decoration:rounding_power
    float sharp;            // 1 for decoration:shadow:sharp: a plain rounded rectangle
    vec4 color;             // straight alpha
    vec4 cutout;            // the window in the box, pixels: left, top, right, bottom
    float windowRadius;     // the window's own corners, pixels
};

float modifiedLength(vec2 a, float p) {
    return pow(pow(abs(a.x), p) + pow(abs(a.y), p), 1.0 / p);
}

float pixAlphaRoundedDistance(float distanceToCorner, float r, float reach, float shadowPower) {
    if (distanceToCorner > r)
        return 0.0;
    if (distanceToCorner > r - reach)
        return pow((reach - (distanceToCorner - r + reach)) / reach, shadowPower);
    return 1.0;
}

bool pointInRoundedRect(vec2 p, vec2 tl, vec2 br, float r) {
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
    vec2 delta = vec2(p.x < innerTL.x ? innerTL.x - p.x : p.x - innerBR.x,
                      p.y < innerTL.y ? innerTL.y - p.y : p.y - innerBR.y);
    return modifiedLength(delta, roundingPower) <= r;
}

void main() {
    vec2 pixCoord = fullSize * qt_TexCoord0;
    float a = color.a;

    if (sharp > 0.5) {
        if (!pointInRoundedRect(pixCoord, vec2(0.0), fullSize, radius))
            a = 0.0;
    } else {
        float full = range + radius;
        vec2 topLeft = vec2(full);
        vec2 bottomRight = fullSize - vec2(full);
        bool done = false;
        if (pixCoord.x < topLeft.x) {
            if (pixCoord.y < topLeft.y) {
                a *= pixAlphaRoundedDistance(modifiedLength(pixCoord - topLeft, roundingPower), full, range, power);
                done = true;
            } else if (pixCoord.y > bottomRight.y) {
                a *= pixAlphaRoundedDistance(modifiedLength(pixCoord - vec2(topLeft.x, bottomRight.y), roundingPower), full, range, power);
                done = true;
            }
        } else if (pixCoord.x > bottomRight.x) {
            if (pixCoord.y < topLeft.y) {
                a *= pixAlphaRoundedDistance(modifiedLength(pixCoord - vec2(bottomRight.x, topLeft.y), roundingPower), full, range, power);
                done = true;
            } else if (pixCoord.y > bottomRight.y) {
                a *= pixAlphaRoundedDistance(modifiedLength(pixCoord - bottomRight, roundingPower), full, range, power);
                done = true;
            }
        }
        if (!done) {
            float smallest = min(min(pixCoord.y, fullSize.y - pixCoord.y), min(pixCoord.x, fullSize.x - pixCoord.x));
            if (smallest < range)
                a *= pow(smallest / range, power);
        }
    }

    if (pointInRoundedRect(pixCoord, cutout.xy, cutout.zw, windowRadius))
        a = 0.0;

    fragColor = vec4(color.rgb * a, a) * qt_Opacity;
}
