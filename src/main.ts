import './style.css';
import { OrbitCamera } from './camera.ts';
import { Renderer, WebGPUUnavailableError, type FrameParams } from './renderer.ts';
import { horizonRadius, iscoRadius } from './physics/kerr.ts';

interface Quality {
  scale: number;
  maxSteps: number;
  stepScale: number;
}

const QUALITY: Record<string, Quality> = {
  low: { scale: 0.35, maxSteps: 400, stepScale: 0.06 },
  medium: { scale: 0.55, maxSteps: 700, stepScale: 0.04 },
  high: { scale: 1.0, maxSteps: 1200, stepScale: 0.025 },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('view');
const ui = {
  spin: $<HTMLInputElement>('spin'),
  spinValue: $<HTMLOutputElement>('spin-value'),
  temp: $<HTMLInputElement>('temp'),
  tempValue: $<HTMLOutputElement>('temp-value'),
  exposure: $<HTMLInputElement>('exposure'),
  disk: $<HTMLInputElement>('disk'),
  shift: $<HTMLInputElement>('shift'),
  grid: $<HTMLInputElement>('grid'),
  animate: $<HTMLInputElement>('animate'),
  quality: $<HTMLSelectElement>('quality'),
  stats: $<HTMLElement>('stats'),
  panel: $<HTMLElement>('panel'),
  toggle: $<HTMLButtonElement>('panel-toggle'),
  error: $<HTMLElement>('error'),
};

function showError(title: string, detail: string): void {
  ui.error.hidden = false;
  ui.error.querySelector('h2')!.textContent = title;
  ui.error.querySelector('p')!.textContent = detail;
}

async function start(): Promise<void> {
  let renderer: Renderer;
  try {
    renderer = await Renderer.create(canvas);
  } catch (err) {
    if (err instanceof WebGPUUnavailableError) {
      showError(
        'WebGPU is not available',
        'This simulation needs WebGPU. Try a recent version of Chrome, Edge or Safari, ' +
          'and make sure hardware acceleration is turned on.',
      );
    } else {
      showError('Could not start the renderer', String(err));
    }
    console.error(err);
    return;
  }

  renderer.device.lost.then((info) => {
    if (info.reason !== 'destroyed') showError('The GPU device was lost', info.message);
  });

  const camera = new OrbitCamera(canvas);
  let simTime = 0;
  let lastNow = performance.now();
  let lastRenderedKey = '';
  let busy = false;
  let fpsFrames = 0;
  let fpsSince = performance.now();
  let fps = 0;

  ui.toggle.addEventListener('click', () => {
    const collapsed = ui.panel.classList.toggle('collapsed');
    ui.toggle.setAttribute('aria-expanded', String(!collapsed));
  });

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min((now - lastNow) / 1000, 0.1);
    lastNow = now;

    const animate = ui.animate.checked;
    if (animate) simTime += dt;

    const spin = Number(ui.spin.value);
    const rPlus = horizonRadius(spin);
    const rIsco = iscoRadius(spin);
    camera.minR = rPlus + 1.5;
    if (camera.r < camera.minR) camera.setDistance(camera.minR);

    ui.spinValue.value = spin.toFixed(3);
    ui.tempValue.value = `${Math.round(Number(ui.temp.value))} K`;

    const quality = QUALITY[ui.quality.value] ?? QUALITY.medium;
    const moving = camera.interacting;
    const scale = moving ? Math.min(quality.scale, 0.35) : quality.scale;

    // Skip work when nothing would change: animation off and inputs unchanged.
    const key = [
      camera.version, moving, canvas.width, canvas.height, ui.spin.value, ui.temp.value,
      ui.exposure.value, ui.disk.checked, ui.shift.checked, ui.grid.checked, ui.quality.value,
    ].join('|');
    if ((!animate && key === lastRenderedKey) || busy) return;

    const params: FrameParams = {
      camR: camera.r,
      camTheta: camera.theta,
      camPhi: camera.phi,
      spin,
      rPlus,
      rIsco,
      rOut: Math.max(18, rIsco * 2.5),
      time: simTime,
      fovDegrees: 50,
      exposure: Number(ui.exposure.value),
      glow: 1,
      stepScale: moving ? Math.max(quality.stepScale, 0.05) : quality.stepScale,
      diskTemp: Number(ui.temp.value),
      maxSteps: quality.maxSteps,
      disk: ui.disk.checked,
      gridSky: ui.grid.checked,
      shift: ui.shift.checked,
    };

    // Wait for the GPU before queuing another heavy frame, so input stays responsive.
    busy = true;
    renderer.render(params, canvas.width * scale, canvas.height * scale);
    lastRenderedKey = key;
    renderer.idle().then(() => {
      busy = false;
      fpsFrames++;
      const t = performance.now();
      if (t - fpsSince > 500) {
        fps = (fpsFrames * 1000) / (t - fpsSince);
        fpsFrames = 0;
        fpsSince = t;
      }
      const inclination = (camera.theta * 180) / Math.PI;
      ui.stats.textContent =
        `r₊ ${rPlus.toFixed(3)} M · ISCO ${rIsco.toFixed(2)} M\n` +
        `camera ${camera.r.toFixed(1)} M, ${inclination.toFixed(0)}° from spin axis\n` +
        `${fps.toFixed(0)} fps at ${Math.round(canvas.width * scale)}×${Math.round(canvas.height * scale)}`;
    });
  };
  requestAnimationFrame(frame);
}

start();
