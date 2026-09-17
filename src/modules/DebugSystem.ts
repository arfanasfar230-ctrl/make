import * as THREE from 'three';
import type { SceneContext, CollisionBox } from './types';

export class DebugSystem {
  private ctx: SceneContext;
  private debugGroup: THREE.Group;
  private enabled: boolean = false;
  private collisionBoxes: CollisionBox[] = [];

  private bboxHelper: THREE.Box3Helper | null = null;
  private walkableHelper: THREE.Mesh | null = null;
  private spawnHelper: THREE.Mesh | null = null;
  private collisionHelpers: THREE.Box3Helper[] = [];

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.debugGroup = new THREE.Group();
    this.debugGroup.name = 'debug_visuals';
    this.debugGroup.visible = false;
    ctx.scene.add(this.debugGroup);

    this.createBoundingBox();
    this.createWalkablePlane();
  }

  public setCollisionBoxes(boxes: CollisionBox[]): void {
    this.collisionBoxes = boxes;
    this.createCollisionHelpers();
  }

  public setSpawnPoint(pos: THREE.Vector3): void {
    if (this.spawnHelper) {
      this.debugGroup.remove(this.spawnHelper);
      this.spawnHelper.geometry.dispose();
      (this.spawnHelper.material as THREE.Material).dispose();
      this.spawnHelper = null;
    }

    const geo = new THREE.SphereGeometry(this.ctx.sceneScale * 0.12, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.copy(pos);
    sphere.position.y += this.ctx.sceneScale * 0.12;
    this.spawnHelper = sphere;
    this.debugGroup.add(sphere);
  }

  private createBoundingBox(): void {
    const box = this.ctx.sceneBoundingBox;
    this.bboxHelper = new THREE.Box3Helper(box, 0x00ff00);
    this.debugGroup.add(this.bboxHelper);
  }

  private createWalkablePlane(): void {
    const box = this.ctx.floorBounds && !this.ctx.floorBounds.isEmpty() ? this.ctx.floorBounds : this.ctx.sceneBoundingBox;
    const w = box.max.x - box.min.x;
    const d = box.max.z - box.min.z;

    const geo = new THREE.PlaneGeometry(w, d);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.04,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.walkableHelper = new THREE.Mesh(geo, mat);
    this.walkableHelper.rotation.x = -Math.PI / 2;
    this.walkableHelper.position.set(
      (box.min.x + box.max.x) / 2,
      this.ctx.floorY + 0.01,
      (box.min.z + box.max.z) / 2
    );
    this.debugGroup.add(this.walkableHelper);
  }

  private createCollisionHelpers(): void {
    for (const h of this.collisionHelpers) {
      this.debugGroup.remove(h);
      h.dispose();
    }
    this.collisionHelpers = [];

    for (const box of this.collisionBoxes) {
      const bbox = new THREE.Box3(box.min, box.max);
      const helper = new THREE.Box3Helper(bbox, 0xff4444);
      this.collisionHelpers.push(helper);
      this.debugGroup.add(helper);
    }
  }

  public updatePlayerPosition(pos: THREE.Vector3): void {
    void pos;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.debugGroup.visible = enabled;
  }

  public toggle(): void {
    this.setEnabled(!this.enabled);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }
}