# Kerr black hole

A real-time ray tracer for a **spinning black hole**, running in the browser on WebGPU.
Every pixel follows an exact light path through the curved spacetime of a Kerr black
hole, so the shadow, the photon ring, the lensed accretion disk and its Doppler
asymmetry all come straight out of the physics rather than being painted on.

**[Open the live demo →](https://rodferro.github.io/kerr-black-hole/)**
(needs a WebGPU browser: recent Chrome, Edge or Safari)

## What you're looking at

- **The shadow.** Light that gets too close falls in. With spin, the shadow is
  lopsided: light moving with the rotation can pass much closer before it's captured
  than light moving against it. Slide the spin from 0 to 0.998 and watch one side
  flatten.
- **The lensed disk.** The disk is a flat ring in the equatorial plane. Light from its
  far side is bent over and under the hole, which is why you see the disk "wrap"
  above and below the shadow.
- **The photon ring.** The thin bright ring hugging the shadow is light that circled
  the hole once or more before escaping.
- **Doppler beaming.** Gas on one side moves toward you at a sizeable fraction of
  light speed, so it looks brighter and bluer; the receding side is dimmer and redder.
  Toggle *Doppler & gravitational shift* off to see the disk without it.
- **The ISCO.** The inner edge of the disk is the innermost stable circular orbit,
  which moves from 6 M (no spin) down toward 1 M as the spin approaches its maximum, or
  out to 9 M for a disk rotating against the spin (negative values on the slider).

Turn on *Grid sky* to replace the stars with a latitude/longitude grid, which makes the
lensing distortion easy to follow.

## How it works

Units are geometrized: G = c = M = 1, so distances are in units of the hole's mass
(for Sagittarius A*, 1 M ≈ 6.4 million km).

1. **Camera.** The camera sits at rest in the local *zero-angular-momentum frame* at
   radius r and angle θ from the spin axis. Each pixel's viewing direction becomes an
   initial photon momentum using the frame transformation from James et al. (2015), the
   paper behind the black hole in *Interstellar*.
2. **Geodesics.** Photons are traced backward with the Hamiltonian form of the null
   geodesic equations in Boyer–Lindquist coordinates. Energy and axial angular
   momentum are conserved exactly by construction; the remaining state
   (r, θ, φ, p_r, p_θ) is integrated with classic 4th-order Runge–Kutta.
3. **Adaptive steps.** The step size scales with the distance to the horizon and the
   angular speed, so rays take big steps far away and small ones near the hole.
4. **Disk.** A geometrically thin disk with a Novikov–Thorne-shaped temperature
   profile, from the ISCO outward. Each crossing of the equatorial plane adds emission
   and attenuates the ray, so you can see lensed images through thinner gas.
5. **Redshift.** For gas on circular Keplerian orbits, the frequency shift
   g = E_observed / E_emitted combines Doppler, gravitational and camera-frame effects.
   Observed color uses the shifted temperature g·T, and brightness scales as g⁴.
6. **Display.** The compute pass writes an HDR image at a reduced internal resolution;
   a second pass upscales it, adds a soft glow and applies ACES tone mapping.

The shader lives in [`src/shaders/blackhole.wgsl`](src/shaders/blackhole.wgsl). The
same equations are implemented in TypeScript in
[`src/physics/kerr.ts`](src/physics/kerr.ts), which is what the tests check.

## Tests

`npm test` checks the integrator against known analytic results:

- horizon and ISCO radii for several spins (Bardeen, Press & Teukolsky 1972);
- Schwarzschild capture threshold at impact parameter b = 3√3 M;
- prograde and retrograde capture thresholds for a = 0.9, matching Bardeen's photon
  orbit formulas, which pins down the lopsided shadow;
- camera rays starting exactly on the light cone (H = 0) for any direction and spin;
- the Hamiltonian staying near zero along integrated rays;
- the sign of the disk redshift on the approaching and receding sides.

## Running locally

Requires Node.js 22.18 or newer.

```bash
npm install
npm run dev      # dev server with hot reload
npm test         # physics tests
npm run build    # type-check and production build into dist/
```

Pushes to `main` run the tests and deploy to GitHub Pages
(see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit the camera |
| Scroll / pinch | Move closer or farther |
| Spin | −0.998 to 0.998; negative means the disk rotates against the spin |
| Quality | Trades resolution and step accuracy for frame rate |

## Limitations

- GPU math is 32-bit float (WebGPU has no doubles); the physics tests run in 64-bit.
- The disk is thin and emits as a shifted blackbody; there's no radiative transfer,
  disk thickness or polarization.
- The background sky direction is read off when a ray passes 60 M (or twice the camera
  distance), treating space there as flat.

## References

- J. M. Bardeen, W. H. Press, S. A. Teukolsky, *Rotating black holes: locally nonrotating
  frames, energy extraction, and scalar synchrotron radiation*, ApJ 178, 347 (1972).
- J. M. Bardeen, *Timelike and null geodesics in the Kerr metric*, in *Black Holes*
  (Les Houches, 1973).
- O. James, E. von Tunzelmann, P. Franklin, K. S. Thorne, *Gravitational lensing by
  spinning black holes in astrophysics, and in the movie Interstellar*, Class. Quantum
  Grav. 32, 065001 (2015).
- I. D. Novikov, K. S. Thorne, *Astrophysics of black holes*, in *Black Holes* (Les
  Houches, 1973).

## License

[MIT](LICENSE)
