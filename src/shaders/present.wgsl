// Upscales the HDR ray-traced image to the canvas, applies exposure, a soft
// glow, ACES tone mapping and gamma.

struct PresentParams {
  exposure: f32,
  glow: f32,
  _pad0: f32,
  _pad1: f32,
}

@group(0) @binding(0) var<uniform> pp: PresentParams;
@group(0) @binding(1) var hdrSampler: sampler;
@group(0) @binding(2) var hdrTex: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  // One oversized triangle that covers the screen.
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  var out: VsOut;
  out.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(p.x, 1.0 - p.y);
  return out;
}

fn aces(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(hdrTex));
  var col = textureSampleLevel(hdrTex, hdrSampler, in.uv, 0.0).rgb;

  // Cheap glow: a ring of wide taps around the pixel, keeping only the bright part.
  var glow = vec3<f32>(0.0);
  for (var k = 0; k < 12; k++) {
    let ang = f32(k) * 0.5235988;
    for (var j = 1; j <= 3; j++) {
      let off = vec2<f32>(cos(ang), sin(ang)) * texel * f32(j * j) * 2.5;
      let s = textureSampleLevel(hdrTex, hdrSampler, in.uv + off, 0.0).rgb;
      glow += max(s - vec3<f32>(0.6), vec3<f32>(0.0)) / f32(j);
    }
  }
  col += glow * pp.glow / 22.0;

  let mapped = aces(col * pp.exposure);
  return vec4<f32>(pow(mapped, vec3<f32>(1.0 / 2.2)), 1.0);
}
