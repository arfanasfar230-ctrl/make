import * as THREE from 'three';

/** Stream length multiplier: extends the jet downward from the nozzle. */
const STREAM_LENGTH_MULTIPLIER = 2;

/**
 * Lightweight faucet water effect.
 *
 * Rendered as a separate scene object (never touches the kitchen GLB):
 *   - an animated translucent stream between the spout tip and the basin.
 *
 * The anchor is provided in WORLD coordinates so the effect follows the real
 * spout mesh (`Mesh9_img10_17_0`) no matter how the parent hierarchy is
 * rotated/scaled.
 */
export class FaucetWater {
  private group: THREE.Group;
  private streamTex: THREE.CanvasTexture;
  private streamMat: THREE.MeshBasicMaterial;
  private stream: THREE.Mesh;

  private origin: THREE.Vector3;
  private splashY: number;
  private scale: number;
  private length: number;
  private open = false;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    origin: THREE.Vector3,
    splashY: number,
    scale: number
  ) {
    this.origin = origin.clone();
    this.splashY = splashY;
    this.scale = Math.max(scale, 1e-6);

    this.group = new THREE.Group();
    this.group.name = 'faucet_water';
    this.group.visible = false;

    const radius = 0.013 * this.scale;
    const length =
      Math.max(this.origin.y - this.splashY, 0.05 * this.scale) *
      STREAM_LENGTH_MULTIPLIER;
    this.length = length;

    this.streamTex = this.makeStreamTexture();
    this.streamMat = new THREE.MeshBasicMaterial({
      map: this.streamTex,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: 0x9fd8ff,
      toneMapped: false,
    });

    this.stream = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.72, 1, 8, 1, true),
      this.streamMat
    );
    this.stream.frustumCulled = false;
    this.stream.renderOrder = 10;
    this.stream.scale.y = length;
    this.stream.position.set(
      this.origin.x,
      this.origin.y - length * 0.5,
      this.origin.z
    );
    this.group.add(this.stream);

    scene.add(this.group);
  }

  private makeStreamTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 16, 64);
    // Solid base fill + brighter flow streaks that scroll downward.
    g.fillStyle = 'rgba(205, 232, 255, 1)';
    g.fillRect(0, 0, 16, 64);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(255, 255, 255, 1)';
      const x = 3 + (i * 3) % 11;
      g.fillRect(x, 0, 1 + (i % 2), 64);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 3);
    return tex;
  }

  public setOpen(open: boolean): void {
    this.open = open;
    this.group.visible = open;
  }

  public isOpen(): boolean {
    return this.open;
  }

  public isVisible(): boolean {
    return this.group.visible;
  }

  /** Tick the animation. Scale-independent so it works on any scene scale. */
  public update(delta: number, scale: number): void {
    this.scale = Math.max(scale, 1e-6);
    if (!this.open) return;

    this.time += delta;

    // Flowing animation: scroll streaks downward plus a soft standing wave.
    this.streamTex.offset.y -= delta * 2.0;
    const wave = 1 + 0.06 * Math.sin(this.time * 26);
    this.stream.scale.x = wave;
    this.stream.scale.z = wave;
    // Keep the real length (constructor) and pin the top at the spout tip so
    // the stream always reaches the basin. The old code overwrote scale.y with
    // ~1 here, collapsing the stream to a 1-unit cylinder.
    const h = this.length * (1 + 0.04 * Math.sin(this.time * 13));
    this.stream.scale.y = h;
    this.stream.position.y = this.origin.y - h * 0.5;
  }

  public dispose(): void {
    this.group.removeFromParent();
    this.streamMat.map?.dispose();
    this.streamMat.dispose();
    this.stream.geometry.dispose();
  }
}
