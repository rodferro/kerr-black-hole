/**
 * Kerr black hole physics in geometrized units (G = c = M = 1).
 *
 * Coordinates are Boyer–Lindquist (t, r, θ, φ). Photons are traced with the
 * Hamiltonian formulation of the null geodesic equations, normalized so the
 * photon energy at infinity is E = 1. The conserved axial angular momentum is
 * L = p_φ, and the remaining state is (r, θ, φ, p_r, p_θ).
 *
 * This file is the CPU reference implementation. The WGSL shader in
 * src/shaders/blackhole.wgsl uses the same equations, and the tests in
 * test/ check this file against known analytic results.
 */

export interface RayState {
  r: number;
  theta: number;
  phi: number;
  pr: number;
  ptheta: number;
}

export interface Derivatives {
  dr: number;
  dtheta: number;
  dphi: number;
  dpr: number;
  dptheta: number;
}

/** Smallest |sin θ| allowed, to keep the polar terms finite. */
const MIN_SIN = 1e-4;

/** Outer event horizon radius r₊ = 1 + √(1 − a²). */
export function horizonRadius(a: number): number {
  return 1 + Math.sqrt(1 - a * a);
}

/**
 * Innermost stable circular orbit for a disk rotating in the +φ direction.
 * Positive spin means the disk is prograde, negative spin retrograde
 * (Bardeen, Press & Teukolsky 1972).
 */
export function iscoRadius(a: number): number {
  const s = Math.abs(a);
  const z1 = 1 + Math.cbrt(1 - s * s) * (Math.cbrt(1 + s) + Math.cbrt(1 - s));
  const z2 = Math.sqrt(3 * s * s + z1 * z1);
  const root = Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  return a >= 0 ? 3 + z2 - root : 3 + z2 + root;
}

/**
 * Radius of the circular photon orbit in the equatorial plane.
 * prograde = true gives the orbit co-rotating with the hole.
 */
export function equatorialPhotonOrbit(a: number, prograde: boolean): number {
  const s = prograde ? -Math.abs(a) : Math.abs(a);
  return 2 * (1 + Math.cos((2 / 3) * Math.acos(s)));
}

/**
 * Critical impact parameter b = L/E of the equatorial photon orbit at radius r
 * (Bardeen 1973). Rays with |b| closer to zero than this are captured.
 */
export function criticalImpactParameter(a: number, r: number): number {
  if (Math.abs(a) < 1e-9) return 3 * Math.sqrt(3); // Schwarzschild; sign is up to the caller
  return -(r ** 3 - 3 * r ** 2 + a * a * r + a * a) / (a * (r - 1));
}

/** Hamiltonian H = ½ g^{μν} p_μ p_ν with p_t = −1. Zero for a valid photon. */
export function hamiltonian(s: RayState, a: number, L: number): number {
  const { r, theta, pr, ptheta } = s;
  const cos = Math.cos(theta);
  const sin = Math.max(Math.abs(Math.sin(theta)), MIN_SIN);
  const sigma = r * r + a * a * cos * cos;
  const delta = r * r - 2 * r + a * a;
  const P = r * r + a * a - a * L;
  const F =
    delta * pr * pr +
    ptheta * ptheta -
    (P * P) / delta -
    2 * a * L +
    a * a * sin * sin +
    (L * L) / (sin * sin);
  return F / (2 * sigma);
}

/** Right-hand side of Hamilton's equations for a photon with E = 1. */
export function derivatives(s: RayState, a: number, L: number): Derivatives {
  const { r, theta, pr, ptheta } = s;
  const cos = Math.cos(theta);
  const sinRaw = Math.sin(theta);
  const sin = Math.sign(sinRaw || 1) * Math.max(Math.abs(sinRaw), MIN_SIN);
  const sin2 = sin * sin;

  const sigma = r * r + a * a * cos * cos;
  const delta = r * r - 2 * r + a * a;
  const dDelta = 2 * r - 2;
  const P = r * r + a * a - a * L;

  const dFdr =
    dDelta * pr * pr - (4 * r * P * delta - P * P * dDelta) / (delta * delta);
  const dFdtheta =
    -2 * L * L * cos / (sin2 * sin) + 2 * a * a * sin * cos;

  return {
    dr: (delta * pr) / sigma,
    dtheta: ptheta / sigma,
    dphi: ((a * P) / delta - a + L / sin2) / sigma,
    dpr: -dFdr / (2 * sigma),
    dptheta: -dFdtheta / (2 * sigma),
  };
}

function addScaled(s: RayState, d: Derivatives, h: number): RayState {
  return {
    r: s.r + h * d.dr,
    theta: s.theta + h * d.dtheta,
    phi: s.phi + h * d.dphi,
    pr: s.pr + h * d.dpr,
    ptheta: s.ptheta + h * d.dptheta,
  };
}

/** One classic fourth-order Runge–Kutta step of size h. */
export function rk4Step(s: RayState, a: number, L: number, h: number): RayState {
  const k1 = derivatives(s, a, L);
  const k2 = derivatives(addScaled(s, k1, h / 2), a, L);
  const k3 = derivatives(addScaled(s, k2, h / 2), a, L);
  const k4 = derivatives(addScaled(s, k3, h), a, L);
  return {
    r: s.r + (h / 6) * (k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr),
    theta: s.theta + (h / 6) * (k1.dtheta + 2 * k2.dtheta + 2 * k3.dtheta + k4.dtheta),
    phi: s.phi + (h / 6) * (k1.dphi + 2 * k2.dphi + 2 * k3.dphi + k4.dphi),
    pr: s.pr + (h / 6) * (k1.dpr + 2 * k2.dpr + 2 * k3.dpr + k4.dpr),
    ptheta: s.ptheta + (h / 6) * (k1.dptheta + 2 * k2.dptheta + 2 * k3.dptheta + k4.dptheta),
  };
}

/**
 * Adaptive step size: a fixed fraction `scale` of the distance to the horizon
 * and of one radian of angular motion. Large far away, small near the hole.
 */
export function stepSize(s: RayState, a: number, L: number, rPlus: number, scale: number): number {
  const d = derivatives(s, a, L);
  const sin = Math.abs(Math.sin(s.theta));
  const rate =
    Math.abs(d.dr) / Math.max(s.r - rPlus, 1e-6) + Math.abs(d.dtheta) + Math.abs(d.dphi) * sin;
  return scale / (rate + 1e-9);
}

/**
 * Initial photon momentum for a camera at rest in the zero-angular-momentum
 * (ZAMO) frame at (r, θ). n = (n_r, n_θ, n_φ) is a unit direction in that
 * frame. Returns the momenta normalized to E = 1, plus the factor eCam, the
 * photon energy the camera measures (used for redshift).
 * Follows James et al. 2015, "Gravitational lensing by spinning black holes
 * in astrophysics, and in the movie Interstellar", Appendix A.
 */
export function cameraRay(
  r: number,
  theta: number,
  a: number,
  n: [number, number, number],
): { pr: number; ptheta: number; L: number; eCam: number } {
  const cos = Math.cos(theta);
  const sin = Math.max(Math.abs(Math.sin(theta)), MIN_SIN);
  const sigma = r * r + a * a * cos * cos;
  const delta = r * r - 2 * r + a * a;
  const A = (r * r + a * a) ** 2 - a * a * delta * sin * sin;
  const rho = Math.sqrt(sigma);
  const varpi = (Math.sqrt(A) * sin) / rho;
  const alpha = (rho * Math.sqrt(delta)) / Math.sqrt(A);
  const omega = (2 * a * r) / A;
  const eCam = 1 / (alpha + omega * varpi * n[2]);
  return {
    pr: (eCam * rho * n[0]) / Math.sqrt(delta),
    ptheta: eCam * rho * n[1],
    L: eCam * varpi * n[2],
    eCam,
  };
}

/**
 * Redshift factor g = E_observed / E_emitted for light from a Keplerian
 * disk element at radius r, reaching a camera that measures energy eCam for
 * an E = 1 photon. L is the traced ray's angular momentum; the physical photon
 * travels the opposite way, hence the + sign.
 */
export function diskRedshift(r: number, a: number, L: number, eCam: number): number {
  const r32 = r ** 1.5;
  const omega = 1 / (r32 + a);
  const ut = (r32 + a) / (r ** 0.75 * Math.sqrt(r32 - 3 * Math.sqrt(r) + 2 * a));
  return eCam / (ut * (1 + omega * L));
}

export type RayOutcome = 'captured' | 'escaped' | 'unfinished';

/**
 * Integrate a ray until it falls into the horizon or escapes past rEscape.
 * Used by the tests; the shader has its own copy of this loop.
 */
export function traceRay(
  start: RayState,
  a: number,
  L: number,
  opts: { rEscape?: number; maxSteps?: number; scale?: number } = {},
): { outcome: RayOutcome; state: RayState; steps: number; maxHamiltonianDrift: number } {
  const rPlus = horizonRadius(a);
  const rEscape = opts.rEscape ?? 1000;
  const maxSteps = opts.maxSteps ?? 20000;
  const scale = opts.scale ?? 0.02;
  let s = start;
  let drift = 0;
  for (let i = 0; i < maxSteps; i++) {
    if (s.r < rPlus * 1.01) return { outcome: 'captured', state: s, steps: i, maxHamiltonianDrift: drift };
    const d = derivatives(s, a, L);
    if (s.r > rEscape && d.dr > 0) return { outcome: 'escaped', state: s, steps: i, maxHamiltonianDrift: drift };
    s = rk4Step(s, a, L, stepSize(s, a, L, rPlus, scale));
    drift = Math.max(drift, Math.abs(hamiltonian(s, a, L)));
  }
  return { outcome: 'unfinished', state: s, steps: maxSteps, maxHamiltonianDrift: drift };
}

/**
 * State of a photon starting far away in the equatorial plane, moving inward,
 * with impact parameter b (= L for E = 1). p_r comes from H = 0.
 */
export function incomingEquatorialRay(r: number, a: number, b: number): { state: RayState; L: number } {
  const delta = r * r - 2 * r + a * a;
  const P = r * r + a * a - a * b;
  // H = 0 with θ = π/2, p_θ = 0  ⇒  Δ p_r² = P²/Δ + 2ab − a² − b²
  const rhs = (P * P) / delta + 2 * a * b - a * a - b * b;
  const pr = -Math.sqrt(rhs / delta);
  return { state: { r, theta: Math.PI / 2, phi: 0, pr, ptheta: 0 }, L: b };
}
