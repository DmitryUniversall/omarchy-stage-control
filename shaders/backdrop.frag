// Backdrop: the stage's wallpaper, its blur and the dim, in one pass
// (Overview.qml).
//
// It draws what three full-screen layers drew on top of each other before:
// the wallpaper, the blur over it at `blurAmount`, then black at `dim`, each
// faded by the item's opacity the way the scene graph faded them. So the
// result is the same picture, in one pass instead of three.
//
// Build: shaders/build (Qt's qsb). The .qsb next to this file is what loads.
#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 crop;          // the part of the wallpaper on screen, 0..1 (x, y, w, h)
    float blurAmount;   // opacity of the blur over the wallpaper, 0..1
    float dim;          // opacity of the black over both, 0..1
    vec4 edges;         // the screen's edges Hyprland keeps room for, 0..1: top, bottom, left, right
    float edgesOpen;    // how much the real bar shows through them, 0..1
};

layout(binding = 1) uniform sampler2D wallpaper;
layout(binding = 2) uniform sampler2D blurred;    // covers the item, premultiplied

void main() {
    float o = qt_Opacity;
    vec4 color = texture(wallpaper, crop.xy + qt_TexCoord0 * crop.zw) * o;
    vec4 blur = texture(blurred, qt_TexCoord0);
    float a = blurAmount * o;
    color = blur * a + color * (1.0 - a * blur.a);
    float d = dim * o;
    fragColor = color * (1.0 - d) + vec4(0.0, 0.0, 0.0, d);
    // At rest the real top bar (and the like) shows through: see Overview.edgesOpen.
    vec2 uv = qt_TexCoord0;
    if (uv.y < edges.x || uv.y > 1.0 - edges.y || uv.x < edges.z || uv.x > 1.0 - edges.w)
        fragColor *= 1.0 - edgesOpen;
}
