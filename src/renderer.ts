import traceSource from './shaders/blackhole.wgsl?raw';
import presentSource from './shaders/present.wgsl?raw';

export interface FrameParams {
  camR: number;
  camTheta: number;
  camPhi: number;
  spin: number;
  rPlus: number;
  rIsco: number;
  rOut: number;
  time: number;
  fovDegrees: number;
  exposure: number;
  glow: number;
  stepScale: number;
  diskTemp: number;
  maxSteps: number;
  disk: boolean;
  gridSky: boolean;
  shift: boolean;
}

/** Thrown when the browser has no usable WebGPU adapter. */
export class WebGPUUnavailableError extends Error {}

async function checkShader(device: GPUDevice, code: string, label: string): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  for (const m of info.messages) {
    const log = m.type === 'error' ? console.error : console.warn;
    log(`[${label}] ${m.type} at ${m.lineNum}:${m.linePos}: ${m.message}`);
  }
  if (errors.length > 0) {
    throw new Error(`${label} failed to compile: ${errors[0].message} (line ${errors[0].lineNum})`);
  }
  return module;
}

/**
 * Two passes per frame: a compute pass ray-traces the scene into an HDR
 * texture at a reduced internal resolution, then a render pass upscales it to
 * the canvas with tone mapping.
 */
export class Renderer {
  private readonly traceUniforms: GPUBuffer;
  private readonly presentUniforms: GPUBuffer;
  private readonly uniformData = new ArrayBuffer(64);
  private readonly sampler: GPUSampler;
  private hdr: GPUTexture | null = null;
  private traceBind: GPUBindGroup | null = null;
  private presentBind: GPUBindGroup | null = null;

  readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly tracePipeline: GPUComputePipeline;
  private readonly presentPipeline: GPURenderPipeline;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    tracePipeline: GPUComputePipeline,
    presentPipeline: GPURenderPipeline,
  ) {
    this.device = device;
    this.context = context;
    this.tracePipeline = tracePipeline;
    this.presentPipeline = presentPipeline;
    this.traceUniforms = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.presentUniforms = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    if (!('gpu' in navigator)) throw new WebGPUUnavailableError('navigator.gpu is missing');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new WebGPUUnavailableError('No WebGPU adapter available');
    const device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', (e) => {
      console.error('WebGPU error:', (e as GPUUncapturedErrorEvent).error.message);
    });

    const context = canvas.getContext('webgpu');
    if (!context) throw new WebGPUUnavailableError('Could not get a WebGPU canvas context');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const [traceModule, presentModule] = await Promise.all([
      checkShader(device, traceSource, 'blackhole.wgsl'),
      checkShader(device, presentSource, 'present.wgsl'),
    ]);

    const [tracePipeline, presentPipeline] = await Promise.all([
      device.createComputePipelineAsync({
        label: 'trace',
        layout: 'auto',
        compute: { module: traceModule, entryPoint: 'main' },
      }),
      device.createRenderPipelineAsync({
        label: 'present',
        layout: 'auto',
        vertex: { module: presentModule, entryPoint: 'vs' },
        fragment: { module: presentModule, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      }),
    ]);

    return new Renderer(device, context, tracePipeline, presentPipeline);
  }

  /** (Re)create the HDR target when the internal resolution changes. */
  private ensureTarget(width: number, height: number): void {
    if (this.hdr && this.hdr.width === width && this.hdr.height === height) return;
    this.hdr?.destroy();
    this.hdr = this.device.createTexture({
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    const view = this.hdr.createView();
    this.traceBind = this.device.createBindGroup({
      layout: this.tracePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.traceUniforms } },
        { binding: 1, resource: view },
      ],
    });
    this.presentBind = this.device.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.presentUniforms } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: view },
      ],
    });
  }

  render(p: FrameParams, internalWidth: number, internalHeight: number): void {
    const w = Math.max(1, Math.round(internalWidth));
    const h = Math.max(1, Math.round(internalHeight));
    this.ensureTarget(w, h);

    const f = new Float32Array(this.uniformData);
    const u32 = new Uint32Array(this.uniformData);
    f[0] = p.camR;
    f[1] = p.camTheta;
    f[2] = p.camPhi;
    f[3] = p.spin;
    f[4] = p.rPlus;
    f[5] = p.rIsco;
    f[6] = p.rOut;
    f[7] = p.time;
    f[8] = Math.tan((p.fovDegrees * Math.PI) / 360);
    f[9] = p.exposure;
    f[10] = p.stepScale;
    f[11] = p.diskTemp;
    u32[12] = p.maxSteps;
    u32[13] = (p.disk ? 1 : 0) | (p.gridSky ? 2 : 0) | (p.shift ? 4 : 0);
    this.device.queue.writeBuffer(this.traceUniforms, 0, this.uniformData);
    this.device.queue.writeBuffer(this.presentUniforms, 0, new Float32Array([p.exposure, p.glow, 0, 0]));

    const encoder = this.device.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.tracePipeline);
    compute.setBindGroup(0, this.traceBind!);
    compute.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    compute.end();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.presentPipeline);
    pass.setBindGroup(0, this.presentBind!);
    pass.draw(3);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  /** Resolves when the GPU has finished all submitted work. */
  idle(): Promise<void> {
    return this.device.queue.onSubmittedWorkDone();
  }
}
