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

interface SlopeZone { minX: number; maxX: number; minZ: number; maxZ: number; fx: number; fz: number; }
interface RotatingBody { body: CANNON.Body; mesh: THREE.Object3D; }
interface BumperEntry  { body: CANNON.Body; mesh: THREE.Mesh; timer: number; active: boolean; }
interface ThemeColors {
  rough: number; fairwayA: number; fairwayB: number;
  wall: number; wallCap: number; obs: number;
  hill: number; ramp: number; bumper: number; barA: number; barB: number; flag: number;
}

const TC: Record<string, ThemeColors> = {
  forest: { rough:0x2d4a2d, fairwayA:0x5a9a5a, fairwayB:0x62a862, wall:0x7a5c2e, wallCap:0xd4a855, obs:0x4a6e8a, hill:0x4a8a4a, ramp:0x5a9a5a, bumper:0xFF6600, barA:0xCC3333, barB:0x3366CC, flag:0xff1a1a },
  winter: { rough:0x7aa0bc, fairwayA:0xd8eaf5, fairwayB:0xe4f2fc, wall:0x7090b0, wallCap:0xa8cce0, obs:0x5070a0, hill:0xddeeff, ramp:0xb0ccee, bumper:0x4488dd, barA:0x3366cc, barB:0x1144aa, flag:0x44aaff },
  summer: { rough:0xb89040, fairwayA:0xe8d060, fairwayB:0xf0da70, wall:0xb07830, wallCap:0xffc860, obs:0xcc6020, hill:0xeebb50, ramp:0xd4a840, bumper:0xff6633, barA:0xff7722, barB:0xcc5500, flag:0xffcc00 },
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Shared hole geometry (same fairway per slot across all themes)
const BASE: { W: number; D: number; start: [number,number,number]; hole: [number,number,number]; b: [number,number,number,number] }[] = [
  { W:6,  D:16, start:[0,.25, 7.0], hole:[0,0,-6.5], b:[-3,  3, -8,  8]  },
  { W:7,  D:18, start:[0,.25, 8.0], hole:[0,0,-7.5], b:[-3.5,3.5,-9,  9]  },
  { W:4,  D:12, start:[0,.25, 5.0], hole:[0,0,-5.0], b:[-2,  2, -6,  6]  },
  { W:8,  D:18, start:[0,.25, 8.0], hole:[0,0,-7.5], b:[-4,  4, -9,  9]  },
  { W:9,  D:22, start:[0,.25,10.0], hole:[0,0,-9.5], b:[-4.5,4.5,-11,11]  },
  { W:9,  D:18, start:[0,.25, 8.0], hole:[0,0,-7.5], b:[-4.5,4.5,-9,  9]  },
  { W:10, D:24, start:[0,.25,11.0], hole:[0,0,-10.5],b:[-5,  5, -12,12]  },
  { W:10, D:24, start:[0,.25,11.0], hole:[0,0,-10.5],b:[-5,  5, -12,12]  },
  { W:8,  D:18, start:[0,.25, 8.0], hole:[0,0,-7.5], b:[-4,  4, -9,  9]  },
];

function makeHoles(descs: string[]): HoleData[] {
  return BASE.map((b, i) => ({
    number: i+1, par: [2,3,2,3,4,3,4,4,3][i],
    startPosition: V(...b.start as [number,number,number]),
    holePosition:  V(...b.hole as [number,number,number]),
    description: descs[i],
    bounds: { minX:b.b[0], maxX:b.b[1], minZ:b.b[2], maxZ:b.b[3] },
  }));
}

export class Course {
  public readonly CUP_DETECT_RADIUS = 0.50;
  public readonly CUP_DETECT_Y = -0.12;

  private _allHoles: Record<string, HoleData[]> = {
    forest: makeHoles(['쌍둥이 언덕','S자 게이트','좁은 언덕','풍차 파스','이중 풍차','핀볼 숲','요새 통과','지그재그','최후의 관문']),
    winter: makeHoles(['블랙 아이스','얼음 게이트','빙판 골목','빙하 계단','설원 풍차','얼음 삼각대','이중 빙판 풍차','얼음 슬라롬','얼음 미끄럼틀']),
    summer: makeHoles(['해변 오프닝','야자나무 게이트','모래 함정','사구 달리기','해변 풍차','산호 핀볼','여름 요새','모래 슬라롬','최후의 사구']),
  };

  private currentTheme = 'forest';
  private objects: THREE.Object3D[] = [];
  private bodies: CANNON.Body[] = [];
  private slopeZones: SlopeZone[] = [];
  private rotatingBodies: RotatingBody[] = [];
  private bumperEntries: BumperEntry[] = [];
  private flagGroup: THREE.Group;
  private flagMesh: THREE.Mesh | null = null;
  private flagAnimAngle = 0;
  private currentBounds = this._allHoles.forest[0].bounds;

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

  get holes(): HoleData[] { return this._allHoles[this.currentTheme]; }
  getHoles(theme: string): HoleData[] { return this._allHoles[theme]; }
  private get tc(): ThemeColors { return TC[this.currentTheme]; }

  // ─────────────────────────────────────────────────────────────────────────
  // Build
  // ─────────────────────────────────────────────────────────────────────────

  buildHole(index: number, theme = 'forest'): void {
    this.clear();
    this.currentTheme = theme;
    this.currentBounds = this.holes[index].bounds;
    if (theme === 'winter')      this._winter(index);
    else if (theme === 'summer') this._summer(index);
    else                         this._forest(index);
    const h = this.holes[index];
    this.buildCupVisual(h.holePosition);
    this.addStartMarker(h.startPosition);
  }

  // ── Forest holes ─────────────────────────────────────────────────────────

  private _forest(i: number): void {
    switch (i) {
      case 0: { // Par 2 – 쌍둥이 언덕 (channel shot between two hills)
        const {W,D,hp} = this.enc(0); void W; void D; void hp;
        this.addHill(-1.8,  2.0, 1.3, 0.38);
        this.addHill( 1.8,  2.0, 1.3, 0.38);
        this.addBumpRamp(0, -3.5, 1.8, 2.5, 0.22);
        break; }
      case 1: { // Par 3 – S자 게이트 (offset obstacles force S-curve)
        const {W,D,hp} = this.enc(1); void W; void D; void hp;
        this.addObs(-2.0,  3.5, 3.5, 1.4, 0.9, this.tc.obs);
        this.addObs( 2.0, -1.5, 3.5, 1.4, 0.9, this.tc.obs);
        this.addSlopeZone(-3.5,-6.5, 3.5,-4.5, 0.8, 0);
        this.addSlopeVisual(-3.5,-6.5, 3.5,-4.5, 1, 0, 0x6aaa60);
        break; }
      case 2: { // Par 2 – 좁은 언덕 (narrow fairway, off-centre hill)
        const {W,D,hp} = this.enc(2); void W; void D; void hp;
        this.addHill(-0.5, 0.0, 1.3, 0.48);
        break; }
      case 3: { // Par 3 – 풍차 파스 (ramp + rotating bar mid-course)
        const {W,D,hp} = this.enc(3); void W; void D; void hp;
        this.addBumpRamp(0, 5.0, 3.0, 3.5, 0.35);
        this.addRotatingBar(0, -1.0, 7.5, 0.70, this.tc.barA);
        this.addHill( 2.5, -5.5, 1.4, 0.28);
        this.addHill(-2.5, -5.5, 1.4, 0.28);
        break; }
      case 4: { // Par 4 – 이중 풍차 (two counter-rotating bars + entry ramp)
        const {W,D,hp} = this.enc(4); void W; void D; void hp;
        this.addBumpRamp(0, 7.0, 2.5, 4.0, 0.42);
        this.addRotatingBar(0,  2.5, 8.5,  0.72, this.tc.barA);
        this.addRotatingBar(0, -3.5, 8.5, -0.50, this.tc.barB);
        this.addHill(-2.0, -7.5, 1.5, 0.30);
        this.addHill( 2.0, -7.5, 1.5, 0.30);
        break; }
      case 5: { // Par 3 – 핀볼 숲 (entry hills funnel into bumper triangle)
        const {W,D,hp} = this.enc(5); void W; void D; void hp;
        this.addHill(-3.0, 6.5, 1.8, 0.35);
        this.addHill( 3.0, 6.5, 1.8, 0.35);
        this.addBouncyCylinder( 0.0,  1.5, 0.60, 1.2);
        this.addBouncyCylinder(-2.2, -2.5, 0.60, 1.2);
        this.addBouncyCylinder( 2.2, -2.5, 0.60, 1.2);
        break; }
      case 6: { // Par 4 – 요새 통과 (ramp + two bars + side obstacle)
        const {W,D,hp} = this.enc(6); void W; void D; void hp;
        this.addBumpRamp(0, 7.5, 3.0, 4.5, 0.45);
        this.addRotatingBar(0,  2.5, 9.0,  0.65, this.tc.barA);
        this.addObs(-2.5, -2.0, 4.0, 1.4, 0.9, this.tc.obs);
        this.addRotatingBar(0, -5.5, 9.0, -0.45, this.tc.barB);
        break; }
      case 7: { // Par 4 – 지그재그 (two massive S-gates + side ramps)
        const {W,D,hp} = this.enc(7); void W; void D; void hp;
        this.addObs(-2.0,  5.0, 5.0, 1.5, 1.0, this.tc.obs);
        this.addObs( 2.0, -1.5, 5.0, 1.5, 1.0, this.tc.obs);
        this.addBumpRamp( 2.0, 8.5, 2.0, 2.0, 0.35);
        this.addBumpRamp(-2.0, 1.0, 2.0, 2.0, 0.32);
        break; }
      case 8: { // Par 3 – 최후의 관문 (steep ramp + bar + bumpers at cup)
        const {W,D,hp} = this.enc(8); void W; void D; void hp;
        this.addRamp(0, 6.5, 2.5, 0, 0.85, 3.5);
        this.addRamp(0, 2.5,-1.5, 0.85, 0, 3.5);
        this.addRotatingBar(0, -2.5, 7.5, 0.85, this.tc.barA);
        this.addBouncyCylinder(-2.0, -5.5, 0.55, 1.1);
        this.addBouncyCylinder( 2.0, -5.5, 0.55, 1.1);
        break; }
    }
  }

  // ── Winter holes (ice: friction 0.12) ────────────────────────────────────

  private _winter(i: number): void {
    switch (i) {
      case 0: { // Par 2 – 블랙 아이스 (wide open, central bump – trust the slide)
        const {W,D,hp} = this.enc(0); void W; void D; void hp;
        this.addBumpRamp(0, 0.0, 2.2, 2.5, 0.38);
        break; }
      case 1: { // Par 3 – 얼음 게이트 (S-gates + bumper near cup)
        const {W,D,hp} = this.enc(1); void W; void D; void hp;
        this.addObs(-2.0,  2.5, 3.5, 1.4, 0.9, this.tc.obs);
        this.addObs( 2.0, -1.5, 3.5, 1.4, 0.9, this.tc.obs);
        this.addBouncyCylinder(0.0, -4.5, 0.55, 1.1);
        break; }
      case 2: { // Par 2 – 빙판 골목 (narrow + off-centre hill – precision required)
        const {W,D,hp} = this.enc(2); void W; void D; void hp;
        this.addHill(0.8, -0.5, 1.1, 0.48);
        break; }
      case 3: { // Par 3 – 빙하 계단 (two staggered bumps left/right)
        const {W,D,hp} = this.enc(3); void W; void D; void hp;
        this.addBumpRamp(-2.0, 5.0, 2.5, 2.5, 0.55);
        this.addBumpRamp( 2.0, 0.0, 2.5, 2.5, 0.52);
        break; }
      case 4: { // Par 4 – 설원 풍차 (ramp + two counter-rotating bars on ice)
        const {W,D,hp} = this.enc(4); void W; void D; void hp;
        this.addBumpRamp(0, 7.0, 2.5, 4.0, 0.52);
        this.addRotatingBar(0,  2.0, 8.5,  0.68, this.tc.barA);
        this.addRotatingBar(0, -3.5, 8.5, -0.48, this.tc.barB);
        break; }
      case 5: { // Par 3 – 얼음 삼각대 (ramp launch into bumper triangle)
        const {W,D,hp} = this.enc(5); void W; void D; void hp;
        this.addBumpRamp(0, 6.0, 2.0, 3.5, 0.40);
        this.addBouncyCylinder( 0.0,  2.0, 0.60, 1.2);
        this.addBouncyCylinder(-2.2, -2.5, 0.60, 1.2);
        this.addBouncyCylinder( 2.2, -2.5, 0.60, 1.2);
        break; }
      case 6: { // Par 4 – 이중 빙판 풍차 (two ramps + two bars, frantic on ice)
        const {W,D,hp} = this.enc(6); void W; void D; void hp;
        this.addBumpRamp(0, 7.5, 3.0, 4.5, 0.55);
        this.addRotatingBar(0,  3.0, 9.0,  0.62, this.tc.barA);
        this.addBumpRamp(0, 0.0, 2.5, 4.5, 0.48);
        this.addRotatingBar(0, -5.0, 9.0, -0.45, this.tc.barB);
        break; }
      case 7: { // Par 4 – 얼음 슬라롬 (massive S-gates + side ramps)
        const {W,D,hp} = this.enc(7); void W; void D; void hp;
        this.addObs(-2.0,  5.0, 5.0, 1.5, 1.0, this.tc.obs);
        this.addObs( 2.0, -1.5, 5.0, 1.5, 1.0, this.tc.obs);
        this.addBumpRamp( 2.0, 8.5, 2.5, 2.5, 0.50);
        this.addBumpRamp(-2.0, 0.0, 2.5, 2.5, 0.48);
        break; }
      case 8: { // Par 3 – 얼음 미끄럼틀 (steep slide + bar + bumpers)
        const {W,D,hp} = this.enc(8); void W; void D; void hp;
        this.addRamp(0, 7.0, 2.0, 0, 1.0, 3.5);
        this.addRamp(0, 2.0,-2.5, 1.0, 0, 3.5);
        this.addRotatingBar(0, -3.5, 7.5, 0.80, this.tc.barA);
        this.addBouncyCylinder(-2.0, -5.5, 0.55, 1.1);
        this.addBouncyCylinder( 2.0, -5.5, 0.55, 1.1);
        break; }
    }
  }

  // ── Summer holes (sand: friction 0.70) ───────────────────────────────────

  private _summer(i: number): void {
    switch (i) {
      case 0: { // Par 2 – 해변 오프닝 (decorative dune + small bump near cup)
        const {W,D,hp} = this.enc(0); void W; void D; void hp;
        this.addHill(0, 4.0, 1.5, 0.28);
        this.addBumpRamp(0, 0.5, 2.0, 2.5, 0.40);
        break; }
      case 1: { // Par 3 – 야자나무 게이트 (S-gates + dune ramp entry)
        const {W,D,hp} = this.enc(1); void W; void D; void hp;
        this.addObs( 2.0,  3.5, 2.5, 1.6, 0.9, this.tc.obs);
        this.addObs(-2.0, -1.0, 2.5, 1.6, 0.9, this.tc.obs);
        this.addBumpRamp(0, 6.5, 2.0, 3.0, 0.50);
        break; }
      case 2: { // Par 2 – 모래 함정 (narrow + central dune + small ramp)
        const {W,D,hp} = this.enc(2); void W; void D; void hp;
        this.addHill(0, -0.5, 1.2, 0.45);
        this.addBumpRamp(0, 3.0, 1.5, 1.8, 0.30);
        break; }
      case 3: { // Par 3 – 사구 달리기 (alternating offset dune ramps + hill at cup)
        const {W,D,hp} = this.enc(3); void W; void D; void hp;
        this.addBumpRamp(-2.5, 5.5, 2.5, 2.5, 0.55);
        this.addBumpRamp( 2.5, 0.5, 2.5, 2.5, 0.52);
        this.addHill(0, -5.0, 1.6, 0.28);
        break; }
      case 4: { // Par 4 – 해변 풍차 (ramp + bar + side dune + hills at cup)
        const {W,D,hp} = this.enc(4); void W; void D; void hp;
        this.addBumpRamp(0, 7.0, 2.5, 4.0, 0.50);
        this.addRotatingBar(0, 2.0, 8.5, 0.58, this.tc.barA);
        this.addBumpRamp(-2.0,-2.0, 2.5, 2.5, 0.45);
        this.addHill( 3.0, -7.5, 1.5, 0.30);
        this.addHill(-3.0, -7.5, 1.5, 0.30);
        break; }
      case 5: { // Par 3 – 산호 핀볼 (entry hills + coral bumper triangle)
        const {W,D,hp} = this.enc(5); void W; void D; void hp;
        this.addHill( 3.5, 6.5, 1.6, 0.30);
        this.addHill(-3.5, 6.5, 1.6, 0.30);
        this.addBouncyCylinder( 0.0,  1.5, 0.65, 1.3);
        this.addBouncyCylinder(-2.5, -2.5, 0.55, 1.1);
        this.addBouncyCylinder( 2.5, -2.5, 0.55, 1.1);
        break; }
      case 6: { // Par 4 – 여름 요새 (ramp + bar + side block + bar)
        const {W,D,hp} = this.enc(6); void W; void D; void hp;
        this.addBumpRamp(0, 7.5, 3.0, 4.5, 0.52);
        this.addRotatingBar(0,  3.0, 9.0,  0.55, this.tc.barA);
        this.addObs( 3.0, -2.0, 3.5, 1.4, 0.9, this.tc.obs);
        this.addRotatingBar(0, -5.0, 9.0, -0.40, this.tc.barB);
        break; }
      case 7: { // Par 4 – 모래 슬라롬 (S-gate chicane + side ramps + hill at cup)
        const {W,D,hp} = this.enc(7); void W; void D; void hp;
        this.addObs(-2.0,  5.0, 5.0, 1.5, 1.0, this.tc.obs);
        this.addObs( 2.0, -1.5, 5.0, 1.5, 1.0, this.tc.obs);
        this.addBumpRamp( 2.5, 8.5, 2.5, 2.5, 0.50);
        this.addBumpRamp(-2.5, 0.0, 2.5, 2.5, 0.48);
        this.addHill(0, -7.5, 1.8, 0.32);
        break; }
      case 8: { // Par 3 – 최후의 사구 (steep dune ramp + bar + bumpers)
        const {W,D,hp} = this.enc(8); void W; void D; void hp;
        this.addRamp(0, 7.0, 2.5, 0, 0.80, 3.5);
        this.addRamp(0, 2.5,-2.0, 0.80, 0, 3.5);
        this.addRotatingBar(0, -3.5, 7.5, 0.72, this.tc.barA);
        this.addBouncyCylinder(-2.0, -5.5, 0.55, 1.1);
        this.addBouncyCylinder( 2.0, -5.5, 0.55, 1.1);
        break; }
    }
  }

  // ── Enclosure shorthand ───────────────────────────────────────────────────

  /** Build enclosure for hole[index] and return {W, D, hp}. */
  private enc(index: number): { W: number; D: number; hp: THREE.Vector3 } {
    const b = BASE[index];
    const hp = this.holes[index].holePosition;
    this.buildEnclosure(0, 0, b.W, b.D, hp);
    return { W: b.W, D: b.D, hp };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core builders
  // ─────────────────────────────────────────────────────────────────────────

  private buildEnclosure(cx: number, cz: number, W: number, D: number, holePos: THREE.Vector3): void {
    const WT = 0.5, WH = 1.5, WD = 0.3;
    this.buildSplitGround(cx, cz, W, D, holePos.x, holePos.z);
    this.addPlane(cx, cz, W+8, D+8, this.tc.rough, -0.005);
    this.addFairwayStripes(cx, cz, W, D);
    const wc = this.tc.wall;
    this.addWall(cx - W/2 - WT/2, (WH-WD)/2, cz,          WT,      WH+WD, D+WT*2, wc);
    this.addWall(cx + W/2 + WT/2, (WH-WD)/2, cz,          WT,      WH+WD, D+WT*2, wc);
    this.addWall(cx,               (WH-WD)/2, cz+D/2+WT/2, W+WT*2, WH+WD, WT,     wc);
    this.addWall(cx,               (WH-WD)/2, cz-D/2-WT/2, W+WT*2, WH+WD, WT,     wc);
  }

  private buildSplitGround(cx: number, cz: number, W: number, D: number, holeX: number, holeZ: number): void {
    const GAP = 0.48, TH = 0.30, CY = -TH/2;
    const L = cx-W/2, R = cx+W/2, NEAR = cz+D/2, FAR = cz-D/2;
    const p1b = holeZ+GAP; if (NEAR > p1b) this.addGroundBox(cx, CY, (NEAR+p1b)/2, W, TH, NEAR-p1b);
    const p2t = holeZ-GAP; if (p2t > FAR)  this.addGroundBox(cx, CY, (p2t+FAR)/2,  W, TH, p2t-FAR);
    const p3r = holeX-GAP; if (p3r > L)    this.addGroundBox((L+p3r)/2, CY, holeZ, p3r-L, TH, 2*GAP);
    const p4l = holeX+GAP; if (R > p4l)    this.addGroundBox((p4l+R)/2, CY, holeZ, R-p4l, TH, 2*GAP);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Element helpers
  // ─────────────────────────────────────────────────────────────────────────

  private addGroundBox(x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(sx/2, sy/2, sz/2)));
    body.position.set(x, y, z);
    this.world.addBody(body); this.bodies.push(body);
  }

  private addWall(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number): void {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.wallMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(sx/2, sy/2, sz/2)));
    body.position.set(x, y, z);
    this.world.addBody(body); this.bodies.push(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 }),
    );
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh); this.objects.push(mesh);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(sx+0.02, 0.06, sz+0.02),
      new THREE.MeshStandardMaterial({ color: this.tc.wallCap, roughness: 0.6 }),
    );
    cap.position.set(x, y+sy/2+0.03, z);
    this.scene.add(cap); this.objects.push(cap);
  }

  private addObs(cx: number, cz: number, sx: number, sy: number, sz: number, color: number): void {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.wallMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(sx/2, sy/2, sz/2)));
    body.position.set(cx, sy/2, cz);
    this.world.addBody(body); this.bodies.push(body);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.12 }),
    );
    mesh.position.set(cx, sy/2, cz); mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh); this.objects.push(mesh);

    const band = new THREE.Mesh(
      new THREE.BoxGeometry(sx+0.04, 0.06, sz+0.04),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
    );
    band.position.set(cx, sy+0.03, cz);
    this.scene.add(band); this.objects.push(band);
  }

  private addRotatingBar(cx: number, cz: number, length: number, speed: number, color: number): void {
    const H = 0.70, THICK = 0.28;
    const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: this.wallMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(length/2, H/2, THICK/2)));
    body.position.set(cx, H/2, cz);
    body.angularVelocity.set(0, speed, 0);
    this.world.addBody(body); this.bodies.push(body);

    const group = new THREE.Group();
    group.position.set(cx, H/2, cz);
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(length, H, THICK),
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 }),
    );
    bar.castShadow = true; group.add(bar);
    for (let s = -1; s <= 1; s += 2) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, H+0.01, THICK+0.01),
        new THREE.MeshStandardMaterial({ color: 0xffff00, roughness: 0.5 }),
      );
      stripe.position.x = s * (length/2 - 0.3); group.add(stripe);
    }
    const pivot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, H+0.1, 12),
      new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 }),
    );
    group.add(pivot);
    this.scene.add(group); this.objects.push(group);
    this.rotatingBodies.push({ body, mesh: group });
  }

  private addBouncyCylinder(cx: number, cz: number, radius: number, height: number): void {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.bouncyMaterial });
    body.addShape(new CANNON.Cylinder(radius, radius, height, 12));
    body.position.set(cx, height/2, cz);
    this.world.addBody(body); this.bodies.push(body);

    const c = this.tc.bumper;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 24),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.2, roughness: 0.25, metalness: 0.4 }),
    );
    mesh.position.set(cx, height/2, cz); mesh.castShadow = true;
    this.scene.add(mesh); this.objects.push(mesh);

    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(radius+0.02, radius+0.02, 0.14, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
    );
    stripe.position.set(cx, height/2, cz);
    this.scene.add(stripe); this.objects.push(stripe);

    this.bumperEntries.push({ body, mesh, timer: 0, active: false });
  }

  private addHill(cx: number, cz: number, radius: number, height: number, color?: number): void {
    const centerY = height - radius;
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMaterial });
    body.addShape(new CANNON.Sphere(radius));
    body.position.set(cx, centerY, cz);
    this.world.addBody(body); this.bodies.push(body);

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI*2, 0, Math.PI/2),
      new THREE.MeshStandardMaterial({ color: color ?? this.tc.hill, roughness: 0.85 }),
    );
    mesh.position.set(cx, centerY, cz); mesh.receiveShadow = true; mesh.castShadow = true;
    this.scene.add(mesh); this.objects.push(mesh);
  }

  /**
   * Physical tilted ramp slab. Top surface aligns with y=y1 at z=z1 and y=y2 at z=z2.
   * z1 should be the player-side (larger Z), z2 the hole-side (smaller Z).
   */
  private addRamp(cx: number, z1: number, z2: number, y1: number, y2: number, halfW: number, color?: number): void {
    const dz = z2-z1, dy = y2-y1;
    const len = Math.sqrt(dz*dz + dy*dy);
    const halfLen = len/2;
    const halfThick = 0.10;
    const angle = Math.atan2(dy, z1-z2);
    const cy = y1 - halfThick*Math.cos(angle) + halfLen*Math.sin(angle);
    const cz = (z1+z2)/2;

    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(halfW, halfThick, halfLen)));
    body.position.set(cx, cy, cz);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), angle);
    this.world.addBody(body); this.bodies.push(body);

    const c = color ?? this.tc.ramp;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(halfW*2, halfThick*2, len),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }),
    );
    mesh.position.set(cx, cy, cz);
    mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    mesh.receiveShadow = true; mesh.castShadow = true;
    this.scene.add(mesh); this.objects.push(mesh);
  }

  /** A-frame bump ramp: slopes up from z1 to peak at cz, then down to z2. */
  private addBumpRamp(cx: number, cz: number, halfLen: number, halfW: number, peakH: number, color?: number): void {
    const c = color ?? this.tc.ramp;
    this.addRamp(cx, cz+halfLen, cz, 0, peakH, halfW, c);
    this.addRamp(cx, cz,         cz-halfLen, peakH, 0, halfW, c);
  }

  private addSlopeZone(minX: number, minZ: number, maxX: number, maxZ: number, fx: number, fz: number): void {
    this.slopeZones.push({ minX, minZ, maxX, maxZ, fx, fz });
  }

  private addSlopeVisual(minX: number, minZ: number, maxX: number, maxZ: number, fx: number, fz: number, color: number): void {
    const w = maxX-minX, d = maxZ-minZ, cx = (minX+maxX)/2, cz = (minZ+maxZ)/2;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true, opacity: 0.6 }),
    );
    plane.rotation.x = -Math.PI/2; plane.position.set(cx, 0.004, cz);
    this.scene.add(plane); this.objects.push(plane);
    if (fx !== 0 || fz !== 0) {
      const dir = new THREE.Vector3(fx, 0, fz).normalize();
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
        const ax = minX + (c+0.5)*(w/3), az = minZ + (r+0.5)*(d/3);
        const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(ax, 0.02, az), 0.8, 0xffcc00, 0.25, 0.2);
        this.scene.add(arrow); this.objects.push(arrow);
      }
    }
  }

  // ── Fairway visuals ───────────────────────────────────────────────────────

  private addFairwayStripes(cx: number, cz: number, W: number, D: number): void {
    const count = Math.round(D/2);
    const sd = D/count;
    for (let i = 0; i < count; i++) {
      const col = i%2===0 ? this.tc.fairwayA : this.tc.fairwayB;
      this.addPlane(cx, cz+D/2-sd*(i+0.5), W, sd, col, 0.001+i*0.00005);
    }
  }

  private addPlane(cx: number, cz: number, w: number, d: number, color: number, y: number): void {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.82 }),
    );
    mesh.rotation.x = -Math.PI/2; mesh.position.set(cx, y, cz); mesh.receiveShadow = true;
    this.scene.add(mesh); this.objects.push(mesh);
  }

  // ── Cup visual ────────────────────────────────────────────────────────────

  private buildCupVisual(pos: THREE.Vector3): void {
    this.flagGroup.clear(); this.flagMesh = null;
    const cupR = 0.46, cupD = 1.0;
    const cupInner = new THREE.Mesh(
      new THREE.CylinderGeometry(cupR, cupR*0.9, cupD, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x080808, side: THREE.BackSide, roughness: 1 }),
    );
    cupInner.position.set(pos.x, -cupD/2, pos.z); this.flagGroup.add(cupInner);

    const rim = new THREE.Mesh(
      new THREE.RingGeometry(cupR, cupR+0.08, 32),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5 }),
    );
    rim.rotation.x = -Math.PI/2; rim.position.set(pos.x, 0.012, pos.z); this.flagGroup.add(rim);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.7, roughness: 0.3 }),
    );
    pole.position.set(pos.x, 1.2, pos.z); pole.castShadow = true; this.flagGroup.add(pole);

    this.flagMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.44),
      new THREE.MeshStandardMaterial({ color: this.tc.flag, side: THREE.DoubleSide, roughness: 0.9 }),
    );
    this.flagMesh.position.set(pos.x+0.36, 2.18, pos.z); this.flagMesh.castShadow = true;
    this.flagGroup.add(this.flagMesh);
  }

  private addStartMarker(pos: THREE.Vector3): void {
    const tee = new THREE.Mesh(
      new THREE.CircleGeometry(0.44, 32),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }),
    );
    tee.rotation.x = -Math.PI/2; tee.position.set(pos.x, 0.01, pos.z);
    this.scene.add(tee); this.objects.push(tee);

    const arr = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x444444 }),
    );
    arr.rotation.x = -Math.PI/2; arr.position.set(pos.x, 0.015, pos.z-0.15);
    this.scene.add(arr); this.objects.push(arr);
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────

  update(_delta: number): void {
    for (const rot of this.rotatingBodies) {
      const q = rot.body.quaternion;
      rot.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    if (this.flagMesh) {
      this.flagAnimAngle += _delta * 2.2;
      this.flagMesh.rotation.y = Math.sin(this.flagAnimAngle) * 0.13;
    }
    // Bumper squish animation ("띠용")
    for (const b of this.bumperEntries) {
      if (!b.active) continue;
      b.timer += _delta;
      if (b.timer > 0.65) {
        b.active = false; b.timer = 0;
        b.mesh.scale.set(1, 1, 1);
      } else {
        // Decaying oscillation: fast squish outward then spring back
        const s = Math.exp(-b.timer * 9) * Math.sin(b.timer * 22) * 0.50;
        b.mesh.scale.set(1 + s, 1 - s * 0.75, 1 + s);
      }
    }
  }

  /** Register ball collision listener to trigger bumper bounce animations. */
  registerBallCollision(ballBody: CANNON.Body): void {
    ballBody.addEventListener('collide', (e: { body: CANNON.Body }) => {
      const entry = this.bumperEntries.find(b => b.body === e.body);
      if (entry) { entry.active = true; entry.timer = 0; }
    });
  }

  applySlopes(ballBody: CANNON.Body): void {
    const p = ballBody.position;
    for (const z of this.slopeZones) {
      if (p.x >= z.minX && p.x <= z.maxX && p.z >= z.minZ && p.z <= z.maxZ)
        ballBody.applyForce(new CANNON.Vec3(z.fx, 0, z.fz), ballBody.position);
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  checkHoleIn(ballPos: THREE.Vector3, holeIndex: number): boolean {
    const h = this.holes[holeIndex].holePosition;
    const dx = ballPos.x-h.x, dz = ballPos.z-h.z;
    return ballPos.y < this.CUP_DETECT_Y && Math.sqrt(dx*dx+dz*dz) < this.CUP_DETECT_RADIUS;
  }

  isOutOfBounds(ballPos: THREE.Vector3): boolean {
    if (ballPos.y < -0.05) return false;
    const b = this.currentBounds, M = 1.8;
    return ballPos.x < b.minX-M || ballPos.x > b.maxX+M || ballPos.z < b.minZ-M || ballPos.z > b.maxZ+M;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private clear(): void {
    for (const o of this.objects) this.scene.remove(o);
    for (const b of this.bodies) this.world.removeBody(b);
    this.objects = []; this.bodies = []; this.slopeZones = []; this.rotatingBodies = [];
    this.bumperEntries = [];
    this.flagGroup.clear(); this.flagMesh = null; this.flagAnimAngle = 0;
  }
}
