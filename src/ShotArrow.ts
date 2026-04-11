import * as THREE from 'three';

// Visual shot direction + power indicator displayed when ball is at rest
export class ShotArrow {
  private group: THREE.Group;
  private arrow: THREE.ArrowHelper;
  private dotGroup: THREE.Group;
  private readonly NUM_DOTS = 8;

  constructor(private scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // Arrow
    const dir = new THREE.Vector3(0, 0, -1);
    const origin = new THREE.Vector3(0, 0, 0);
    this.arrow = new THREE.ArrowHelper(dir, origin, 1, 0x00ff88, 0.35, 0.25);

    // Make arrow always render on top
    const arrowLine = (this.arrow as any).line as THREE.Line;
    const arrowCone = (this.arrow as any).cone as THREE.Mesh;
    const lineMat = arrowLine.material as THREE.Material;
    lineMat.depthTest = false;
    arrowLine.renderOrder = 999;
    const coneMat = arrowCone.material as THREE.Material;
    coneMat.depthTest = false;
    arrowCone.renderOrder = 999;

    this.group.add(this.arrow);

    // Trajectory dots
    this.dotGroup = new THREE.Group();
    for (let i = 0; i < this.NUM_DOTS; i++) {
      const geo = new THREE.SphereGeometry(0.055, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1 - i / (this.NUM_DOTS + 1),
        depthTest: false,
      });
      const dot = new THREE.Mesh(geo, mat);
      dot.renderOrder = 998;
      this.dotGroup.add(dot);
    }
    this.group.add(this.dotGroup);

    this.group.visible = false;
  }

  update(origin: THREE.Vector3, direction: THREE.Vector3, power: number): void {
    this.group.visible = true;

    // Arrow length proportional to power
    const baseLen = 1.0;
    const maxLen = 4.5;
    const length = baseLen + power * (maxLen - baseLen);

    // Colour: green → yellow → red as power increases
    const hue = (1 - power) * 0.38; // 0.38=green, 0=red
    const color = new THREE.Color().setHSL(hue, 1, 0.55);

    this.arrow.position.copy(origin);
    this.arrow.setDirection(direction.clone().normalize());
    const headLen = Math.min(0.5, length * 0.22);
    const headWidth = Math.min(0.4, headLen * 0.8);
    this.arrow.setLength(length, headLen, headWidth);
    (this.arrow as any).line.material.color.copy(color);
    (this.arrow as any).cone.material.color.copy(color);

    // Update trajectory dots
    const dotStep = length / (this.NUM_DOTS + 1);
    for (let i = 0; i < this.NUM_DOTS; i++) {
      const dot = this.dotGroup.children[i] as THREE.Mesh;
      const t = (i + 1) * dotStep;
      dot.position.set(
        origin.x + direction.x * t,
        origin.y + direction.y * t,
        origin.z + direction.z * t,
      );
      const mat = dot.material as THREE.MeshBasicMaterial;
      mat.opacity = (0.85 - (i / this.NUM_DOTS) * 0.7) * Math.min(1, power * 2);
      mat.color.copy(color);
    }
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.group);
  }
}
