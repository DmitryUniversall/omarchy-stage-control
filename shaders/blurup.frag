// One step up of Hyprland's blur (HyprBlur.qml): twice the size, from eight
// samples around each pixel. The last step, at the screen's size, adds
// Hyprland's blurfinish: its noise and brightness.
//
// Build: shaders/build (Qt's qsb). The .qsb next to this file is what loads.
#version 440
#extension GL_GOOGLE_include_directive : require

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 offset;            // Hyprland's halfpixel * radius: radius / 4 source pixels, 0..1
    float finish;           // 1 on the last step: Hyprland's blurfinish
    float noise;
    float brightness;
};

layout(binding = 1) uniform sampler2D source;

#include "hyprblur.glsl"

void main() {
    vec2 uv = qt_TexCoord0;
    vec2 h = offset;
    vec4 sum = texture(source, uv + vec2(-h.x * 2.0, 0.0));
    sum += texture(source, uv + vec2(-h.x, h.y)) * 2.0;
    sum += texture(source, uv + vec2(0.0, h.y * 2.0));
    sum += texture(source, uv + vec2(h.x, h.y)) * 2.0;
    sum += texture(source, uv + vec2(h.x * 2.0, 0.0));
    sum += texture(source, uv + vec2(h.x, -h.y)) * 2.0;
    sum += texture(source, uv + vec2(0.0, -h.y * 2.0));
    sum += texture(source, uv + vec2(-h.x, -h.y)) * 2.0;
    vec4 color = sum / 12.0;
    fragColor = finish > 0.5 ? blurFinish(color, uv, noise, brightness) : color;
}
