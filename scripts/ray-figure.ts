/**
 * Draws docs/ray-paths.svg: a bundle of parallel light rays in the equatorial
 * plane of a Kerr black hole, integrated with the same code the tests check.
 *
 *   node scripts/ray-figure.ts > docs/ray-paths.svg
 */
import {
  derivatives,
  equatorialPhotonOrbit,
  horizonRadius,
  incomingEquatorialRay,
  rk4Step,
  stepSize,
} from '../src/physics/kerr.ts';

const a = 0.9;
const x0 = 26; // rays start at x = x0, moving in −x
const view = 13; // half-width of the plot, in M
const size = 640; // plot size, px
const top = 34; // caption bands above and below the plot
const bottom = 50;
const px = (v: number) => ((v + view) / (2 * view)) * size;
const py = (v: number) => top + ((view - v) / (2 * view)) * size;

const rPlus = horizonRadius(a);

function trace(b: number): { points: string; captured: boolean } {
  const start = incomingEquatorialRay(Math.hypot(x0, b), a, b);
  let s = { ...start.state, phi: Math.atan2(b, x0) };
  const pts: string[] = [];
  let last = [Infinity, Infinity];
  for (let i = 0; i < 40000; i++) {
    const x = s.r * Math.cos(s.phi);
    const y = s.r * Math.sin(s.phi);
    const X = px(x);
    const Y = py(y);
    // Keep points inside the plot, one every ~1.5 px: smooth enough, and a small file.
    const inside = Math.abs(x) < view + 0.5 && Math.abs(y) < view + 0.5;
    if (inside && Math.hypot(X - last[0], Y - last[1]) > 1.5) {
      pts.push(`${X.toFixed(1)},${Y.toFixed(1)}`);
      last = [X, Y];
    }
    if (s.r < rPlus * 1.01) return { points: pts.join(' '), captured: true };
    if (s.r > 40 && derivatives(s, a, start.L).dr > 0) break;
    s = rk4Step(s, a, start.L, stepSize(s, a, start.L, rPlus, 0.01));
  }
  return { points: pts.join(' '), captured: false };
}

const rays: string[] = [];
for (let b = -9; b <= 9.001; b += 0.6) {
  const { points, captured } = trace(b);
  rays.push(`<polyline class="${captured ? 'cap' : 'esc'}" points="${points}"/>`);
}

const circle = (r: number, cls: string) =>
  `<circle class="${cls}" cx="${px(0)}" cy="${py(0)}" r="${((r / (2 * view)) * size).toFixed(2)}"/>`;

const rPro = equatorialPhotonOrbit(a, true);
const rRetro = equatorialPhotonOrbit(a, false);

process.stdout.write(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + top + bottom}" width="${size}" height="${size + top + bottom}" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="13">
<style>
  .esc { fill: none; stroke: #4f86c6; stroke-width: 1.1; }
  .cap { fill: none; stroke: #e0802b; stroke-width: 1.1; }
  .orbit { fill: none; stroke: #8b949e; stroke-width: 1; stroke-dasharray: 4 4; }
  .hole { fill: #000; stroke: #8b949e; stroke-width: 1; }
  text { fill: #8b949e; }
</style>
<clipPath id="frame"><rect y="${top}" width="${size}" height="${size}"/></clipPath>
<g clip-path="url(#frame)">
${rays.join('\n')}
${circle(rRetro, 'orbit')}
${circle(rPro, 'orbit')}
${circle(rPlus, 'hole')}
</g>
<text x="0" y="20">Kerr a = 0.9, equatorial plane, seen from above (spin counter-clockwise)</text>
<text x="0" y="${top + size + 20}"><tspan fill="#e0802b">captured</tspan> · <tspan fill="#4f86c6">escaped</tspan> · dashed: photon orbits at ${rPro.toFixed(2)} M (prograde) and ${rRetro.toFixed(2)} M (retrograde)</text>
<text x="0" y="${top + size + 40}">Light arrives from the right. Above the hole it moves with the spin and can pass much closer.</text>
</svg>
`);
