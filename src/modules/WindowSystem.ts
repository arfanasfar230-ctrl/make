import * as THREE from 'three';
import type { SceneContext } from './types';

export interface WindowData {
  group: THREE.Object3D;
  mesh: THREE.Mesh;
  originalRotation: THREE.Euler;
  originalPosition: THREE.Vector3;
  originalScale: THREE.Vector3;
  isOpen: boolean;
  outsideView: THREE.Mesh | null;
  windParticles: THREE.Points | null;
  mixer: THREE.AnimationMixer | null;
  openClip: THREE.AnimationClip | null;
  closeClip: THREE.AnimationClip | null;
}

export class WindowSystem {
  private ctx: SceneContext;
  private windows: Map<string, WindowData> = new Map();
  private clock: THREE.Clock;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.clock = new THREE.Clock();

    const model = ctx.kitchenModel;
    if (model) {
      this.findAndSetupWindows(model);
    }
  }

  private findAndSetupWindows(model: THREE.Object3D): void {
    model.traverse((node) => {
      if (node.userData.interaction === 'window' && node.userData.mixer) {
        const windowName = node.userData.windowName ?? node.name;
        if (this.windows.has(windowName)) return;
        const cursor: { mesh: THREE.Mesh | null } = { mesh: null };
        node.traverse((o) => {
          if (!cursor.mesh && (o as THREE.Mesh).isMesh) cursor.mesh = o as THREE.Mesh;
        });
        const mesh = cursor.mesh;
        this.windows.set(windowName, {
          group: node,
          mesh: mesh!,
          originalRotation: mesh ? mesh.rotation.clone() : new THREE.Euler(),
          originalPosition: mesh ? mesh.position.clone() : new THREE.Vector3(),
          originalScale: mesh ? mesh.scale.clone() : new THREE.Vector3(1, 1, 1),
          isOpen: false,
          outsideView: null,
          windParticles: null,
          mixer: node.userData.mixer,
          openClip: node.userData.windowOpen ?? null,
          closeClip: node.userData.windowClose ?? null,
        });
        return;
      }
      node.traverse((child) => {
        if ((child as THREE.Mesh).isMesh !== true) return;
        const mesh = child as THREE.Mesh;
        if (mesh.userData.interaction === 'window') {
          const windowName = mesh.userData.windowName ?? node.name;
          const windowData: WindowData = {
            group: node,
            mesh: mesh,
            originalRotation: mesh.rotation.clone(),
            originalPosition: mesh.position.clone(),
            originalScale: mesh.scale.clone(),
            isOpen: false,
            outsideView: null,
            windParticles: null,
            mixer: null,
            openClip: null,
            closeClip: null,
          };
          this.windows.set(windowName, windowData);
        }
      });
    });
  }

  public getWindowNames(): string[] {
    return Array.from(this.windows.keys());
  }

  public isWindowOpen(name: string): boolean {
    return this.windows.get(name)?.isOpen ?? false;
  }

  public toggleWindow(name: string): boolean {
    const window = this.windows.get(name);
    if (!window) return false;

    window.isOpen = !window.isOpen;
    if (window.mixer) {
      this.playClip(window);
    } else {
      this.animateWindow(window);
    }
    return true;
  }

  private playClip(window: WindowData): void {
    const clip = window.isOpen ? window.openClip : window.closeClip;
    if (!clip || !window.mixer) return;
    window.mixer.stopAllAction();
    const action = window.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
  }

  private animateWindow(window: WindowData): void {
    const targetRotation = window.isOpen
      ? new THREE.Euler(0, Math.PI / 2, 0)
      : window.originalRotation;
    const targetScale = window.isOpen
      ? new THREE.Vector3(0.01, 1, 1)
      : window.originalScale;

    const duration = 0.5;
    const startTime = this.clock.getElapsedTime();
    const startRotation = window.mesh.rotation.clone();
    const startScale = window.mesh.scale.clone();

    const animate = () => {
      const elapsed = this.clock.getElapsedTime() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeOutCubic(progress);

      window.mesh.rotation.y = THREE.MathUtils.lerp(
        startRotation.y,
        targetRotation.y,
        eased
      );
      window.mesh.scale.x = THREE.MathUtils.lerp(
        startScale.x,
        targetScale.x,
        eased
      );

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        window.mesh.rotation.copy(targetRotation);
        window.mesh.scale.copy(targetScale);
        if (window.isOpen) {
          this.createOutsideView(window);
          this.createWindParticles(window);
        } else {
          this.removeOutsideView(window);
          this.removeWindParticles(window);
        }
      }
    };
    animate();
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private createOutsideView(window: WindowData): void {
    const box = new THREE.Box3().setFromObject(window.mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const viewGeo = new THREE.PlaneGeometry(size.x * 1.1, size.y * 1.1);
    const viewMat = new THREE.MeshBasicMaterial({
      map: new THREE.TextureLoader().load('/window-view.jpg'),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });

    const outsideView = new THREE.Mesh(viewGeo, viewMat);
    outsideView.position.copy(center);
    outsideView.position.z -= 0.05;
    outsideView.rotation.y = Math.PI;
    outsideView.name = 'outside_view';
    outsideView.renderOrder = -1;

    window.group.add(outsideView);
    window.outsideView = outsideView;
  }

  private removeOutsideView(window: WindowData): void {
    if (window.outsideView) {
      window.group.remove(window.outsideView);
      window.outsideView.geometry.dispose();
      if (Array.isArray(window.outsideView.material)) {
        window.outsideView.material.forEach(m => m.dispose());
      } else {
        window.outsideView.material.dispose();
      }
      window.outsideView = null;
    }
  }

  private createWindParticles(window: WindowData): void {
    const box = new THREE.Box3().setFromObject(window.mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const particleCount = 150;
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const lifetimes = new Float32Array(particleCount);
    const maxLifetimes = new Float32Array(particleCount);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.02,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geo, mat);
    particles.name = 'wind_particles';
    window.group.add(particles);
    window.windParticles = particles;

    const S = Math.max(this.ctx.sceneScale, 1e-6);
    const windStrength = 0.8 * S;
    const spread = Math.max(size.x, size.y) * 0.6;

    const resetParticle = (i: number) => {
      positions[i * 3] = center.x + (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = center.y + (Math.random() - 0.5) * spread;
      positions[i * 3 + 2] = center.z - 0.1 - Math.random() * 0.5;

      const angle = Math.random() * Math.PI * 0.5 - Math.PI * 0.25;
      velocities[i * 3] = Math.cos(angle) * windStrength * (0.5 + Math.random() * 0.5);
      velocities[i * 3 + 1] = (Math.random() - 0.5) * windStrength * 0.3;
      velocities[i * 3 + 2] = -windStrength * (0.5 + Math.random() * 0.5);

      lifetimes[i] = maxLifetimes[i] = 1 + Math.random() * 2;
    };

    for (let i = 0; i < particleCount; i++) {
      resetParticle(i);
    }
    geo.attributes.position.needsUpdate = true;

    const update = (delta: number) => {
      if (!window.isOpen || !window.windParticles) return;

      for (let i = 0; i < particleCount; i++) {
        lifetimes[i] -= delta;
        if (lifetimes[i] <= 0) {
          resetParticle(i);
        } else {
          positions[i * 3] += velocities[i * 3] * delta;
          positions[i * 3 + 1] += velocities[i * 3 + 1] * delta;
          positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;
        }
      }
      geo.attributes.position.needsUpdate = true;
    };

    window.windParticles.userData.update = update;
  }

  private removeWindParticles(window: WindowData): void {
    if (window.windParticles) {
      window.group.remove(window.windParticles);
      window.windParticles.geometry.dispose();
      const mat = window.windParticles.material;
      if (Array.isArray(mat)) {
        mat.forEach(m => m.dispose());
      } else {
        mat.dispose();
      }
      window.windParticles = null;
    }
  }

  public update(delta: number): void {
    for (const window of this.windows.values()) {
      if (window.mixer) {
        window.mixer.update(delta);
      }
      if (window.windParticles && window.windParticles.userData.update) {
        window.windParticles.userData.update(delta);
      }
    }
  }

  public getWindowAt(point: THREE.Vector3): string | null {
    for (const [name, window] of this.windows) {
      const box = new THREE.Box3().setFromObject(window.mesh);
      if (box.containsPoint(point)) {
        return name;
      }
    }
    return null;
  }
}