/**
 * Orbit camera around the black hole: drag to change the viewing angle,
 * scroll or pinch to change distance. θ is measured from the spin axis.
 */
export class OrbitCamera {
  r = 30;
  theta = 1.47;
  phi = 0;
  minR = 4;
  maxR = 150;

  /** True while the user is dragging or has scrolled very recently. */
  get interacting(): boolean {
    return this.pointers.size > 0 || performance.now() - this.lastWheel < 250;
  }

  /** Incremented on every change, so callers can tell when to re-render. */
  version = 0;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private lastWheel = -Infinity;
  private pinchDistance = 0;

  private readonly element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointercancel', this.onUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
  }

  setDistance(r: number): void {
    this.r = Math.min(this.maxR, Math.max(this.minR, r));
    this.version++;
  }

  private onDown = (e: PointerEvent) => {
    this.element.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinchDistance();
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      const speed = 0.005;
      this.phi -= dx * speed;
      this.theta = Math.min(Math.PI - 0.02, Math.max(0.02, this.theta - dy * speed));
      this.version++;
    } else if (this.pointers.size === 2) {
      const d = this.currentPinchDistance();
      if (this.pinchDistance > 0 && d > 0) this.setDistance(this.r * (this.pinchDistance / d));
      this.pinchDistance = d;
    }
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.pinchDistance = 0;
    this.version++; // re-render at full quality once the drag ends
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.lastWheel = performance.now();
    this.setDistance(this.r * Math.exp(e.deltaY * 0.001));
  };

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
