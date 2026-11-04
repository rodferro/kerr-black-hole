import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  horizonRadius,
  iscoRadius,
  equatorialPhotonOrbit,
  criticalImpactParameter,
  hamiltonian,
  cameraRay,
  diskRedshift,
  traceRay,
  incomingEquatorialRay,
} from '../src/physics/kerr.ts';

const close = (actual: number, expected: number, tol: number, msg = '') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg} expected ${expected}, got ${actual}`);

test('horizon radius: Schwarzschild 2M, extremal Kerr 1M', () => {
  close(horizonRadius(0), 2, 1e-12);
  close(horizonRadius(1), 1, 1e-12);
  close(horizonRadius(0.6), 1.8, 1e-12);
});

test('ISCO: 6M for Schwarzschild, ~2.32M prograde and ~8.72M retrograde at a = 0.9', () => {
  close(iscoRadius(0), 6, 1e-9);
  close(iscoRadius(0.9), 2.3209, 1e-3);
  close(iscoRadius(-0.9), 8.7174, 1e-3);
  close(iscoRadius(1), 1, 1e-6);
  close(iscoRadius(-1), 9, 1e-6);
});

test('equatorial photon orbits: 3M for Schwarzschild, 1M/4M for extremal Kerr', () => {
  close(equatorialPhotonOrbit(0, true), 3, 1e-9);
  close(equatorialPhotonOrbit(1, true), 1, 1e-9);
  close(equatorialPhotonOrbit(1, false), 4, 1e-9);
});

test('Schwarzschild capture threshold is b = 3√3', () => {
  const bc = 3 * Math.sqrt(3);
  for (const [b, expected] of [
    [bc - 0.05, 'captured'],
    [bc + 0.05, 'escaped'],
  ] as const) {
    const { state, L } = incomingEquatorialRay(500, 0, b);
    const result = traceRay(state, 0, L);
    assert.equal(result.outcome, expected, `b = ${b}`);
  }
});

test('Kerr a = 0.9: prograde and retrograde capture thresholds match Bardeen', () => {
  const a = 0.9;
  const bPro = criticalImpactParameter(a, equatorialPhotonOrbit(a, true));
  const bRetro = criticalImpactParameter(a, equatorialPhotonOrbit(a, false));
  // The shadow is lopsided: co-rotating light gets much closer before capture.
  assert.ok(bPro > 0 && bPro < 3, `prograde b = ${bPro}`);
  assert.ok(bRetro < -6, `retrograde b = ${bRetro}`);

  const cases: Array<[number, string]> = [
    [bPro - 0.05, 'captured'],
    [bPro + 0.05, 'escaped'],
    [bRetro + 0.05, 'captured'],
    [bRetro - 0.05, 'escaped'],
  ];
  for (const [b, expected] of cases) {
    const { state, L } = incomingEquatorialRay(500, a, b);
    assert.equal(traceRay(state, a, L).outcome, expected, `b = ${b}`);
  }
});

test('camera rays start on the light cone (H = 0) for any direction', () => {
  for (const a of [0, 0.5, 0.998, -0.7]) {
    for (const theta of [0.3, Math.PI / 2, 2.5]) {
      for (const n of [
        [-1, 0, 0],
        [-0.6, 0.48, 0.64],
        [0.2, -0.3, Math.sqrt(1 - 0.04 - 0.09)],
      ] as Array<[number, number, number]>) {
        const r = 12;
        const ray = cameraRay(r, theta, a, n);
        const h = hamiltonian({ r, theta, phi: 0, pr: ray.pr, ptheta: ray.ptheta }, a, ray.L);
        close(h, 0, 1e-10, `a=${a} θ=${theta} n=${n}`);
      }
    }
  }
});

test('integration keeps the Hamiltonian near zero', () => {
  const a = 0.95;
  const r = 15;
  const theta = 1.3;
  for (const n of [
    [-0.95, 0.1, 0.296],
    [-0.9, -0.3, -0.316],
    [-0.98, 0.0, 0.199],
  ] as Array<[number, number, number]>) {
    const len = Math.hypot(...n);
    const dir = n.map((x) => x / len) as [number, number, number];
    const ray = cameraRay(r, theta, a, dir);
    const result = traceRay({ r, theta, phi: 0, pr: ray.pr, ptheta: ray.ptheta }, a, ray.L, { rEscape: 200 });
    assert.notEqual(result.outcome, 'unfinished');
    assert.ok(result.maxHamiltonianDrift < 1e-4, `drift ${result.maxHamiltonianDrift}`);
  }
});

test('disk redshift: the approaching side is blueshifted, the receding side redshifted', () => {
  // Camera far away (eCam ≈ 1), disk seen edge-on so |b| ≈ r. A negative traced L means the
  // physical photon moves in the disk's direction of rotation: emitted by gas moving toward us.
  const approaching = diskRedshift(10, 0.5, -10, 1);
  const receding = diskRedshift(10, 0.5, 10, 1);
  assert.ok(approaching > 1, `approaching g = ${approaching}`);
  assert.ok(receding < 1, `receding g = ${receding}`);
  // Face-on (L = 0) light only has gravitational + transverse redshift: g = 1/u^t < 1.
  const faceOn = diskRedshift(10, 0, 0, 1);
  close(faceOn, Math.sqrt(1 - 3 / 10), 1e-12);
});
