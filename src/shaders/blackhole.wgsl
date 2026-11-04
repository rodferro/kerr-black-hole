// Kerr black hole ray tracer.
//
// Units: G = c = M = 1. Boyer–Lindquist coordinates (r, θ, φ), spin axis = +z.
// Each pixel traces one photon backward from a camera at rest in the
// zero-angular-momentum frame. The equations are the same as in
// src/physics/kerr.ts, which is covered by tests.

struct Params {
  camR: f32,
  camTheta: f32,
  camPhi: f32,
  spin: f32,

  rPlus: f32,
  rIsco: f32,
  rOut: f32,
  time: f32,

  tanHalfFov: f32,
  exposure: f32,
  stepScale: f32,
  diskTemp: f32,

  maxSteps: u32,
  flags: u32,     // bit 0: disk, bit 1: grid sky, bit 2: Doppler + gravitational shift
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> u: Params;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;

const PI: f32 = 3.14159265;
const MIN_SIN: f32 = 1e-4;
const FLAG_DISK: u32 = 1u;
const FLAG_GRID: u32 = 2u;
const FLAG_SHIFT: u32 = 4u;

struct State {
  r: f32,
  th: f32,
  ph: f32,
  pr: f32,
  pth: f32,
}

// ---------------------------------------------------------------- geodesics

fn safeSin(th: f32) -> f32 {
  let s = sin(th);
  return select(-1.0, 1.0, s >= 0.0) * max(abs(s), MIN_SIN);
}

fn deriv(s: State, a: f32, L: f32) -> State {
  let c = cos(s.th);
  let sn = safeSin(s.th);
  let s2 = sn * sn;
  let sigma = s.r * s.r + a * a * c * c;
  let delta = s.r * s.r - 2.0 * s.r + a * a;
  let dDelta = 2.0 * s.r - 2.0;
  let p = s.r * s.r + a * a - a * L;

  let dFdr = dDelta * s.pr * s.pr - (4.0 * s.r * p * delta - p * p * dDelta) / (delta * delta);
  let dFdth = -2.0 * L * L * c / (s2 * sn) + 2.0 * a * a * sn * c;

  return State(
    delta * s.pr / sigma,
    s.pth / sigma,
    (a * p / delta - a + L / s2) / sigma,
    -dFdr / (2.0 * sigma),
    -dFdth / (2.0 * sigma),
  );
}

fn addScaled(s: State, d: State, h: f32) -> State {
  return State(s.r + h * d.r, s.th + h * d.th, s.ph + h * d.ph, s.pr + h * d.pr, s.pth + h * d.pth);
}

fn rk4(s: State, k1: State, a: f32, L: f32, h: f32) -> State {
  let k2 = deriv(addScaled(s, k1, 0.5 * h), a, L);
  let k3 = deriv(addScaled(s, k2, 0.5 * h), a, L);
  let k4 = deriv(addScaled(s, k3, h), a, L);
  let w = h / 6.0;
  return State(
    s.r + w * (k1.r + 2.0 * k2.r + 2.0 * k3.r + k4.r),
    s.th + w * (k1.th + 2.0 * k2.th + 2.0 * k3.th + k4.th),
    s.ph + w * (k1.ph + 2.0 * k2.ph + 2.0 * k3.ph + k4.ph),
    s.pr + w * (k1.pr + 2.0 * k2.pr + 2.0 * k3.pr + k4.pr),
    s.pth + w * (k1.pth + 2.0 * k2.pth + 2.0 * k3.pth + k4.pth),
  );
}

// ---------------------------------------------------------------- noise

fn pcg3(p: vec3<u32>) -> vec3<u32> {
  var v = p * 1664525u + vec3<u32>(1013904223u);
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v = v ^ (v >> vec3<u32>(16u));
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

fn hash33(cell: vec3<f32>) -> vec3<f32> {
  let h = pcg3(bitcast<vec3<u32>>(vec3<i32>(cell)));
  return vec3<f32>(h) * (1.0 / 4294967296.0);
}

fn valueNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let n000 = hash33(i).x;
  let n100 = hash33(i + vec3<f32>(1.0, 0.0, 0.0)).x;
  let n010 = hash33(i + vec3<f32>(0.0, 1.0, 0.0)).x;
  let n110 = hash33(i + vec3<f32>(1.0, 1.0, 0.0)).x;
  let n001 = hash33(i + vec3<f32>(0.0, 0.0, 1.0)).x;
  let n101 = hash33(i + vec3<f32>(1.0, 0.0, 1.0)).x;
  let n011 = hash33(i + vec3<f32>(0.0, 1.0, 1.0)).x;
  let n111 = hash33(i + vec3<f32>(1.0, 1.0, 1.0)).x;
  let x00 = mix(n000, n100, w.x);
  let x10 = mix(n010, n110, w.x);
  let x01 = mix(n001, n101, w.x);
  let x11 = mix(n011, n111, w.x);
  return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z);
}

fn fbm(p: vec3<f32>) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    sum += amp * valueNoise(q);
    q = q * 2.03 + vec3<f32>(1.7, 9.2, 3.1);
    amp *= 0.5;
  }
  return sum;
}

// ---------------------------------------------------------------- color

fn srgbToLinear(c: vec3<f32>) -> vec3<f32> {
  return pow(max(c, vec3<f32>(0.0)), vec3<f32>(2.2));
}

// Approximate color of a blackbody at temperature t (Kelvin), max channel = 1.
fn blackbody(tKelvin: f32) -> vec3<f32> {
  let t = clamp(tKelvin, 1000.0, 40000.0) / 100.0;
  var c: vec3<f32>;
  if (t <= 66.0) {
    c.r = 1.0;
    c.g = clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0);
  } else {
    c.r = clamp(1.29293618606 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
    c.g = clamp(1.12989086089 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  }
  if (t >= 66.0) {
    c.b = 1.0;
  } else if (t <= 19.0) {
    c.b = 0.0;
  } else {
    c.b = clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0);
  }
  return srgbToLinear(c);
}

// ---------------------------------------------------------------- sky

fn starLayer(dir: vec3<f32>, scale: f32, density: f32) -> vec3<f32> {
  let p = dir * scale;
  let cell = floor(p);
  let rnd = hash33(cell);
  if (rnd.z > density) {
    return vec3<f32>(0.0);
  }
  let starPos = cell + 0.15 + 0.7 * hash33(cell + vec3<f32>(17.0, 31.0, 7.0));
  let d = length(p - starPos);
  let core = exp(-d * d * 40.0);
  let temp = mix(3200.0, 12000.0, rnd.x * rnd.x);
  return blackbody(temp) * core * (0.3 + 2.5 * rnd.y * rnd.y);
}

fn starSky(dir: vec3<f32>) -> vec3<f32> {
  var col = starLayer(dir, 90.0, 0.10) + starLayer(dir, 220.0, 0.12) * 0.6 + starLayer(dir, 480.0, 0.15) * 0.35;
  // A faint, dusty galactic band along a tilted great circle.
  let bandNormal = normalize(vec3<f32>(0.3, 0.85, 0.42));
  let b = dot(dir, bandNormal);
  let band = exp(-b * b / 0.025);
  let dust = fbm(dir * 5.0);
  let glow = band * smoothstep(0.35, 0.8, dust);
  col += glow * vec3<f32>(0.035, 0.03, 0.045);
  col *= 1.0 - 0.6 * band * smoothstep(0.55, 0.75, fbm(dir * 11.0 + 4.0));
  return col;
}

fn gridSky(dir: vec3<f32>) -> vec3<f32> {
  let lat = asin(clamp(dir.z, -1.0, 1.0));
  let lon = atan2(dir.y, dir.x);
  let cellsLat = floor(lat / (PI / 18.0));
  let cellsLon = floor(lon / (PI / 18.0));
  let checker = (i32(cellsLat) + i32(cellsLon)) & 1;
  var base = select(vec3<f32>(0.10, 0.12, 0.30), vec3<f32>(0.30, 0.16, 0.06), checker == 1);
  if (dir.z < 0.0) {
    base = base.bgr;
  }
  let gLat = abs(fract(lat / (PI / 18.0) + 0.5) - 0.5);
  let gLon = abs(fract(lon / (PI / 18.0) + 0.5) - 0.5);
  let line = 1.0 - smoothstep(0.0, 0.06, min(gLat, gLon));
  return base * 0.4 + line * vec3<f32>(0.6);
}

fn sky(dir: vec3<f32>) -> vec3<f32> {
  if ((u.flags & FLAG_GRID) != 0u) {
    return gridSky(dir);
  }
  return starSky(dir);
}

// ---------------------------------------------------------------- disk

// Novikov–Thorne-like flux shape: F ∝ r⁻³ (1 − √(r_isco / r)).
fn diskFlux(r: f32) -> f32 {
  return max(1.0 - sqrt(u.rIsco / r), 0.0) / (r * r * r);
}

fn diskEmission(r: f32, ph: f32, a: f32, L: f32, eCam: f32) -> vec4<f32> {
  let rPeak = u.rIsco * 49.0 / 36.0;
  let tRel = pow(diskFlux(r) / diskFlux(rPeak), 0.25);

  var g = 1.0;
  if ((u.flags & FLAG_SHIFT) != 0u) {
    let r32 = pow(r, 1.5);
    let omega = 1.0 / (r32 + a);
    let ut = (r32 + a) / (pow(r, 0.75) * sqrt(max(r32 - 3.0 * sqrt(r) + 2.0 * a, 1e-6)));
    g = eCam / (ut * (1.0 + omega * L));
  }

  // Gas swirling at the local Keplerian rate, so the inner disk visibly outruns the outer.
  let omegaK = 1.0 / (pow(r, 1.5) + a);
  let swirl = ph - omegaK * u.time * 6.0;
  let q = vec3<f32>(log(r) * 9.0, cos(swirl) * 2.5, sin(swirl) * 2.5);
  let turbulence = 0.35 + 1.3 * fbm(q + vec3<f32>(0.0, 0.0, 3.0));

  let edge = smoothstep(u.rIsco, u.rIsco * 1.15, r) * (1.0 - smoothstep(u.rOut * 0.75, u.rOut, r));
  let intensity = pow(g, 4.0) * pow(tRel, 4.0) * turbulence * edge;
  let color = blackbody(u.diskTemp * tRel * g) * intensity * 3.0;
  let opacity = clamp(edge * (0.55 + 0.45 * turbulence), 0.0, 0.97);
  return vec4<f32>(color, opacity);
}

// ---------------------------------------------------------------- main

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = textureDimensions(outTex);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }

  let a = u.spin;
  let aspect = f32(size.x) / f32(size.y);
  let x = (2.0 * (f32(gid.x) + 0.5) / f32(size.x) - 1.0) * u.tanHalfFov * aspect;
  let y = (1.0 - 2.0 * (f32(gid.y) + 0.5) / f32(size.y)) * u.tanHalfFov;
  // Camera looks at the hole (−e_r); screen up is north (−e_θ), screen right is +e_φ.
  let n = normalize(vec3<f32>(-1.0, -y, x));

  // Initial momenta for a zero-angular-momentum observer (James et al. 2015, App. A).
  let r0 = u.camR;
  let th0 = u.camTheta;
  let c0 = cos(th0);
  let s0 = max(abs(sin(th0)), MIN_SIN);
  let sigma0 = r0 * r0 + a * a * c0 * c0;
  let delta0 = r0 * r0 - 2.0 * r0 + a * a;
  let bigA = (r0 * r0 + a * a) * (r0 * r0 + a * a) - a * a * delta0 * s0 * s0;
  let rho = sqrt(sigma0);
  let varpi = sqrt(bigA) * s0 / rho;
  let alpha = rho * sqrt(delta0) / sqrt(bigA);
  let omega = 2.0 * a * r0 / bigA;
  let eCam = 1.0 / (alpha + omega * varpi * n.z);
  let L = eCam * varpi * n.z;

  var s = State(r0, th0, u.camPhi, eCam * rho * n.x / sqrt(delta0), eCam * rho * n.y);

  let rEscape = max(2.0 * r0, 60.0);
  let rStop = u.rPlus * 1.01;
  let diskOn = (u.flags & FLAG_DISK) != 0u;

  var color = vec3<f32>(0.0);
  var transmittance = 1.0;

  for (var i = 0u; i < u.maxSteps; i++) {
    if (s.r < rStop) {
      break; // fell through the horizon
    }
    let d = deriv(s, a, L);
    if (s.r > rEscape && d.r > 0.0) {
      let sn = sin(s.th);
      let cs = cos(s.th);
      let eR = vec3<f32>(sn * cos(s.ph), sn * sin(s.ph), cs);
      let eTh = vec3<f32>(cs * cos(s.ph), cs * sin(s.ph), -sn);
      let ePh = vec3<f32>(-sin(s.ph), cos(s.ph), 0.0);
      let dir = normalize(d.r * eR + s.r * d.th * eTh + s.r * sn * d.ph * ePh);
      color += transmittance * sky(dir);
      break;
    }

    let rate = abs(d.r) / max(s.r - u.rPlus, 1e-4) + abs(d.th) + abs(d.ph) * abs(sin(s.th));
    let h = u.stepScale / (rate + 1e-6);
    let next = rk4(s, d, a, L, h);

    if (diskOn) {
      let cA = cos(s.th);
      let cB = cos(next.th);
      if (cA * cB < 0.0) {
        let t = cA / (cA - cB);
        let rHit = mix(s.r, next.r, t);
        if (rHit > u.rIsco && rHit < u.rOut) {
          let e = diskEmission(rHit, mix(s.ph, next.ph, t), a, L, eCam);
          color += transmittance * e.a * e.rgb;
          transmittance *= 1.0 - e.a;
          if (transmittance < 0.01) {
            break;
          }
        }
      }
    }
    s = next;
  }

  textureStore(outTex, vec2<i32>(gid.xy), vec4<f32>(color, 1.0));
}
