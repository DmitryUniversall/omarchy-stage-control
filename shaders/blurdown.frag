// One step down of Hyprland's blur (HyprBlur.qml): half the size, from five
// samples, `radius` source pixels apart, with Hyprland's vibrancy. The first
// step reads the wallpaper as the screen shows it, through blurprepare.
//
// Build: shaders/build (Qt's qsb). The .qsb next to this file is what loads.
#version 440
#extension GL_GOOGLE_include_directive : require

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 offset;            // `radius` source pixels, in the source's 0..1 coordinates
    vec4 crop;              // where the source's 0..1 lies in its texture (x, y, w, h)
    float prepare;          // 1 on the first step: Hyprland's blurprepare
    float contrast;
    float brightness;
    float passes;
    float vibrancy;
    float vibrancyDarkness;
};

layout(binding = 1) uniform sampler2D source;

#include "hyprblur.glsl"

vec4 at(vec2 uv) {
    vec4 color = textureLod(source, crop.xy + uv * crop.zw, 0.0);
    return prepare > 0.5 ? blurPrepare(color, contrast, brightness) : color;
}

void main() {
    vec2 uv = qt_TexCoord0;
    vec4 sum = at(uv) * 4.0;
    sum += at(uv - offset);
    sum += at(uv + offset);
    sum += at(uv + vec2(offset.x, -offset.y));
    sum += at(uv - vec2(offset.x, -offset.y));
    fragColor = vibrant(sum / 8.0, vibrancy, vibrancyDarkness, passes);
}
