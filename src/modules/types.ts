import * as THREE from 'three';

export type GameMode = 'desktop' | 'mobile' | 'vr';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  clock: THREE.Clock;
  kitchenModel: THREE.Group | null;
  sceneBoundingBox: THREE.Box3;
  /**
   * Footprint of the actual floor plane of the room, in model units. The player
   * movement boundary is derived from this (not from `sceneBoundingBox`, which
   * extends into wall slabs and furniture).
   */
  floorBounds: THREE.Box3;
  floorY: number;
  /** Model units per real-world meter. Computed from real kitchen proportions (counter height ~0.9m). */
  sceneScale: number;
  walkableArea: THREE.Vector3[];
  interactiveObjects: InteractiveObject[];
}

export interface InteractiveObject {
  name: string;
  displayName: string;
  category: KitchenObjectCategory;
  object3D: THREE.Object3D;
  boundingBox: THREE.Box3;
  center: THREE.Vector3;
  height: number;
  surfaceY: number;
  /**
   * Whether the object can be picked up / moved / rotated via the furniture
   * move system. Built-in fixtures (wall cabinets, base cabinetry) are visible
   * but should stay fixed.
   */
  movable: boolean;
  /**
   * Whether the object gets the blue aim hitbox when looked at. Defaults to
   * `movable` when omitted. Decoupled from `movable` because a fixture can stay
   * fixed yet still be a valid aim target (e.g. the sink), and because the big
   * work counters are movable yet deliberately not highlighted.
   */
  hitbox?: boolean;
}

export type KitchenObjectCategory =
  | 'counter'
  | 'stove'
  | 'sink'
  | 'fridge';

export interface ErgonomicsResult {
  score: number;
  status: 'Baik' | 'Cukup' | 'Kurang';
  statusClass: string;
  parameters: ErgonomicsParameter[];
  recommendations: string[];
}

export interface ErgonomicsParameter {
  name: string;
  value: number;
  maxValue: number;
  weight: number;
  description: string;
}

export interface PlayerState {
  position: THREE.Vector3;
  rotation: number;
  yaw: number;
  height: number;
  radius: number;
  velocity: THREE.Vector3;
  isGrounded: boolean;
}

export interface ControlInput {
  moveForward: number;
  moveRight: number;
  lookX: number;
  lookY: number;
  interact: boolean;
  /**
   * True when `interact` came from the [E] key specifically. Lets a panel keep
   * working for klik / tombol sentuh / trigger VR while the [E] key is ignored.
   */
  interactKey?: boolean;
  rotateInput?: number;
  rotateWheelDelta?: number;
  rotateSnap?: boolean;
  moveToggle?: boolean;
  placeItem?: boolean;
  cancelMove?: boolean;
  /** Whether the current input is from mobile mode. Used for mobile-specific sensitivity. */
  isMobile?: boolean;
}

export interface CollisionBox {
  min: THREE.Vector3;
  max: THREE.Vector3;
  object3D?: THREE.Object3D;
  disabled?: boolean;
}
