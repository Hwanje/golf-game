import * as THREE from 'three';

export type InputMode = 'touch' | 'desktop';

export interface ShotInput {
  direction: THREE.Vector3;
  power: number; // 0..1
}

export interface DragState {
  start: { x: number; y: number };
  current: { x: number; y: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// InputManager – handles both touch (mobile) and keyboard+mouse (desktop)
// ─────────────────────────────────────────────────────────────────────────────
export class InputManager {
  public mode: InputMode;
  public canShoot = false;

  // Callbacks
  public onShot: ((input: ShotInput) => void) | null = null;
  public onCameraRotate: ((deltaTheta: number, deltaPhi: number) => void) | null = null;
  public onCameraZoom: ((delta: number) => void) | null = null;

  // Drag (shot aiming)
  private drag: DragState | null = null;
  private readonly MAX_DRAG_PX = 160;

  // Two-finger (camera)
  private prevTouchDist = 0;
  private prevTouchMid = { x: 0, y: 0 };

  // Right-click camera drag (desktop)
  private rightDragging = false;
  private prevMouse = { x: 0, y: 0 };

  // Keyboard
  private keys = new Set<string>();
  private _shotAngle = Math.PI; // starts pointing away from camera
  private _chargedPower = 0;
  private _isChargingPower = false;

  constructor(private canvas: HTMLCanvasElement, private camera: THREE.PerspectiveCamera) {
    this.mode = 'ontouchstart' in window || navigator.maxTouchPoints > 0 ? 'touch' : 'desktop';
    this.bindEvents();
    this.showModeHint();
  }

  private showModeHint(): void {
    const el = document.getElementById('hint');
    if (!el) return;
    if (this.mode === 'touch') {
      el.textContent = '한 손가락 드래그: 방향/파워 | 두 손가락: 카메라 회전/줌';
    } else {
      el.textContent = '드래그: 방향/파워 | 우클릭 드래그: 카메라 | 스크롤: 줌 | A/D: 방향 | Space: 파워';
    }
    setTimeout(() => { el.style.opacity = '0'; }, 5000);
  }

  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener('touchstart', this.onTouchStart, { passive: false });
    c.addEventListener('touchmove', this.onTouchMove, { passive: false });
    c.addEventListener('touchend', this.onTouchEnd, { passive: false });

    c.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // ── Touch ──────────────────────────────────────────────────────────────────

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    if (e.touches.length === 1) {
      if (!this.canShoot) return;
      const t = e.touches[0];
      this.drag = { start: { x: t.clientX, y: t.clientY }, current: { x: t.clientX, y: t.clientY } };
    } else if (e.touches.length === 2) {
      this.drag = null;
      this.prevTouchDist = this.touchDist(e.touches);
      this.prevTouchMid = this.touchMid(e.touches);
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    if (e.touches.length === 1 && this.drag) {
      this.drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dist = this.touchDist(e.touches);
      const mid = this.touchMid(e.touches);

      const dTheta = (mid.x - this.prevTouchMid.x) * -0.008;
      const dPhi = (mid.y - this.prevTouchMid.y) * 0.006;
      this.onCameraRotate?.(dTheta, dPhi);

      const zoom = (this.prevTouchDist - dist) * 0.04;
      this.onCameraZoom?.(zoom);

      this.prevTouchDist = dist;
      this.prevTouchMid = mid;
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    if (e.touches.length === 0 && this.drag && this.canShoot) {
      this.fireShot();
    }
    if (e.touches.length < 2) {
      this.drag = null;
    }
  };

  // ── Mouse ──────────────────────────────────────────────────────────────────

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 && this.canShoot) {
      this.drag = { start: { x: e.clientX, y: e.clientY }, current: { x: e.clientX, y: e.clientY } };
    } else if (e.button === 2) {
      this.rightDragging = true;
      this.prevMouse = { x: e.clientX, y: e.clientY };
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.drag && e.buttons === 1) {
      this.drag.current = { x: e.clientX, y: e.clientY };
    }
    if (this.rightDragging) {
      const dx = e.clientX - this.prevMouse.x;
      const dy = e.clientY - this.prevMouse.y;
      this.onCameraRotate?.(-dx * 0.008, dy * 0.006);
      this.prevMouse = { x: e.clientX, y: e.clientY };
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0 && this.drag && this.canShoot) {
      this.fireShot();
      this.drag = null;
    }
    if (e.button === 2) {
      this.rightDragging = false;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.onCameraZoom?.(e.deltaY * 0.01);
  };

  // ── Keyboard ───────────────────────────────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      if (this.canShoot) this._isChargingPower = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === 'Space' && this._isChargingPower) {
      e.preventDefault();
      if (this.canShoot) {
        const dir = new THREE.Vector3(
          Math.sin(this._shotAngle),
          0,
          Math.cos(this._shotAngle),
        );
        this.onShot?.({ direction: dir, power: Math.max(0.1, this._chargedPower) });
      }
      this._isChargingPower = false;
      this._chargedPower = 0;
    }
  };

  // ── Fire ───────────────────────────────────────────────────────────────────

  private fireShot(): void {
    if (!this.drag || !this.canShoot) return;
    const dx = this.drag.current.x - this.drag.start.x;
    const dy = this.drag.current.y - this.drag.start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 8) return; // ignore tiny taps

    const power = Math.min(dist / this.MAX_DRAG_PX, 1);
    const dir = this.screenDragToWorldDir(dx, dy);
    this.onShot?.({ direction: dir, power });
  }

  // Convert screen-space drag vector → world XZ direction (slingshot: opposite of pull)
  private screenDragToWorldDir(dx: number, dy: number): THREE.Vector3 {
    // Camera's XZ-projected axes
    const camFwd = new THREE.Vector3();
    this.camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    camFwd.normalize();

    const camRight = new THREE.Vector3();
    camRight.crossVectors(camFwd, new THREE.Vector3(0, 1, 0)).normalize();

    // drag_world = dx * camRight - dy * camFwd  (screen Y is flipped)
    // shot = -drag_world (slingshot style)
    const world = new THREE.Vector3();
    world.addScaledVector(camRight, -dx);
    world.addScaledVector(camFwd, dy);
    world.y = 0;
    if (world.lengthSq() < 0.0001) world.set(0, 0, -1);
    world.normalize();
    return world;
  }

  // ── Update (per-frame) ─────────────────────────────────────────────────────

  update(delta: number): void {
    if (this.mode !== 'desktop') return;

    // Rotate aim direction
    const rotSpeed = 2.0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) {
      this._shotAngle -= rotSpeed * delta;
    }
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) {
      this._shotAngle += rotSpeed * delta;
    }

    // Camera with arrow keys
    if (this.keys.has('KeyQ')) this.onCameraRotate?.(rotSpeed * delta * 0.5, 0);
    if (this.keys.has('KeyE')) this.onCameraRotate?.(-rotSpeed * delta * 0.5, 0);

    // Charge power
    if (this._isChargingPower && this.canShoot) {
      this._chargedPower = Math.min(1, this._chargedPower + delta * 1.1);
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  getDrag(): DragState | null { return this.drag; }
  getShotAngle(): number { return this._shotAngle; }
  getChargePower(): number { return this._chargedPower; }
  isChargingPower(): boolean { return this._isChargingPower; }

  // World direction from current keyboard shot angle
  getKeyboardShotDir(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this._shotAngle), 0, Math.cos(this._shotAngle));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private touchDist(t: TouchList): number {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private touchMid(t: TouchList): { x: number; y: number } {
    return {
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    };
  }

  destroy(): void {
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
