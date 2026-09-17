import * as THREE from 'three';

/**
 * FaucetWater
 *
 * Lightweight running-water effect for the kitchen faucet. Everything is
 * created once (no per-frame geometry/material allocation):
 *   - a scrolling translucent stream (unit cylinder + one runtime-generated
 *     stripe texture), and
 *   - a preallocated THREE.Points splash (fixed particle pool, positions
 *     updated in place).
 *
 * OPEN  -> stream + splash visible and animated.
 * CLOSED -> everything hidden and frozen.
 */
export class FaucetWater {
  private group: THREE.Group;
  private streamMat: THREE.MeshBasicMaterial;
  private streamTex: THREE.CanvasTexture;
  private stream: THREE.Mesh;
  private splash: THREE.Points;
  private splashGeo: THREE.BufferGeometry;

  private splashPos: Float32Array;
  private splashVel: Float32Array;
  private splashLife: Float32Array;
  private readonly particleCount = 90;

  private origin: THREE.Vector3;
  private splashY: number;
  private open = false;
  private time = 0;

  constructor(scene: THREE.Scene, origin: THREE.Vector3, splashY: number, scale: number) {
    this.origin = origin.clone();
    this.splashY = splashY;

    this.group = new THREE.Group();
    this.group.name = 'faucet_water';
    this.group.visible = false;

    const length = Math.max(this.origin.y - this.splashY, 0.05 * scale);
    const radius = 0.007 * scale;

    this.streamTex = new THREE.CanvasTexture(this.makeStripeCanvas());
    this.streamTex.wrapS = THREE.RepeatWrapping;
    this.streamTex.wrapT = THREE.RepeatWrapping;
    this.streamTex.repeat.set(1, 3);

    this.streamMat = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff,
      map: this.streamTex,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });

    const streamGeo = new THREE.CylinderGeometry(radius, radius * 0.85, 1, 8, 1, true);
    this.stream = new THREE.Mesh(streamGeo, this.streamMat);
    this.stream.scale.y = length;
    this.stream.position.set(this.origin.x, this.origin.y - length / 2, this.origin.z);
    this.group.add(this.stream);

    this.splashPos = new Float32Array(this.particleCount * 3);
    this.splashVel = new Float32Array(this.particleCount * 3);
    this.splashLife = new Float32Array(this.particleCount);
    this.splashGeo = new THREE.BufferGeometry();
    this.splashGeo.setAttribute('position', new THREE.BufferAttribute(this.splashPos, 3));

    const splashMat = new THREE.PointsMaterial({
      color: 0xcfeaff,
      size: 0.012 * scale,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.splash = new THREE.Points(this.splashGeo, splashMat);
    this.splash.frustumCulled = false;
    this.group.add(this.splash);

    this.resetSplash();
    scene.add(this.group);
  }

  /** Tiny vertical-stripe texture generated once (no external asset). */
  private makeStripeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 64;
    const g = canvas.getContext('2d');
    if (g) {
      g.clearRect(0, 0, 16, 64);
      for (let x = 0; x < 16; x += 4) {
        const gradient = g.createLinearGradient(0, 0, 0, 64);
        gradient.addColorStop(0, 'rgba(255,255,255,0.0)');
        gradient.addColorStop(0.5, 'rgba(255,255,255,0.9)');
        gradient.addColorStop(1, 'rgba(255,255,255,0.0)');
        g.fillStyle = gradient;
        g.fillRect(x, 0, 2, 64);
      }
    }
    return canvas;
  }

  public setOpen(open: boolean): void {
    this.open = open;
    this.group.visible = open;
    if (open) {
      this.time = 0;
      this.resetSplash();
    }
  }

  public isOpen(): boolean {
    return this.open;
  }

  private resetSplash(): void {
    for (let i = 0; i < this.particleCount; i++) {
      this.splashLife[i] = Math.random() * 0.5;
      this.splashPos[i * 3] = this.origin.x;
      this.splashPos[i * 3 + 1] = this.splashY;
      this.splashPos[i * 3 + 2] = this.origin.z;
      this.splashVel[i * 3] = 0;
      this.splashVel[i * 3 + 1] = 0;
      this.splashVel[i * 3 + 2] = 0;
    }
    this.splashGeo.attributes.position.needsUpdate = true;
  }

  private respawn(i: number, spread: number): void {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * spread;
    this.splashPos[i * 3] = this.origin.x + Math.cos(angle) * r;
    this.splashPos[i * 3 + 1] = this.splashY;
    this.splashPos[i * 3 + 2] = this.origin.z + Math.sin(angle) * r;
    const speed = 0.25 + Math.random() * 0.6;
    this.splashVel[i * 3] = Math.cos(angle) * speed;
    this.splashVel[i * 3 + 1] = 0.8 + Math.random() * 1.4;
    this.splashVel[i * 3 + 2] = Math.sin(angle) * speed;
    this.splashLife[i] = 0.3 + Math.random() * 0.35;
  }

  public update(delta: number, scale: number): void {
    if (!this.open) return;
    this.time += delta;

    this.streamTex.offset.y -= delta * 2.2;
    const pulse = 1 + 0.07 * Math.sin(this.time * 28);
    this.stream.scale.x = pulse;
    this.stream.scale.z = pulse;

    const gravity = 6.0 * scale;
    const spread = 0.035 * scale;
    for (let i = 0; i < this.particleCount; i++) {
      this.splashLife[i] -= delta;
      if (this.splashLife[i] <= 0) {
        this.respawn(i, spread);
        continue;
      }
      this.splashVel[i * 3 + 1] -= gravity * delta;
      this.splashPos[i * 3] += this.splashVel[i * 3] * delta;
      this.splashPos[i * 3 + 1] += this.splashVel[i * 3 + 1] * delta;
      this.splashPos[i * 3 + 2] += this.splashVel[i * 3 + 2] * delta;
      if (this.splashPos[i * 3 + 1] < this.splashY - 0.01 * scale) {
        this.splashLife[i] = 0;
      }
    }
    this.splashGeo.attributes.position.needsUpdate = true;
  }
}
