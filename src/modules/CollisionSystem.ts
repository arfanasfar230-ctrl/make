import * as THREE from 'three';
import type { SceneContext, CollisionBox } from './types';

/**
 * CollisionSystem
 *
 * Collision geometry is derived from the actual loaded GLB mesh geometry using
 * real-world metric thresholds (scaled by `sceneScale`, model-units-per-meter).
 * An object is treated as a walking obstacle when:
 *   - it is floor-standing (its bottom sits at/near the floor plane), AND
 *   - its top is high enough that the player cannot simply step over it.
 * Thin ground sheets (the floor) and objects floating well above the floor
 * (countertops, upper cabinets, windows, wall signs) are excluded so the
 * player is not impeded invisibly or trapped in the model.
 */
export class CollisionSystem {
  private ctx: SceneContext;
  private collisionBoxes: CollisionBox[] = [];
  private floorY: number;
  private boundaryMin: THREE.Vector3;
  private boundaryMax: THREE.Vector3;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.floorY = ctx.floorY;

    // The boundary is the room's actual floor footprint (the interior of the
    // walls), not the model bounding box, which extends into wall slabs and
    // furniture. Falling back to the bounding box keeps the system robust for
    // models where no floor plane is detected.
    const floor = ctx.floorBounds && !ctx.floorBounds.isEmpty() ? ctx.floorBounds : ctx.sceneBoundingBox;
    const eps = 0.02;
    this.boundaryMin = new THREE.Vector3(floor.min.x + eps, floor.min.y, floor.min.z + eps);
    this.boundaryMax = new THREE.Vector3(floor.max.x - eps, floor.max.y, floor.max.z - eps);

    this.buildCollisionBoxes();
  }

  private metersToUnits(m: number): number {
    return m * Math.max(this.ctx.sceneScale, 1e-6);
  }

  private buildCollisionBoxes(): void {
    const model = this.ctx.kitchenModel;
    if (!model) return;

    const modelBox = this.ctx.sceneBoundingBox;
    const roomSize = new THREE.Vector3();
    modelBox.getSize(roomSize);
    const roomArea = Math.max(roomSize.x * roomSize.z, 1e-6);

    model.traverse((child) => {
      if (!child.visible) return;
      if (child.name && child.name.toLowerCase().includes('player_collider')) return;
      if (!this.isGeometricChild(child)) return;

      const childBox = new THREE.Box3().setFromObject(child);
      if (childBox.isEmpty()) return;

      const childSize = new THREE.Vector3();
      childBox.getSize(childSize);

      // Skip degenerate slivers and tiny fixtures (handles, knobs, etc.)
      if (childSize.x < this.metersToUnits(0.02) || childSize.z < this.metersToUnits(0.02)) return;
      if (childSize.y < this.metersToUnits(0.02)) return;

      // Skip the floor / large thin ground sheets so the player stays above it.
      if (childSize.y < this.metersToUnits(0.08)) {
        if (childSize.x * childSize.z > roomArea * 0.5) return;
        if (this.isVerticalSheet(childBox, childSize, roomSize)) return;
      }

      const bottom = childBox.min.y - this.floorY;
      const top = childBox.max.y - this.floorY;

      // Only floor-standing obstacles are walk blockers. Objects whose base is
      // visibly above the floor (counter tops, countertop items, upper cabinets,
      // windows, wall signs, hanging pendants) must not block horizontal motion.
      if (bottom > this.metersToUnits(0.18)) return;
      if (bottom < -this.metersToUnits(0.35)) return;

      // Too low to impede movement (auto-step height).
      if (top < this.metersToUnits(0.5)) return;

      this.collisionBoxes.push({
        min: childBox.min.clone(),
        max: childBox.max.clone(),
        object3D: child,
      });
    });

    // Extra safety walls around the whole model boundary.
    this.addWalls(modelBox, roomSize);
  }

  private isGeometricChild(child: THREE.Object3D): boolean {
    return (child as THREE.Mesh).isMesh === true;
  }

  private isVerticalSheet(box: THREE.Box3, size: THREE.Vector3, roomSize: THREE.Vector3): boolean {
    const isTall = size.y > this.metersToUnits(1.0);
    const coversRoom = size.x > roomSize.x * 0.4 || size.z > roomSize.z * 0.4;
    return isTall && coversRoom;
  }

  private addWalls(modelBox: THREE.Box3, roomSize: THREE.Vector3): void {
    const w = Math.max(roomSize.x, roomSize.z) * 0.03;
    const h = modelBox.max.y - modelBox.min.y;
    const hx = (modelBox.max.x - modelBox.min.x) / 2;
    const hz = (modelBox.max.z - modelBox.min.z) / 2;
    const cx = (modelBox.min.x + modelBox.max.x) / 2;
    const cz = (modelBox.min.z + modelBox.max.z) / 2;

    const walls: Array<{ min: THREE.Vector3; max: THREE.Vector3 }> = [
      {
        min: new THREE.Vector3(cx - hx - w, modelBox.min.y, cz - hz - w),
        max: new THREE.Vector3(cx + hx + w, modelBox.min.y + h, cz - hz),
      },
      {
        min: new THREE.Vector3(cx - hx - w, modelBox.min.y, cz + hz),
        max: new THREE.Vector3(cx + hx + w, modelBox.min.y + h, cz + hz + w),
      },
      {
        min: new THREE.Vector3(cx - hx - w, modelBox.min.y, cz - hz),
        max: new THREE.Vector3(cx - hx, modelBox.min.y + h, cz + hz),
      },
      {
        min: new THREE.Vector3(cx + hx, modelBox.min.y, cz - hz),
        max: new THREE.Vector3(cx + hx + w, modelBox.min.y + h, cz + hz),
      },
    ];

    for (const wall of walls) {
      this.collisionBoxes.push({ min: wall.min, max: wall.max });
    }
  }

  public resolvePosition(pos: THREE.Vector3, radius: number, playerHeight?: number): THREE.Vector3 {
    const result = pos.clone();
    const fullHeight = playerHeight ?? radius * 2;

    result.x = THREE.MathUtils.clamp(result.x, this.boundaryMin.x + radius, this.boundaryMax.x - radius);
    result.z = THREE.MathUtils.clamp(result.z, this.boundaryMin.z + radius, this.boundaryMax.z - radius);

    // Iterate a few times so a single resolve can push the capsule out of
    // adjacent boxes without getting stuck.
    for (let i = 0; i < 6; i++) {
      let collided = false;
      for (const box of this.collisionBoxes) {
        if (box.disabled) continue;
        if (this.intersectsCapsule(result, radius, fullHeight, box)) {
          this.pushOut(result, radius, box);
          result.x = THREE.MathUtils.clamp(result.x, this.boundaryMin.x + radius, this.boundaryMax.x - radius);
          result.z = THREE.MathUtils.clamp(result.z, this.boundaryMin.z + radius, this.boundaryMax.z - radius);
          collided = true;
        }
      }
      if (!collided) break;
    }

    return result;
  }

  /** Center of the walkable interior, used to bias exits toward open floor. */
  private roomCenter(): THREE.Vector3 {
    return new THREE.Vector3(
      (this.boundaryMin.x + this.boundaryMax.x) / 2,
      0,
      (this.boundaryMin.z + this.boundaryMax.z) / 2
    );
  }

  private isWithinBoundary(pos: THREE.Vector3, radius: number): boolean {
    return (
      pos.x >= this.boundaryMin.x + radius &&
      pos.x <= this.boundaryMax.x - radius &&
      pos.z >= this.boundaryMin.z + radius &&
      pos.z <= this.boundaryMax.z - radius
    );
  }

  private intersectsCapsule(pos: THREE.Vector3, radius: number, height: number, box: CollisionBox): boolean {
    const closestX = THREE.MathUtils.clamp(pos.x, box.min.x, box.max.x);
    const closestZ = THREE.MathUtils.clamp(pos.z, box.min.z, box.max.z);

    const dx = pos.x - closestX;
    const dz = pos.z - closestZ;
    const distSq = dx * dx + dz * dz;

    const playerBottom = pos.y + radius;
    const playerTop = pos.y + height - radius;

    if (playerTop < box.min.y || playerBottom > box.max.y) return false;

    return distSq < radius * radius;
  }

  private pushOut(pos: THREE.Vector3, radius: number, box: CollisionBox): void {
    const closestX = THREE.MathUtils.clamp(pos.x, box.min.x, box.max.x);
    const closestZ = THREE.MathUtils.clamp(pos.z, box.min.z, box.max.z);

    const dx = pos.x - closestX;
    const dz = pos.z - closestZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const pad = this.metersToUnits(0.01);

    if (dist < 1e-4) {
      // The capsule center is inside the box (a teleport/spawn landed in
      // furniture; this cannot happen during normal walking). Push the capsule
      // completely out through a face that leads into the open interior of the
      // room (never through a face that dumps it against a wall, and never a
      // face the movement boundary would clamp straight back into the box).
      const roomCenter = this.roomCenter();
      const boxCenter = new THREE.Vector3(
        (box.min.x + box.max.x) / 2,
        0,
        (box.min.z + box.max.z) / 2
      );

      const faces = [
        { d: pos.x - box.min.x, vx: -1, vz: 0, out: -1 * (roomCenter.x - boxCenter.x) },
        { d: box.max.x - pos.x, vx: 1, vz: 0, out: 1 * (roomCenter.x - boxCenter.x) },
        { d: pos.z - box.min.z, vx: 0, vz: -1, out: -1 * (roomCenter.z - boxCenter.z) },
        { d: box.max.z - pos.z, vx: 0, vz: 1, out: 1 * (roomCenter.z - boxCenter.z) },
      ];

      // Prefer the face that opens toward the room interior, then the shallowest.
      faces.sort((a, b) => b.out - a.out || a.d - b.d);

      for (const c of faces) {
        const push = c.d + radius + pad;
        const candidate = new THREE.Vector3(pos.x + c.vx * push, pos.y, pos.z + c.vz * push);
        if (this.isWithinBoundary(candidate, radius)) {
          pos.copy(candidate);
          return;
        }
      }

      // No face exits into legal space (fully walled-in dead zone): push along
      // the shallowest face; the resolve loop iterates the capsule back out.
      const c = faces[0];
      const push = Math.max(c.d + radius + pad, 0.05 * radius);
      pos.x += c.vx * push;
      pos.z += c.vz * push;
      return;
    }

    const overlap = radius - dist + pad;
    if (overlap > 0) {
      pos.x += (dx / dist) * overlap;
      pos.z += (dz / dist) * overlap;
    }
  }

  public getCollisionBoxes(): CollisionBox[] {
    return this.collisionBoxes;
  }

  public addCollisionBox(box: CollisionBox): void {
    this.collisionBoxes.push(box);
  }

  public removeCollisionBox(box: CollisionBox): void {
    const idx = this.collisionBoxes.indexOf(box);
    if (idx !== -1) {
      this.collisionBoxes.splice(idx, 1);
    }
  }

  public getBoundary(): { min: THREE.Vector3; max: THREE.Vector3 } {
    return { min: this.boundaryMin, max: this.boundaryMax };
  }

  public setDebugVisibility(_visible: boolean): void {
    // Debug visualization handled by DebugSystem.
  }

  public setObjectCollisionEnabled(targetRoot: THREE.Object3D, enabled: boolean): void {
    for (const box of this.collisionBoxes) {
      if (box.object3D && this.isNodeOrDescendant(box.object3D, targetRoot)) {
        box.disabled = !enabled;
      }
    }
  }

  public updateObjectCollision(targetRoot: THREE.Object3D): void {
    targetRoot.updateMatrixWorld(true);
    for (const box of this.collisionBoxes) {
      if (box.object3D && this.isNodeOrDescendant(box.object3D, targetRoot)) {
        const updated = new THREE.Box3().setFromObject(box.object3D);
        box.min.copy(updated.min);
        box.max.copy(updated.max);
        box.disabled = false;
      }
    }
  }

  private isNodeOrDescendant(node: THREE.Object3D, root: THREE.Object3D): boolean {
    if (node === root) return true;
    let curr: THREE.Object3D | null = node.parent;
    while (curr) {
      if (curr === root) return true;
      curr = curr.parent;
    }
    return false;
  }
}