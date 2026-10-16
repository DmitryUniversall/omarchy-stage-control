// Hyprland's blur, the way Hyprland draws it (src/render/shaders: blur1,
// blur2, blurprepare, blurfinish, gain; Copyright (c) 2022-2026, vaxerski,
// BSD-3-Clause: shaders/LICENSE.hyprland), shared by
// blurdown.frag and blurup.frag through #include. Not a shader of its own:
// shaders/build compiles only the .frag files.

// ---- blurprepare: contrast and a brightness above 1 ------------------------------

vec3 gain(vec3 src, float k) {
    vec3 x = clamp(src, 0.0, 1.0);
    vec3 t = step(0.5, x);
    vec3 y = mix(x, 1.0 - x, t);
    vec3 a = 0.5 * pow(2.0 * y, vec3(k));
    return mix(a, 1.0 - a, t);
}

vec4 blurPrepare(vec4 color, float contrast, float brightness) {
    if (contrast != 1.0)
        color.rgb = gain(color.rgb, contrast);
    color.rgb *= max(1.0, brightness);
    return color;
}

// ---- blur1's vibrancy -----------------------------------------------------------

// see http://alienryderflex.com/hsp.html
const float Pr = 0.299;
const float Pg = 0.587;
const float Pb = 0.114;

// Whether high brightness or high saturation counts more, and how smoothly
// unboosted colors turn boosted.
const float vibrancyA = 0.93;
const float vibrancyB = 0.11;
const float vibrancyC = 0.66;

// http://www.flong.com/archive/texts/code/shapers_circ/
float doubleCircleSigmoid(float x, float a) {
    a = clamp(a, 0.0, 1.0);
    float y = 0.0;
    if (x <= a) {
        y = a - sqrt(a * a - x * x);
    } else {
        y = a + sqrt(pow(1.0 - a, 2.0) - pow(x - 1.0, 2.0));
    }
    return y;
}

vec3 rgb2hsl(vec3 col) {
    float minc  = min(col.r, min(col.g, col.b));
    float maxc  = max(col.r, max(col.g, col.b));
    float delta = maxc - minc;
    float lum = (minc + maxc) * 0.5;
    float sat = 0.0;
    float hue = 0.0;
    if (lum > 0.0 && lum < 1.0) {
        float mul = (lum < 0.5) ? (lum) : (1.0 - lum);
        sat       = delta / (mul * 2.0);
    }
    if (delta > 0.0) {
        vec3 maxcVec = vec3(maxc);
        vec3 masks   = vec3(equal(maxcVec, col)) * vec3(notEqual(maxcVec, vec3(col.g, col.b, col.r)));
        vec3 adds    = vec3(0.0, 2.0, 4.0) + vec3(col.g - col.b, col.b - col.r, col.r - col.g) / delta;
        hue += dot(adds, masks);
        hue /= 6.0;
        if (hue < 0.0)
            hue += 1.0;
    }
    return vec3(hue, sat, lum);
}

vec3 hsl2rgb(vec3 col) {
    const float onethird = 1.0 / 3.0;
    const float twothird = 2.0 / 3.0;
    const float rcpsixth = 6.0;
    float hue = col.x;
    float sat = col.y;
    float lum = col.z;
    vec3 xt = vec3(0.0);
    if (hue < onethird) {
        xt.r = rcpsixth * (onethird - hue);
        xt.g = rcpsixth * hue;
        xt.b = 0.0;
    } else if (hue < twothird) {
        xt.r = 0.0;
        xt.g = rcpsixth * (twothird - hue);
        xt.b = rcpsixth * (hue - onethird);
    } else
        xt = vec3(rcpsixth * (hue - twothird), 0.0, rcpsixth * (1.0 - hue));
    xt = min(xt, 1.0);
    float sat2   = 2.0 * sat;
    float satinv = 1.0 - sat;
    float luminv = 1.0 - lum;
    float lum2m1 = (2.0 * lum) - 1.0;
    vec3  ct     = (sat2 * xt) + satinv;
    vec3  rgb;
    if (lum >= 0.5)
        rgb = (luminv * ct) + lum2m1;
    else
        rgb = lum * ct;
    return rgb;
}

vec4 vibrant(vec4 color, float vibrancy, float vibrancyDarkness, float passes) {
    if (vibrancy == 0.0)
        return color;
    float darkness1 = 1.0 - vibrancyDarkness;
    vec3 hsl = rgb2hsl(color.rgb);
    float perceivedBrightness = doubleCircleSigmoid(sqrt(color.r * color.r * Pr + color.g * color.g * Pg + color.b * color.b * Pb), 0.8 * darkness1);
    float b1 = vibrancyB * darkness1;
    float boostBase = hsl[1] > 0.0 ? smoothstep(b1 - vibrancyC * 0.5, b1 + vibrancyC * 0.5,
        1.0 - (pow(1.0 - hsl[1] * cos(vibrancyA), 2.0) + pow(1.0 - perceivedBrightness * sin(vibrancyA), 2.0))) : 0.0;
    float saturation = clamp(hsl[1] + (boostBase * vibrancy) / passes, 0.0, 1.0);
    return vec4(hsl2rgb(vec3(hsl[0], saturation, hsl[2])), color[3]);
}

// ---- blurfinish: noise and a brightness below 1 ---------------------------------

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 1689.1984);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec4 blurFinish(vec4 color, vec2 uv, float noise, float brightness) {
    color.rgb += (hash(uv) - 0.5) * noise;
    color.rgb *= min(1.0, brightness);
    return color;
}
