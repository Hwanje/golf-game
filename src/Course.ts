import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export interface HoleData {
  number: number;
  par: number;
  startPosition: THREE.Vector3;
  holePosition: THREE.Vector3;
  description: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

interface SlopeZone {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  fx: number; fz: number;
}

interface RotatingBody {
  body: CANNON.Body;
  mesh: THREE.Object3D;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ─────────────────────────────────────────────────────────────────────────────
// Course
// ─────────────────────────────────────────────────────────────────────────────
export class Course {
  /** Radius at which hole-in is detected (XZ plane). */
  public readonly CUP_DETECT_RADIUS = 0.50;
  /** Ball must be below this Y to count as "fallen into cup". */
  public readonly CUP_DETECT_Y = -0.12;

  public readonly holes: HoleData[] = [
    // W=fairway width, D=fairway depth, all centred at (0,0)
    { number:1, par:2, startPosition:V(0,0.25, 7.0), holePosition:V(0,0,-6.5), description:'직선 코스',      bounds:{minX:-3,  maxX:3,  minZ:-8,  maxZ:8}  },
    { number:2, par:3, startPosition:V(0,0.25, 8.0), holePosition:V(0,0,-7.5), description:'경사 코스',      bounds:{minX:-3.5,maxX:3.5,minZ:-9,  maxZ:9}  },
    { number:3, par:2, startPosition:V(0,0.25, 5.0), holePosition:V(0,0,-5.0), description:'좁은 통로',      bounds:{minX:-2,  maxX:2,  minZ:-6,  maxZ:6}  },
    { number:4, par:3, startPosition:V(0,0.25, 8.0), holePosition:V(0,0,-7.5), description:'경사 도전',      bounds:{minX:-4,  maxX:4,  minZ:-9,  maxZ:9}  },
    { number:5, par:4, startPosition:V(0,0.25,10.0), holePosition:V(0,0,-9.5), description:'회전 장애물',    bounds:{minX:-4.5,maxX:4.5,minZ:-11, maxZ:11} },
    { number:6, par:3, startPosition:V(0,0.25, 8.0), holePosition:V(0,0,-7.5), description:'핀볼 코스',      bounds:{minX:-4.5,maxX:4.5,minZ:-9,  maxZ:9}  },
    { number:7, par:4, startPosition:V(0,0.25,11.0), holePosition:V(0,0,-10.5),description:'이중 회전',      bounds:{minX:-5,  maxX:5,  minZ:-12, maxZ:12} },
    { number:8, par:4, startPosition:V(0,0.25,11.0), holePosition:V(0,0,-10.5),description:'S자 코스',       bounds:{minX:-5,  maxX:5,  minZ:-12, maxZ:12} },
    { number:9, par:3, startPosition:V(0,0.25, 8.0), holePosition:V(0,0,-7.5), description:'최종 도전',      bounds:{minX:-4,  maxX:4,  minZ:-9,  maxZ:9}  },
  ];

  private objects: THREE.Object3D[] = [];
  private bodies: CANNON.Body[] = [];
  private slopeZones: SlopeZone[] = [];
  private rotatingBodies: RotatingBody[] = [];
  private flagGroup: THREE.Group;
  private flagMesh: THREE.Mesh | null = null;
  private flagAnimAngle = 0;
  private currentBounds = this.holes[0].bounds;

  constructor(
    private scene: THREE.Scene,
    private world: CANNON.World,
    public groundMaterial: CANNON.Material,
    public wallMaterial: CANNON.Material,
    public bouncyMaterial: CANNON.Material,
  ) {
    this.flagGroup = new THREE.Group();
    scene.add(this.flagGroup);
  }

  buildHole(index: number): void {
    this.clear();
    this.currentBounds = this.holes[index].bounds;
    switch (index) {
      case 0: this.hole0(); break;
      case 1: this.hole1(); break;
      case 2: this.hole2(); break;
      case 3: this.hole3(); break;
      case 4: this.hole4(); break;
      case 5: this.hole5(); break;
      case 6: this.hole6(); break;
      case 7: this.hole7(); break;
      case 8: this.hole8(); break;
    }
    const h = this.holes[index];
    this.buildCupVisual(h.holePosition);
    this.addStartMarker(h.startPosition);
    this.addHoleLabel(h.number, h.par, h.description);
  }

  // ── Hole designs ─────────────────────────────────────────────────────────

  /** Hole 1 – Par 2 – Straight with a central hill. */
  private hole0(): void {
    const W=6, D=16, hp=this.holes[0].holePosition;
    this.buildEnclosure(0,0,W,D,hp);
    this.addHill(0, 0, 1.8, 0.35, 0x4a8a4a);   // gentle centre bump
  }

  /** Hole 2 – Par 3 – One bumper LEFT + slope zone pushes ball left.
   *  Slope teaches players the slope mechanic for later holes.
   *  Gap RIGHT: x=1.5→3.5 (2 u) | bumper x=-3.5→1.5 (width 5, cx=-1)
   */
  private hole1(): void {
    const W=7, D=18, hp=this.holes[1].holePosition;
    this.buildEnclosure(0,0,W,D,hp);
    this.addObs(-1, 0, 5, 1.2, 0.8, 0x8B6914);            // left bumper, gap right
    // Slope: after bumper, pushes left toward centre
    this.addSlopeZone(-3.5, -0.5, 3.5, -7.5, -0.9, 0);
    this.addSlopeVisual(-3.5, -0.5, 3.5, -7.5, -1, 0, 0x7aaa60);
  }

  /** Hole 3 – Par 2 – Narrow corridor with a hill to thread past. */
  private hole2(): void {
    const W=4, D=12, hp=this.holes[2].holePosition;
    this.buildEnclosure(0,0,W,D,hp);
    this.addHill(0.5, -0.5, 1.4, 0.40, 0x4a8a4a);  // off-centre bump
  }

  /** Hole 4 – Par 3 – Diagonal slope pushes RIGHT, hole stays centre.
   *  Player must aim left to compensate OR bank off the right wall.
   */
  private hole3(): void {
    const W=8, D=18, hp=this.holes[3].holePosition;
    this.buildEnclosure(0,0,W,D,hp);
    this.addSlopeZone(-4, -9, 4, 4, 0.8, 0);
    this.addSlopeVisual(-4, -9, 4, 4, 1, 0, 0x9ab86e);
  }

  /** Hole 5 – Par 4 – Single rotating bar + hill before the bar. */
  private hole4(): void {
    const W=9, D=22, hp=this.holes[4].holePosition;
    this.buildEnclosure(0,0,W,D,hp);
    this.addRotatingBar(0, 0, 7.0, 0.65, 0xCC3333);
    this.addHill(-1.5, 5, 1.6, 0.32, 0x4a8a4a);   // hill on approach
    this.addSlopeVisual(-4.5, -1.5, 4.5, 1.5, 0, 0, 0x6a8a5a);
  }

  /** Hole 6 – Par 3 – Pinball bumpers with hills between them. */
  private hole5(): void {
    const W=9, D=18, hp=this.holes[5].holePosition;
    this.buildEnclosure(0,0,W,D,hp);
    this.addBouncyCylinder( 0,  3,   0.55, 1.1);
    this.addBouncyCylinder(-2, -1,   0.55, 1.1);
    this.addBouncyCylinder( 2, -1,   0.55, 1.1);
    this.addHill( 2.5, 5.5, 1.3, 0.30, 0x4a8a4a);  // approach hill right
    this.addHill(-2.5, 5.5, 1.3, 0.30, 0x4a8a4a);  // approach hill left
  }

  /** Hole 7 – Par 4 – Two rotating bars at different depths + speeds. */
  private hole6(): void {
    const W=10, D=24, hp=this.holes[6].holePosition;
    this.buildEnclosure(0,0,W,D,hp);
    this.addRotatingBar(0,  4, 8.0,  0.60, 0xCC3333);
    this.addRotatingBar(0, -3, 8.0, -0.45, 0x3366CC);
    this.addHill(0, 8, 1.8, 0.34, 0x4a8a4a);  // hill on entry
  }

  /** Hole 8 – Par 4 – S-curve gates with hills between them. */
  private hole7(): void {
    const W=10, D=24, hp=this.holes[7].holePosition;
    this.buildEnclosure(0,0,W,D,hp);
    this.addObs(-2,  6,  6, 1.2, 0.8, 0x4a6e8a);
    this.addObs( 2, -2,  6, 1.2, 0.8, 0x4a6e8a);
    this.addHill( 3,  9, 1.5, 0.30, 0x4a8a4a);  // right side, near first gate
    this.addHill(-3, -5, 1.5, 0.30, 0x4a8a4a);  // left side, near second gate
    this.addSlopeZone(-5, -11, 5, -4, 0.7, 0);
    this.addSlopeVisual(-5, -11, 5, -4, 1, 0, 0x8aaa6a);
  }

  /** Hole 9 – Par 3 – Final: rotating bar + bumpers flanking the cup + a hill. */
  private hole8(): void {
    const W=8, D=18, hp=this.holes[8].holePosition;
    this.buildEnclosure(0,0,W,D,hp);
    this.addRotatingBar(0, 1.5, 6.5, 1.1, 0xDD2222);
    this.addBouncyCylinder(-2.5, -4, 0.5, 1.0);
    this.addBouncyCylinder( 2.5, -4, 0.5, 1.0);
    this.addHill(0, 6, 1.6, 0.36, 0x4a8a4a);  // hill before the bar
  }

  // ── Core builders ─────────────────────────────────────────────────────────

  /**
   * Build an enclosed rectangular fairway with PHYSICAL CUP.
   *
   * Ground is 4 box pieces leaving a (2×GAP)² gap at the cup location.
   * When ball rolls over the gap it physically falls through.
   */
  private buildEnclosure(cx: number, cz: number, W: number, D: number, holePos: THREE.Vector3): void {
    const WT = 0.5;  // wall thickness
    const WH = 1.5;  // wall height (above ground)
    const WD = 0.3;  // wall depth below ground (to seal with ground boxes)

    // ── Ground (split) ─────────────────────────────────────────────────────
    this.buildSplitGround(cx, cz, W, D, holePos.x, holePos.z);

    // ── Visuals (full-width planes – no gap visually, gap is physics-only) ─
    this.addPlane(cx, cz, W+8, D+8, 0x2d4a2d, -0.005);   // rough surround
    this.addFairwayStripes(cx, cz, W, D);

    const wc = 0x7a5c2e;
    // Left wall
    this.addWall(cx - W/2 - WT/2, (WH-WD)/2, cz,          WT,        WH+WD, D+WT*2, wc);
    // Right wall
    this.addWall(cx + W/2 + WT/2, (WH-WD)/2, cz,          WT,        WH+WD, D+WT*2, wc);
    // Near wall (player side)
    this.addWall(cx,               (WH-WD)/2, cz+D/2+WT/2, W+WT*2,   WH+WD, WT,     wc);
    // Far wall
    this.addWall(cx,               (WH-WD)/2, cz-D/2-WT/2, W+WT*2,   WH+WD, WT,     wc);
  }

  /**
   * 4 ground boxes leaving a square gap at (holeX, holeZ).
   * GAP_H = half of gap width. Ball (radius 0.18) falls through 2×GAP > 0.36.
   */
  private buildSplitGround(cx: number, cz: number, W: number, D: number, holeX: number, holeZ: number): void {
    const GAP = 0.48;   // half-gap (gap width = 0.96 > ball diameter 0.36) ✓
    const TH  = 0.30;   // box thickness
    const CY  = -TH/2;  // centre Y (top surface at y=0)

    const L = cx - W/2, R = cx + W/2;
    const NEAR = cz + D/2, FAR = cz - D/2;

    // Piece 1 – player side: from NEAR down to holeZ+GAP (full width)
    const p1bot = holeZ + GAP, p1top = NEAR;
    if (p1top > p1bot)
      this.addGroundBox(cx, CY, (p1top+p1bot)/2, W, TH, p1top-p1bot);

    // Piece 2 – far side: from holeZ-GAP up to FAR (full width)
    const p2top = holeZ - GAP, p2bot = FAR;
    if (p2top > p2bot)
      this.addGroundBox(cx, CY, (p2top+p2bot)/2, W, TH, p2top-p2bot);

    // Piece 3 – left strip beside cup
    const p3r = holeX - GAP, p3l = L;
    if (p3r > p3l)
      this.addGroundBox((p3l+p3r)/2, CY, holeZ, p3r-p3l, TH, 2*GAP);

    // Piece 4 – right strip beside cup
    const p4l = holeX + GAP, p4r = R;
    if (p4r > p4l)
      this.addGroundBox((p4l+p4r)/2, CY, holeZ, p4r-p4l, TH, 2*GAP);
  }

  // ── Element helpers ───────────────────────────────────────────────────────

  /** Ground box – physics only (visual comes from plane geometry). */
  private addGroundBox(x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(sx/2, sy/2, sz/2)));
    body.position.set(x, y, z);
    this.world.addBody(body);
    this.bodies.push(body);
  }

  private addWall(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number): void {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.wallMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(sx/2, sy/2, sz/2)));
    body.position.set(x, y, z);
    this.world.addBody(body);
    this.bodies.push(body);

    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh); this.objects.push(mesh);

    // Golden cap strip
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(sx+0.02, 0.06, sz+0.02),
      new THREE.MeshStandardMaterial({ color: 0xd4a855, roughness: 0.6 }),
    );
    cap.position.set(x, y+sy/2+0.03, z);
    this.scene.add(cap); this.objects.push(cap);
  }

  private addObs(cx: number, cz: number, sx: number, sy: number, sz: number, color: number): void {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.wallMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(sx/2, sy/2, sz/2)));
    body.position.set(cx, sy/2, cz);
    this.world.addBody(body); this.bodies.push(body);

    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.12 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, sy/2, cz);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh); this.objects.push(mesh);

    // White top band
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(sx+0.04, 0.06, sz+0.04),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
    );
    band.position.set(cx, sy+0.03, cz);
    this.scene.add(band); this.objects.push(band);
  }

  /**
   * Rotating bar obstacle – KINEMATIC body so it pushes the ball.
   * The body's angularVelocity is set; Cannon-es integrates the quaternion
   * each step, and we sync the mesh from body.quaternion in update().
   */
  private addRotatingBar(cx: number, cz: number, length: number, speed: number, color: number): void {
    const H = 0.70, THICK = 0.28;

    const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: this.wallMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(length/2, H/2, THICK/2)));
    body.position.set(cx, H/2, cz);
    body.angularVelocity.set(0, speed, 0);
    this.world.addBody(body); this.bodies.push(body);

    const group = new THREE.Group();
    group.position.set(cx, H/2, cz);

    // Bar mesh
    const barMesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, H, THICK),
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 }),
    );
    barMesh.castShadow = true;
    group.add(barMesh);

    // Stripes for visibility
    for (let s = -1; s <= 1; s += 2) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, H+0.01, THICK+0.01),
        new THREE.MeshStandardMaterial({ color: 0xffff00, roughness: 0.5 }),
      );
      stripe.position.x = s * (length/2 - 0.3);
      group.add(stripe);
    }

    // Pivot cylinder
    const pivot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, H+0.1, 12),
      new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 }),
    );
    group.add(pivot);

    this.scene.add(group); this.objects.push(group);
    this.rotatingBodies.push({ body, mesh: group });
  }

  /**
   * Bouncy cylinder bumper – uses bouncyMaterial (high restitution).
   */
  private addBouncyCylinder(cx: number, cz: number, radius: number, height: number): void {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.bouncyMaterial });
    body.addShape(new CANNON.Cylinder(radius, radius, height, 12));
    body.position.set(cx, height/2, cz);
    this.world.addBody(body); this.bodies.push(body);

    // Outer glow ring (emissive)
    const geo = new THREE.CylinderGeometry(radius, radius, height, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xFF6600,
      emissive: 0xFF3300,
      emissiveIntensity: 0.3,
      roughness: 0.25,
      metalness: 0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, height/2, cz);
    mesh.castShadow = true;
    this.scene.add(mesh); this.objects.push(mesh);

    // White band stripe
    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(radius+0.02, radius+0.02, 0.14, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
    );
    stripe.position.set(cx, height/2, cz);
    this.scene.add(stripe); this.objects.push(stripe);
  }

  /**
   * Terrain hill – a dome the ball rolls over.
   * Physics: full CANNON.Sphere mostly buried; only the top cap is above ground.
   * Visual: top hemisphere rendered in a darker green than the fairway.
   *
   * @param cx   centre X
   * @param cz   centre Z
   * @param radius  horizontal spread of the dome (sphere radius)
   * @param height  how high the top of the dome sits above ground (< radius)
   * @param color   grass colour of the dome
   */
  private addHill(cx: number, cz: number, radius: number, height: number, color: number): void {
    const centerY = height - radius; // sphere centre (negative → mostly underground)

    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMaterial });
    body.addShape(new CANNON.Sphere(radius));
    body.position.set(cx, centerY, cz);
    this.world.addBody(body);
    this.bodies.push(body);

    // Top-hemisphere geometry (phiLength = PI/2 → upper cap only)
    const geo = new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, centerY, cz);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  /**
   * Slope zone – stores data; forces applied per-frame via applySlopes().
   */
  private addSlopeZone(minX: number, minZ: number, maxX: number, maxZ: number, fx: number, fz: number): void {
    this.slopeZones.push({ minX, minZ, maxX, maxZ, fx, fz });
  }

  /**
   * Visual overlay for a slope zone – different colour + directional arrows.
   */
  private addSlopeVisual(
    minX: number, minZ: number, maxX: number, maxZ: number,
    fx: number, fz: number, color: number,
  ): void {
    const w = maxX - minX, d = maxZ - minZ;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true, opacity: 0.6 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(cx, 0.004, cz);
    this.scene.add(plane); this.objects.push(plane);

    if (fx !== 0 || fz !== 0) {
      const dir = new THREE.Vector3(fx, 0, fz).normalize();
      const cols = 3, rows = 3;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const ax = minX + (c + 0.5) * (w / cols);
          const az = minZ + (r + 0.5) * (d / rows);
          const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(ax, 0.02, az), 0.8, 0xffcc00, 0.25, 0.2);
          this.scene.add(arrow); this.objects.push(arrow);
        }
      }
    }
  }

  // ── Fairway visuals ───────────────────────────────────────────────────────

  private addFairwayStripes(cx: number, cz: number, W: number, D: number): void {
    const count = Math.round(D / 2);
    const stripeD = D / count;
    for (let i = 0; i < count; i++) {
      const col = i % 2 === 0 ? 0x5a9a5a : 0x62a862;
      const z = cz + D/2 - stripeD * (i + 0.5);
      this.addPlane(cx, z, W, stripeD, col, 0.001 + i * 0.00005);
    }
  }

  private addPlane(cx: number, cz: number, w: number, d: number, color: number, y: number): void {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.82 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, y, cz);
    mesh.receiveShadow = true;
    this.scene.add(mesh); this.objects.push(mesh);
  }

  // ── Cup visual ────────────────────────────────────────────────────────────

  private buildCupVisual(pos: THREE.Vector3): void {
    this.flagGroup.clear();
    this.flagMesh = null;

    // Deep cup cylinder (visible through gap in ground)
    const cupDepth = 1.0;
    const cupR = 0.46;
    const cupGeo = new THREE.CylinderGeometry(cupR, cupR*0.9, cupDepth, 24, 1, true);
    const cupMat = new THREE.MeshStandardMaterial({ color: 0x080808, side: THREE.BackSide, roughness: 1 });
    const cupInner = new THREE.Mesh(cupGeo, cupMat);
    cupInner.position.set(pos.x, -cupDepth/2, pos.z);
    this.flagGroup.add(cupInner);

    // Cup rim circle at ground level
    const rimGeo = new THREE.RingGeometry(cupR, cupR+0.08, 32);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(pos.x, 0.012, pos.z);
    this.flagGroup.add(rim);

    // Cup bottom (dark circle at base)
    const botGeo = new THREE.CircleGeometry(cupR*0.9, 24);
    const botMat = new THREE.MeshStandardMaterial({ color: 0x040404 });
    const bot = new THREE.Mesh(botGeo, botMat);
    bot.rotation.x = -Math.PI / 2;
    bot.position.set(pos.x, -cupDepth+0.01, pos.z);
    this.flagGroup.add(bot);

    // Flag pole
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.7, roughness: 0.3 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8), poleMat);
    pole.position.set(pos.x, 1.2, pos.z);
    pole.castShadow = true;
    this.flagGroup.add(pole);

    // Flag
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xff1a1a, side: THREE.DoubleSide, roughness: 0.9 });
    this.flagMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.44), flagMat);
    this.flagMesh.position.set(pos.x + 0.36, 2.18, pos.z);
    this.flagMesh.castShadow = true;
    this.flagGroup.add(this.flagMesh);
  }

  private addStartMarker(pos: THREE.Vector3): void {
    const tee = new THREE.Mesh(
      new THREE.CircleGeometry(0.44, 32),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }),
    );
    tee.rotation.x = -Math.PI / 2;
    tee.position.set(pos.x, 0.01, pos.z);
    this.scene.add(tee); this.objects.push(tee);

    // Tee arrow
    const arr = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x444444 }),
    );
    arr.rotation.x = -Math.PI / 2;
    arr.position.set(pos.x, 0.015, pos.z - 0.15);
    this.scene.add(arr); this.objects.push(arr);
  }

  private addHoleLabel(number: number, par: number, desc: string): void {
    // Intentionally left as HUD text (handled in ScoreCard)
    void number; void par; void desc;
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────

  update(_delta: number): void {
    // Sync rotating meshes from Cannon kinematic body quaternion
    for (const rot of this.rotatingBodies) {
      const q = rot.body.quaternion;
      rot.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    // Flag wave
    if (this.flagMesh) {
      this.flagAnimAngle += _delta * 2.2;
      this.flagMesh.rotation.y = Math.sin(this.flagAnimAngle) * 0.13;
    }
  }

  /**
   * Apply slope-zone forces to the ball's Cannon body each frame.
   * Call from main.ts game loop: course.applySlopes(ball.body)
   */
  applySlopes(ballBody: CANNON.Body): void {
    const p = ballBody.position;
    for (const z of this.slopeZones) {
      if (p.x >= z.minX && p.x <= z.maxX && p.z >= z.minZ && p.z <= z.maxZ) {
        ballBody.applyForce(new CANNON.Vec3(z.fx, 0, z.fz), ballBody.position);
      }
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Returns true when ball has PHYSICALLY FALLEN INTO the cup.
   * (ball.y < threshold AND within XZ detection radius)
   */
  checkHoleIn(ballPos: THREE.Vector3, holeIndex: number): boolean {
    const h = this.holes[holeIndex].holePosition;
    const dx = ballPos.x - h.x;
    const dz = ballPos.z - h.z;
    const horiz = Math.sqrt(dx*dx + dz*dz);
    return ballPos.y < this.CUP_DETECT_Y && horiz < this.CUP_DETECT_RADIUS;
  }

  isOutOfBounds(ballPos: THREE.Vector3): boolean {
    // Falling into cup (below ground) is NOT out of bounds
    if (ballPos.y < -0.05) return false;
    const b = this.currentBounds;
    const M = 1.8;
    return (
      ballPos.x < b.minX - M || ballPos.x > b.maxX + M ||
      ballPos.z < b.minZ - M || ballPos.z > b.maxZ + M
    );
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private clear(): void {
    for (const o of this.objects) this.scene.remove(o);
    for (const b of this.bodies) this.world.removeBody(b);
    this.objects = [];
    this.bodies = [];
    this.slopeZones = [];
    this.rotatingBodies = [];
    this.flagGroup.clear();
    this.flagMesh = null;
    this.flagAnimAngle = 0;
  }
}
