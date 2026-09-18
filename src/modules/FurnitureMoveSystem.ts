import * as THREE from 'three';
import type { SceneContext, InteractiveObject, ControlInput } from './types';
import type { CollisionSystem } from './CollisionSystem';

export interface MoveSystemEvents {
  onStartMove?: (obj: InteractiveObject) => void;
  onPlaced?: (obj: InteractiveObject) => void;
  onCancelled?: (obj: InteractiveObject) => void;
}

/**
 * FurnitureMoveSystem
 *
 * Allows player to easily pick up, reposition, and simultaneously rotate
 * kitchen objects (such as the refrigerator, cabinets, counters, sink).
 * Uses a world-space pivot to eliminate rotation drift on scaled GLB models.
 */
export class FurnitureMoveSystem {
  private ctx: SceneContext;
  private collision: CollisionSystem;
  private events: MoveSystemEvents;

  private isMovingActive = false;
  private currentObj: InteractiveObject | null = null;
  private pivot: THREE.Group | null = null;

  // Original parent so we can re-attach after place/cancel
  private originalParent: THREE.Object3D | null = null;

  // Cached initial state for cancel/undo (world space)
  private originalWorldPos = new THREE.Vector3();
  private originalWorldQuat = new THREE.Quaternion();
  private originalWorldScale = new THREE.Vector3();

  private floorPlane: THREE.Plane;
  private raycaster: THREE.Raycaster;
  private screenCenter: THREE.Vector2;

  // Placement indicator helper
  private indicatorGroup: THREE.Group;
  private indicatorRing!: THREE.Mesh;
  private indicatorArrow!: THREE.Mesh;

  // Smooth movement: lerp toward this target each frame
  private targetPosition: THREE.Vector3 = new THREE.Vector3();

  constructor(ctx: SceneContext, collision: CollisionSystem, events: MoveSystemEvents = {}) {
    this.ctx = ctx;
    this.collision = collision;
    this.events = events;

    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ctx.floorY);
    this.raycaster = new THREE.Raycaster();
    this.screenCenter = new THREE.Vector2(0, 0);

    this.indicatorGroup = this.createPlacementIndicator();
    this.ctx.scene.add(this.indicatorGroup);
    this.indicatorGroup.visible = false;
  }

  private createPlacementIndicator(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'placement_indicator';

    // Ring on floor
    const ringGeo = new THREE.RingGeometry(0.8, 0.95, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.indicatorRing = new THREE.Mesh(ringGeo, ringMat);
    this.indicatorRing.rotation.x = -Math.PI / 2;
    group.add(this.indicatorRing);

    // Direction arrow pointing forward (facing direction of the furniture)
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.95);
    arrowShape.lineTo(0.35, 0.45);
    arrowShape.lineTo(0.12, 0.45);
    arrowShape.lineTo(0.12, 0);
    arrowShape.lineTo(-0.12, 0);
    arrowShape.lineTo(-0.12, 0.45);
    arrowShape.lineTo(-0.35, 0.45);
    arrowShape.closePath();

    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.indicatorArrow = new THREE.Mesh(arrowGeo, arrowMat);
    this.indicatorArrow.rotation.x = -Math.PI / 2;
    group.add(this.indicatorArrow);

    return group;
  }

  public isMoving(): boolean {
    return this.isMovingActive;
  }

  public getCurrentObject(): InteractiveObject | null {
    return this.currentObj;
  }

  /**
   * Start moving an interactive object.
   */
  public startMoving(obj: InteractiveObject): boolean {
    if (this.isMovingActive) return false;

    this.currentObj = obj;
    this.isMovingActive = true;

    // 1. Save original parent so we can restore it on place/cancel
    this.originalParent = obj.object3D.parent;

    // 2. Save original world transform for cancel/revert
    obj.object3D.updateMatrixWorld(true);
    obj.object3D.getWorldPosition(this.originalWorldPos);
    obj.object3D.getWorldQuaternion(this.originalWorldQuat);
    obj.object3D.getWorldScale(this.originalWorldScale);

    // 3. Calculate current bounding box & bottom-center in world space
    const box = new THREE.Box3().setFromObject(obj.object3D);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const bottomY = box.min.y;

    // 4. Setup world pivot — position at object's world bottom-center
    if (!this.pivot) {
      this.pivot = new THREE.Group();
      this.pivot.name = `MovePivot_${obj.name}`;
      this.ctx.scene.add(this.pivot);
    }

    this.pivot.position.set(center.x, bottomY, center.z);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
    // Init smooth-move target at current position so no jump at start
    this.targetPosition.set(center.x, this.ctx.floorY, center.z);

    // Reparent object to pivot (Three.js attach preserves world transform)
    this.ctx.scene.attach(obj.object3D); // detach from kitchen model first → world space
    this.pivot.attach(obj.object3D);     // then attach to pivot
    this.pivot.updateMatrixWorld(true);

    // 5. Disable player collision with this object while carrying it
    this.collision.setObjectCollisionEnabled(obj.object3D, false);

    // 6. Configure placement indicator sizing
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(Math.hypot(size.x, size.z) * 0.55, 0.4);
    this.indicatorGroup.scale.set(radius, radius, radius);
    this.indicatorGroup.position.set(center.x, this.ctx.floorY + 0.02, center.z);
    this.indicatorGroup.rotation.y = this.pivot.rotation.y;
    this.indicatorGroup.visible = true;

    this.events.onStartMove?.(obj);
    return true;
  }

  /**
   * Rotate the object by a delta angle (in radians).
   */
  public rotate(angleDelta: number): void {
    if (!this.pivot || !this.isMovingActive) return;
    this.pivot.rotation.y += angleDelta;
    this.indicatorGroup.rotation.y = this.pivot.rotation.y;
  }

  /**
   * Snap rotate by 90 degrees (or custom angle).
   */
  public rotateSnap(angle: number = Math.PI / 2): void {
    if (!this.pivot || !this.isMovingActive) return;
    const current = this.pivot.rotation.y;
    // Snap to nearest multiple of angle plus 1 increment
    const snapped = Math.round(current / angle) * angle + angle;
    this.pivot.rotation.y = snapped;
    this.indicatorGroup.rotation.y = snapped;
  }

  /**
   * Main update loop called every frame during move mode.
   * Handles smooth glide on floor + simultaneous rotation controls.
   */
  public update(delta: number, input: ControlInput): void {
    if (!this.isMovingActive || !this.pivot || !this.currentObj) return;

    // 1. Handle simultaneous rotation from inputs
    if (input.rotateWheelDelta && Math.abs(input.rotateWheelDelta) > 0) {
      // Mouse wheel rotation (smooth and instant while moving)
      this.rotate(input.rotateWheelDelta * 0.0035);
    }

    if (input.rotateInput && Math.abs(input.rotateInput) > 0) {
      // Q/E or touch buttons continuous rotation
      this.rotate(input.rotateInput * 2.8 * delta);
    }

    if (input.rotateSnap) {
      this.rotateSnap(Math.PI / 2);
    }

    // 2. Compute target position on floor (stored in this.targetPosition)
    this.updateTargetPosition();

    // 3. Smoothly LERP pivot toward target (snappy feel, no stutter)
    const lerpSpeed = Math.min(1.0, 12.0 * delta);
    this.pivot.position.x += (this.targetPosition.x - this.pivot.position.x) * lerpSpeed;
    this.pivot.position.z += (this.targetPosition.z - this.pivot.position.z) * lerpSpeed;
    this.pivot.position.y = this.ctx.floorY;
    this.pivot.updateMatrixWorld(true);

    // 4. Keep placement helper aligned
    this.indicatorGroup.position.copy(this.pivot.position);
    this.indicatorGroup.position.y = this.ctx.floorY + 0.02;
    this.indicatorGroup.rotation.y = this.pivot.rotation.y;

    // 5. Check for place or cancel inputs
    if (input.placeItem) {
      this.place();
    } else if (input.cancelMove) {
      this.cancel();
    }
  }

  /**
   * Computes the target position on the floor based on camera gaze & bounds.
   * Stores result in this.targetPosition (does NOT directly move the pivot).
   */
  private updateTargetPosition(): void {
    if (!this.pivot || !this.currentObj) return;

    this.floorPlane.constant = -this.ctx.floorY;
    this.raycaster.setFromCamera(this.screenCenter, this.ctx.camera);

    const hitPoint = new THREE.Vector3();
    const hasHit = this.raycaster.ray.intersectPlane(this.floorPlane, hitPoint);

    const cam = this.ctx.camera;
    const S = Math.max(this.ctx.sceneScale, 1e-6);
    const defaultHoldDist = 2.4 * S;

    if (!hasHit || hitPoint.distanceTo(cam.position) > 15 * S) {
      // Looking up or at horizon: project forward in front of camera at default distance
      const forward = new THREE.Vector3();
      cam.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
      forward.normalize();

      hitPoint.set(
        cam.position.x + forward.x * defaultHoldDist,
        this.ctx.floorY,
        cam.position.z + forward.z * defaultHoldDist
      );
    } else {
      // Clamp distance from player camera between [1.0m, 4.2m]
      const toHit = new THREE.Vector3(hitPoint.x - cam.position.x, 0, hitPoint.z - cam.position.z);
      const dist = toHit.length();
      const minD = 1.0 * S;
      const maxD = 3.8 * S;

      if (dist < minD) {
        toHit.normalize().multiplyScalar(minD);
        hitPoint.x = cam.position.x + toHit.x;
        hitPoint.z = cam.position.z + toHit.z;
      } else if (dist > maxD) {
        toHit.normalize().multiplyScalar(maxD);
        hitPoint.x = cam.position.x + toHit.x;
        hitPoint.z = cam.position.z + toHit.z;
      }
    }

    // Clamp inside room boundary
    const bounds = this.ctx.floorBounds && !this.ctx.floorBounds.isEmpty()
      ? this.ctx.floorBounds
      : this.ctx.sceneBoundingBox;

    const size = new THREE.Vector3();
    this.currentObj.boundingBox.getSize(size);
    const halfWidth = Math.max(size.x, size.z) * 0.45;

    const clampedX = THREE.MathUtils.clamp(
      hitPoint.x,
      bounds.min.x + halfWidth,
      bounds.max.x - halfWidth
    );
    const clampedZ = THREE.MathUtils.clamp(
      hitPoint.z,
      bounds.min.z + halfWidth,
      bounds.max.z - halfWidth
    );

    // Store as target — the update() caller will LERP toward this
    this.targetPosition.set(clampedX, this.ctx.floorY, clampedZ);
  }

  /**
   * Finalize and place the object at the new position & rotation.
   * Reparents the object back to its original parent (kitchen model).
   */
  public place(): void {
    if (!this.isMovingActive || !this.pivot || !this.currentObj) return;

    this.pivot.updateMatrixWorld(true);
    this.currentObj.object3D.updateMatrixWorld(true);

    // Reparent back to original parent (restoring it inside the kitchen model)
    if (this.originalParent) {
      this.originalParent.attach(this.currentObj.object3D);
    } else {
      this.ctx.scene.attach(this.currentObj.object3D);
    }

    // Update InteractiveObject bounding box & center
    const newBox = new THREE.Box3().setFromObject(this.currentObj.object3D);
    this.currentObj.boundingBox.copy(newBox);
    newBox.getCenter(this.currentObj.center);
    this.currentObj.surfaceY = newBox.max.y;

    // If faucet data exists, update world nozzle position and splash
    if (this.currentObj.object3D.userData.faucet) {
      const faucetData = this.currentObj.object3D.userData.faucet as {
        nozzle?: THREE.Vector3;
        splashY?: number;
      };
      const origin = this.currentObj.object3D.getObjectByName('waterOrigin');
      if (origin && faucetData.nozzle) {
        origin.getWorldPosition(faucetData.nozzle);
        faucetData.splashY = this.findSplashY(faucetData.nozzle);
      }
    }

    // Re-enable and update collision box
    this.collision.updateObjectCollision(this.currentObj.object3D);

    const placedObj = this.currentObj;
    this.isMovingActive = false;
    this.currentObj = null;
    this.originalParent = null;
    this.indicatorGroup.visible = false;

    this.events.onPlaced?.(placedObj);
  }

  /**
   * Cancel moving and restore original position and rotation.
   * Reparents the object back to its original parent (kitchen model).
   */
  public cancel(): void {
    if (!this.isMovingActive || !this.pivot || !this.currentObj) return;

    const obj3D = this.currentObj.object3D;

    // First detach to scene (world space) so coordinates are absolute
    this.ctx.scene.attach(obj3D);

    // Restore exact original world transform
    obj3D.position.copy(this.originalWorldPos);
    obj3D.quaternion.copy(this.originalWorldQuat);
    obj3D.scale.copy(this.originalWorldScale);
    obj3D.updateMatrixWorld(true);

    // Re-attach to original parent (preserves the world transform we just set)
    if (this.originalParent) {
      this.originalParent.attach(obj3D);
    }
    obj3D.updateMatrixWorld(true);

    // Re-enable collision at original position
    this.collision.updateObjectCollision(obj3D);

    const cancelledObj = this.currentObj;
    this.isMovingActive = false;
    this.currentObj = null;
    this.originalParent = null;
    this.indicatorGroup.visible = false;

    this.events.onCancelled?.(cancelledObj);
  }

  private findSplashY(nozzle: THREE.Vector3): number {
    const model = this.ctx.kitchenModel;
    if (model) {
      const ray = new THREE.Raycaster(
        new THREE.Vector3(nozzle.x, nozzle.y - 0.05, nozzle.z),
        new THREE.Vector3(0, -1, 0),
        0,
        15
      );
      const hits = ray.intersectObject(model, true);
      for (const hit of hits) {
        if (hit.object.visible && hit.distance > 1e-4) {
          return Math.min(hit.point.y + 0.03, nozzle.y - 0.2);
        }
      }
    }
    return nozzle.y - 1.6;
  }
}
