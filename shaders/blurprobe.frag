// Whether Hyprland blurs what's behind a window (Overview.qml, the blur
// probe). From the screen as it was when the stage appeared, and the
// window's own pixels: where the window lets the desktop through, what was
// behind it is (screen - window) / (1 - window's alpha). That's compared
// with the wallpaper, sharp and blurred the way Hyprland blurs it
// (HyprBlur), point by point; the probe answers in one pixel: the points
// closer to sharp (red), the points closer to blurred (green), out of all
// (384), and how many let the desktop through (blue).
//
// Build: shaders/build (Qt's qsb). The .qsb next to this file is what loads.
#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 area;          // the window on the screen, 0..1 of the screen (x, y, w, h)
    vec4 crop;          // the part of the wallpaper on screen, 0..1 (x, y, w, h)
    float alpha;        // the window's opacity when the screen was captured
    float blurAlpha;    // the blur's under it: the same, or 1 with ignore_opacity
};

layout(binding = 1) uniform sampler2D screenPixels;   // the screen where the window is
layout(binding = 2) uniform sampler2D windowPixels;   // the window's own pixels, premultiplied
layout(binding = 3) uniform sampler2D wallpaper;
layout(binding = 4) uniform sampler2D blurred;     // the wallpaper blurred, screen-sized

// Every read at the texture's own size: in a loop that skips points, a
// texture's size can't be worked out from its neighbors.
vec4 at0(sampler2D tex, vec2 uv) {
    return textureLod(tex, uv, 0.0);
}

void main() {
    float sharpVotes = 0.0;
    float blurredVotes = 0.0;
    float through = 0.0;
    // A grid over the window, clear of its edges (the neighbors' shadows).
    for (int j = 0; j < 16; j++) {
        for (int i = 0; i < 24; i++) {
            vec2 uv = vec2(0.1 + 0.8 * (float(i) + 0.5) / 24.0, 0.1 + 0.8 * (float(j) + 0.5) / 16.0);
            vec4 w = at0(windowPixels, uv);
            // Where it lets enough through to tell.
            if (w.a > 0.85)
                continue;
            through += 1.0;
            // Not by text or anything else drawn there: the window and the
            // screen are sampled a little apart, and there it'd show.
            vec2 near = vec2(0.004);
            float a0 = at0(windowPixels, uv + near).a;
            float a1 = at0(windowPixels, uv - near).a;
            float a2 = at0(windowPixels, uv + vec2(near.x, -near.y)).a;
            float a3 = at0(windowPixels, uv - vec2(near.x, -near.y)).a;
            if (max(max(abs(a0 - w.a), abs(a1 - w.a)), max(abs(a2 - w.a), abs(a3 - w.a))) > 0.02)
                continue;
            vec2 at = area.xy + uv * area.zw;
            vec3 sharp = at0(wallpaper, crop.xy + at * crop.zw).rgb;
            vec3 blur = at0(blurred, at).rgb * blurAlpha + sharp * (1.0 - blurAlpha);
            // Where the wallpaper looks the same either way, no telling.
            if (dot(abs(sharp - blur), vec3(1.0 / 3.0)) < 0.02)
                continue;
            vec3 s = at0(screenPixels, uv).rgb;
            vec3 behind = (s - w.rgb * alpha) / max(1.0 - w.a * alpha, 0.05);
            if (dot(abs(behind - sharp), vec3(1.0)) < dot(abs(behind - blur), vec3(1.0)))
                sharpVotes += 1.0;
            else
                blurredVotes += 1.0;
        }
    }
    fragColor = vec4(sharpVotes / 384.0, blurredVotes / 384.0, through / 384.0, 1.0);
}
