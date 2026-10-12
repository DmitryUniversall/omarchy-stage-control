// The rounded rectangle that glass.frag and rounded.frag cut out, shared by
// both through #include. Not a shader of its own: shaders/build compiles
// only the .frag files.

// Signed distance from p to a rectangle of half_size centered on the
// origin, with corners of radius r: negative inside.
float roundBox(vec2 p, vec2 half_size, float r) {
    vec2 q = abs(p) - half_size + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// How much of the pixel at signed distance d lies inside: a soft edge one
// pixel wide.
float edgeCoverage(float d) {
    return clamp(0.5 - d, 0.0, 1.0);
}
