// Rounded: a layer's content clipped to a rounded rectangle, over a
// background color, in one pass (Rounded.qml).
//
// Build: shaders/build (Qt's qsb). The .qsb next to this file is what loads.
#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 rectSize;      // the rectangle as drawn, in pixels
    float radius;       // corner radius, in the same pixels
    vec4 background;    // straight-alpha color under the content
};

layout(binding = 1) uniform sampler2D source;

void main() {
    vec2 half_size = rectSize * 0.5;
    vec2 p = qt_TexCoord0 * rectSize - half_size;
    float r = clamp(radius, 0.0, min(half_size.x, half_size.y));
    vec2 q = abs(p) - half_size + r;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;   // negative inside
    float coverage = clamp(0.5 - d, 0.0, 1.0);

    vec4 content = texture(source, qt_TexCoord0);                  // premultiplied
    vec4 under = vec4(background.rgb * background.a, background.a);
    fragColor = (content + under * (1.0 - content.a)) * coverage * qt_Opacity;
}
