import * as THREE from 'three';
import type { SceneContext, ControlInput, PlayerState } from './types';

const PLAYER_HEIGHT_M = 1.8;
const PLAYER_RADIUS_M = 0.27;
const PLAYER_EYE_RATIO = 0.92;
const PLAYER_SPEED_MPS = 3.5;
/** Radians of yaw/pitch per mouse pixel at sensitivity 1. */
const LOOK_SENSITIVITY = 0.002;
const LOOK_SENSITIVITY_MIN = 0.2;
const LOOK_SENSITIVITY_MAX = 5;
const GRAVITY_MPS2 = -9.81;
const MIN_PITCH = -Math.PI / 2.5;
const MAX_PITCH = Math.PI / 2.5;

export class PlayerController {
  public state: PlayerState;
  public camera: THREE.PerspectiveCamera;
  public collider: THREE.Object3D;
  public pitch: number = 0;
  public yaw: number = 0;
  public vrMode: boolean = false;

  private ctx: SceneContext;
  private speed: number;
  private gravity: number;
  private headHeight: number;
  private lookSensitivity: number = 1;

  constructor(ctx: SceneContext, spawnPosition?: THREE.Vector3) {
    this.ctx = ctx;

    const scale = ctx.sceneScale;

    const height = PLAYER_HEIGHT_M * scale;
    const radius = PLAYER_RADIUS_M * scale;
    this.speed = PLAYER_SPEED_MPS * scale;
    this.gravity = GRAVITY_MPS2 * scale;
    this.headHeight = PLAYER_HEIGHT_M * PLAYER_EYE_RATIO * scale;
    this.state = {
      position: spawnPosition || this.calculateSpawnPosition(),
      rotation: 0,
      yaw: 0,
      height,
      radius,
      velocity: new THREE.Vector3(),
      isGrounded: true,
    };

    // Use the shared scene camera so the rendered view follows the player.
    this.camera = ctx.camera;

    this.collider = new THREE.Group();
    this.collider.name = 'player_collider';
    this.updateColliderVisual();

    ctx.scene.add(this.collider);
    this.syncCamera();
  }

  private calculateSpawnPosition(): THREE.Vector3 {
    const box = this.ctx.sceneBoundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);

    const spawn = new THREE.Vector3(
      center.x,
      this.ctx.floorY,
      center.z + size.z * 0.25
    );

    const halfW = size.x * 0.3;
    const halfD = size.z * 0.3;
    spawn.x = THREE.MathUtils.clamp(spawn.x, box.min.x + halfW, box.max.x - halfW);
    spawn.z = THREE.MathUtils.clamp(spawn.z, box.min.z + halfD, box.max.z - halfD);

    return spawn;
  }

  private updateColliderVisual(): void {
    while (this.collider.children.length > 0) {
      this.collider.remove(this.collider.children[0]);
    }

    const geo = new THREE.CapsuleGeometry(this.state.radius, this.state.height - this.state.radius * 2, 8, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ff88,
      wireframe: true,
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = this.state.height / 2;
    this.collider.add(mesh);
  }

  public setDebugVisibility(visible: boolean): void {
    const mesh = this.collider.children[0] as THREE.Mesh;
    if (mesh && mesh.material) {
      (mesh.material as THREE.MeshBasicMaterial).opacity = visible ? 0.3 : 0;
    }
  }

  update(input: ControlInput, deltaTime: number, collisionCheck: (pos: THREE.Vector3, radius: number) => THREE.Vector3): void {
    if (!this.vrMode) {
      this.yaw -= input.lookX * LOOK_SENSITIVITY * this.lookSensitivity;
      this.pitch -= input.lookY * LOOK_SENSITIVITY * this.lookSensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, MIN_PITCH, MAX_PITCH);
      // Keep yaw bounded so free 360-degree turning never overflows to huge
      // numbers. The movement math below treats all yaw values the same.
      this.yaw = THREE.MathUtils.euclideanModulo(this.yaw + Math.PI, Math.PI * 2) - Math.PI;
      this.state.yaw = this.yaw;
    }

    const forward = new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw)
    ).normalize();

    const right = new THREE.Vector3(
      Math.cos(this.yaw),
      0,
      -Math.sin(this.yaw)
    ).normalize();

    const moveDir = new THREE.Vector3();
    moveDir.addScaledVector(forward, input.moveForward);
    moveDir.addScaledVector(right, input.moveRight);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
    }

    const displacement = moveDir.multiplyScalar(this.speed * deltaTime);

    const newPos = this.state.position.clone().add(displacement);

    const corrected = collisionCheck(newPos, this.state.radius);

    corrected.y = this.getFloorHeight(corrected);

    this.state.position.copy(corrected);

    this.state.velocity.y += this.gravity * deltaTime;
    this.state.position.y += this.state.velocity.y * deltaTime;

    const floorH = this.getFloorHeight(this.state.position);
    if (this.state.position.y <= floorH) {
      this.state.position.y = floorH;
      this.state.velocity.y = 0;
      this.state.isGrounded = true;
    } else {
      this.state.isGrounded = false;
    }

    this.collider.position.copy(this.state.position);

    if (!this.vrMode) {
      this.syncCamera();
    }
  }

  private getFloorHeight(pos: THREE.Vector3): number {
    return this.ctx.floorY;
  }

  private syncCamera(): void {
    const headPos = this.getHeadPosition();

    this.camera.position.copy(headPos);

    const lookTarget = headPos.clone().add(
      new THREE.Vector3(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch)
      )
    );

    this.camera.lookAt(lookTarget);

    this.camera.position.y = THREE.MathUtils.clamp(
      this.camera.position.y,
      this.ctx.floorY + 0.2,
      this.ctx.sceneBoundingBox.max.y - 0.1
    );
  }

  public spawn(spawnPos: THREE.Vector3): void {
    this.state.position.copy(spawnPos);
    this.state.velocity.set(0, 0, 0);
    this.state.isGrounded = true;
    this.pitch = 0;
    this.yaw = 0;
    this.state.yaw = 0;
    this.collider.position.copy(this.state.position);
    this.syncCamera();
  }

  public getPosition(): THREE.Vector3 {
    return this.state.position;
  }

  public getHeight(): number {
    return this.state.height;
  }

  public getHeadPosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.state.position.x,
      this.state.position.y + this.headHeight,
      this.state.position.z
    );
  }

  public getForwardDirection(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw)
    ).normalize();
  }

  /** Camera look mouse/touch sensitivity multiplier (clamped, default 1). */
  public setLookSensitivity(value: number): void {
    this.lookSensitivity = THREE.MathUtils.clamp(value, LOOK_SENSITIVITY_MIN, LOOK_SENSITIVITY_MAX);
  }

  public getLookSensitivity(): number {
    return this.lookSensitivity;
  }
}
