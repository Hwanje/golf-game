import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class Ball {
  public mesh: THREE.Group;
  public body: CANNON.Body;
  public strokeCount = 0;

  private readonly RADIUS = 0.18;
  private lastRestPosition: THREE.Vector3;
  private restTimer = 0;
  private readonly REST_THRESHOLD_VEL = 0.06;
  private readonly REST_THRESHOLD_ANG = 0.1;
  private readonly REST_CONFIRM_TIME = 0.4;

  // Cup-sink animation
  private _sinking = false;
  private _sinkComplete = false;
  private _sinkTarget: THREE.Vector3 | null = null;

  constructor(
    private scene: THREE.Scene,
    private world: CANNON.World,
    startPosition: THREE.Vector3,
    public ballMaterial: CANNON.Material,
  ) {
    // ── Visual ──────────────────────────────────────────────────────────────
    this.mesh = new THREE.Group();

    const sphereGeo = new THREE.SphereGeometry(this.RADIUS, 32, 32);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.30,
      metalness: 0.05,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.castShadow = true;
    this.mesh.add(sphere);

    // Equator ring (dimple decoration)
    const ringGeo = new THREE.TorusGeometry(this.RADIUS * 0.62, 0.011, 8, 32);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    this.mesh.add(ring);

    this.scene.add(this.mesh);

    // ── Physics ─────────────────────────────────────────────────────────────
    this.body = new CANNON.Body({
      mass: 0.046,
      material: ballMaterial,
      linearDamping: 0.45,
      angularDamping: 0.55,
    });
    this.body.addShape(new CANNON.Sphere(this.RADIUS));
    this.body.position.set(startPosition.x, startPosition.y, startPosition.z);
    this.body.allowSleep = true;
    this.body.sleepSpeedLimit = 0.05;
    this.body.sleepTimeLimit = 0.5;
    world.addBody(this.body);

    this.lastRestPosition = startPosition.clone();
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  shoot(direction: THREE.Vector3, power: number): void {
    this.body.wakeUp();
    this.restTimer = 0;
    const speed = power * 22;
    this.body.velocity.set(direction.x * speed, 0.28, direction.z * speed);
    this.body.angularVelocity.set(0, 0, 0);
    this.strokeCount++;
  }

  /** Called when ball physically falls into the cup (y < threshold). */
  startSinking(holePos: THREE.Vector3): void {
    if (this._sinking) return;
    this._sinking = true;
    this._sinkComplete = false;
    this._sinkTarget = new THREE.Vector3(holePos.x, -1.2, holePos.z);

    // Freeze physics so we animate the mesh directly
    this.body.type = CANNON.Body.KINEMATIC;
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
  }

  // ── Per-frame update ─────────────────────────────────────────────────────

  update(delta: number): void {
    if (this._sinking && this._sinkTarget) {
      this._updateSink();
      return;
    }

    // Normal sync
    const p = this.body.position;
    const q = this.body.quaternion;
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(q.x, q.y, q.z, q.w);

    if (this.isMoving()) {
      this.restTimer = 0;
    } else {
      this.restTimer += delta;
    }
  }

  private _updateSink(): void {
    const t = this._sinkTarget!;
    const p = this.mesh.position;

    // Slide toward cup centre (XZ) while dropping (Y)
    p.x += (t.x - p.x) * 0.18;
    p.z += (t.z - p.z) * 0.18;
    p.y -= 0.055;

    this.body.position.set(p.x, p.y, p.z);

    // Scale to zero as ball sinks below ground
    const scale = Math.max(0, 1 + p.y * 0.9); // y is negative → scale decreases
    this.mesh.scale.setScalar(scale);

    if (p.y < -1.15) {
      this.mesh.visible = false;
      this._sinkComplete = true;
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  get isSinking(): boolean { return this._sinking; }
  get sinkComplete(): boolean { return this._sinkComplete; }

  isMoving(): boolean {
    const v = this.body.velocity;
    const av = this.body.angularVelocity;
    return (
      Math.abs(v.x) > this.REST_THRESHOLD_VEL ||
      Math.abs(v.y) > this.REST_THRESHOLD_VEL ||
      Math.abs(v.z) > this.REST_THRESHOLD_VEL ||
      Math.abs(av.x) > this.REST_THRESHOLD_ANG ||
      Math.abs(av.z) > this.REST_THRESHOLD_ANG
    );
  }

  isAtRest(): boolean {
    if (this.body.position.y < -0.04) return false; // still falling into cup
    return !this.isMoving() && this.restTimer >= this.REST_CONFIRM_TIME;
  }

  saveRestPosition(): void {
    if (this.body.position.y >= 0) {
      this.lastRestPosition.set(
        this.body.position.x,
        this.body.position.y,
        this.body.position.z,
      );
    }
  }

  resetToLastPosition(penaltyStroke = true): void {
    if (penaltyStroke) this.strokeCount++;
    this._clearSink();
    this.body.type = CANNON.Body.DYNAMIC;
    this.body.position.set(
      this.lastRestPosition.x,
      this.lastRestPosition.y,
      this.lastRestPosition.z,
    );
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.body.wakeUp();
    this.restTimer = 0;
  }

  setPosition(pos: THREE.Vector3): void {
    this._clearSink();
    this.body.type = CANNON.Body.DYNAMIC;
    this.body.position.set(pos.x, pos.y, pos.z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.body.sleep();
    this.restTimer = 0;
    this.strokeCount = 0;
    this.lastRestPosition.copy(pos);
  }

  getPosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.body.position.x,
      this.body.position.y,
      this.body.position.z,
    );
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.world.removeBody(this.body);
  }

  private _clearSink(): void {
    this._sinking = false;
    this._sinkComplete = false;
    this._sinkTarget = null;
    this.mesh.visible = true;
    this.mesh.scale.setScalar(1);
  }
}
