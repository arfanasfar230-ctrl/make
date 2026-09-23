import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { SceneContext, InteractiveObject, KitchenObjectCategory } from './types';

const CATEGORY_DISPLAY_NAMES: Record<KitchenObjectCategory, string> = {
  counter: 'Meja Kerja Dapur',
  stove: 'Kompor',
  sink: 'Wastafel',
  fridge: 'Kulkas',
  cabinet: 'Kabinet Dapur',
  prep_area: 'Area Persiapan',
  other: 'Objek Dapur',
};

/**
 * Model-aware grouping.
 *
 * The `simple_linear_kitchen.glb` is a Sketchfab export whose meshes carry
 * generic names (`Mesh1_img..._0`, `Mesh5_Color_...`). Each logical kitchen
 * unit lives under a parent group node named like `G_2`, `G_121`, etc. Those
 * group nodes are real structure from the loaded model (not fabricated by us),
 * so interactive objects are built from them rather than from name-keyword
 * material detection.
 *
 * `'skip'` entries are structural groups (walls, floor, windows, backsplash,
 * wall signs, hanging pendants) that are not ergonomics targets but still
 * contribute to collision via CollisionSystem (which works on raw geometry).
 */
const GROUP_CATEGORY: Record<string, KitchenObjectCategory | 'skip'> = {
  G_0_extern_wall: 'skip',
  G_1_extern_wall: 'skip',
  G_3_extern_wall: 'skip',
  interiors: 'skip',
  G_1: 'cabinet',      // tall wall cabinet on the west wall
  G_2: 'skip',         // exterior wall door on the east wall (replaced by dedicated 3D Refrigerator model)
  G_7: 'counter',
  G_8: 'counter',
  G_9: 'counter',
  G_10: 'counter',
  G_16: 'counter',
  G_17: 'counter',
  G_118: 'counter',
  G_12: 'cabinet',     // upper cabinet row (middle)
  G_19: 'cabinet',
  G_20: 'cabinet',
  G_21: 'cabinet',
  G_24: 'cabinet',
  G_25: 'cabinet',
  G_58: 'skip',        // wall sign/decor above counter
  G_67: 'skip',        // window
  G_68: 'skip',        // window
  G_69: 'skip',        // window
  G_90: 'skip',        // tile backsplash along the whole south wall
  G_121: 'counter',    // the long worktop (split into counter/sink/prep below)
  G_123: 'skip',       // hanging pendant lamps
  G_124: 'skip',       // narrow upper shelf
};

/** Sub-nodes inside G_121 (the long worktop) that describe distinct zones. */
const G121_SUBGROUP_CATEGORY: Record<string, KitchenObjectCategory | 'skip'> = {
  Mesh9: 'sink',       // _ra1: sink basin + faucet
  Mesh10: 'prep_area', // _ra2: countertop fixtures / prep cluster
  Mesh11: 'counter',   // the worktop slab itself
};

/**
 * Built-in fixtures that must stay fixed in the scene. They remain fully
 * visible and analysable (ergonomics), but are excluded from the move/rotate
 * hitbox and the furniture move system.
 *
 * Upper wall cabinets: G_12, G_19, G_20, G_21 (main run) + G_24, G_25 (ends).
 * Base cabinet / counter wall units (lower cabinets under the worktop):
 * G_7, G_8, G_9, G_10, G_16, G_17, G_118.
 */
const NON_MOVABLE_GROUPS = new Set<string>([
  'G_7',
  'G_8',
  'G_9',
  'G_10',
  'G_12',
  'G_16',
  'G_17',
  'G_19',
  'G_20',
  'G_21',
  'G_24',
  'G_25',
  'G_118',
]);

/** Visible spout/corong mesh inside the faucet group (G_121 > _ra1 > Mesh9). */
const FAUCET_SPOUT_MESH_NAME = 'Mesh9_img10_17_0';

/**
 * World-space shift for the sink unit — the `Mesh9` group (sink basin +
 * faucet) under G_121 > _ra1. Negative = left (world -X).
 * Two parts, both applied to the node's local X before any analysis runs so
 * the sink's own hitbox follows the moved geometry and the faucet water
 * anchor is recomputed at the new spout position:
 *   - `SINK_SHIFT_X_METERS`: original small nudge (metres),
 *   - `SINK_SHIFT_X_EXTRA_UNITS`: extra leftward travel from the current
 *     position (the model's world units, like the sink's printed centre
 *     coordinate). Requested as four successive "+5" left moves (-20) then a
 *     "+2 right" move (back toward +X): -18 total now.
 * No other object, hitbox, the faucet button, or the water animation is
 * touched, and the GLB stays unmodified.
 */
const SINK_SHIFT_X_METERS = -0.2;
const SINK_SHIFT_X_EXTRA_UNITS = -18;

/**
 * Renders the sink (`Mesh9` under G_121 > _ra1) transparent/invisible by
 * making its materials fully transparent. The sink's geometry is left in
 * place, so its hitbox, collision, position, raycasts, the "Nyalakan Kran"
 * faucet interaction and the water anchor are all unchanged — only the
 * material rendering is affected.
 */
const SINK_TRANSPARENT = true;

/**
 * Slight X-only nudge for the water stream. The anchor is the plant mesh
 * (Mesh9), so the stream is shifted a little to the left (world -X) to sit off
 * it. Moved +1, +2 twice, +5 twice, +4, +2 to the right, -1 back to the left,
 * +0.5 to the right, -0.5 back to the left, +0.25 to the right, -0.25 back to
 * the left, +0.1 to the right, then -0.05 back to the left (world X) per
 * request. Y, Z, size, shape and animation are left untouched.
 */
const FAUCET_WATER_X_OFFSET = -0.2;

/** Slight Z nudge to bring the stream toward the viewer (world +Z). */
const FAUCET_WATER_Z_OFFSET = 0.95;

/** Slight Y nudge to raise the stream (world +Y). */
const FAUCET_WATER_Y_OFFSET = 0.95;

export interface FaucetWaterAnchor {
  /** Spout exit point, in WORLD coordinates. */
  nozzle: THREE.Vector3;
  /** World Y where the stream hits the basin. */
  splashY: number;
}

/**
 * Computes the water anchor for a faucet group.
 *
 * The spout tip is derived from the real geometry of `Mesh9_img10_17_0`: every
 * vertex is transformed by `matrixWorld`, so the parent rotation and scale
 * (the GLB root is rotated and unit-scaled) are fully accounted for. The basin
 * rim is taken from the lowest mesh in the group, and the splash height is
 * found by raycasting straight down from the nozzle.
 *
 * Exported so the interaction system can (re)compute the anchor at runtime.
 */
export function computeFaucetWaterAnchor(
  node: THREE.Object3D,
  ctx: SceneContext
): FaucetWaterAnchor {
  node.updateWorldMatrix(true, true);

  const meshes: Array<{ mesh: THREE.Mesh; box: THREE.Box3 }> = [];
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh === true) {
      meshes.push({ mesh, box: new THREE.Box3().setFromObject(mesh) });
    }
  });
  if (meshes.length === 0) {
    return { nozzle: new THREE.Vector3(), splashY: 0 };
  }

  const byTop = [...meshes].sort((a, b) => a.box.max.y - b.box.max.y);
  const basinTop = byTop[0].box.max.y;
  const spout =
    meshes.find((m) => m.mesh.name === FAUCET_SPOUT_MESH_NAME) ??
    byTop[byTop.length - 1];

  const box = spout.box;
  const centerZ = (box.min.z + box.max.z) / 2;
  const attr = spout.mesh.geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  const v = new THREE.Vector3();
  const front: THREE.Vector3[] = [];
  if (attr) {
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(spout.mesh.matrixWorld);
      // Keep the front (player-facing) half above the basin rim: the opening.
      if (v.y > basinTop + 0.3 && v.z > centerZ) front.push(v.clone());
    }
  }

  let nozzle: THREE.Vector3;
  if (front.length > 0) {
    front.sort((a, b) => a.y - b.y);
    const k = Math.min(12, front.length);
    const centroid = new THREE.Vector3();
    let lowestY = Infinity;
    for (let i = 0; i < k; i++) {
      centroid.add(front[i]);
      lowestY = Math.min(lowestY, front[i].y);
    }
    centroid.divideScalar(k);
    nozzle = new THREE.Vector3(centroid.x, lowestY - 0.02, centroid.z);
  } else {
    const center = new THREE.Vector3();
    box.getCenter(center);
    nozzle = new THREE.Vector3(center.x, basinTop + 0.4, box.max.z - 0.15);
  }

  // Resolve the splash height from the original position (so the splash Y is
  // unaffected), then apply the anchor nudges: left (X), toward the viewer (Z)
  // and slightly up (Y).
  const splashY = findSplashY(nozzle, ctx);
  nozzle.x += FAUCET_WATER_X_OFFSET;
  nozzle.z += FAUCET_WATER_Z_OFFSET;
  nozzle.y += FAUCET_WATER_Y_OFFSET;

  return { nozzle, splashY };
}

/** First surface directly below the nozzle (basin): where water lands. */
export function findSplashY(nozzle: THREE.Vector3, ctx: SceneContext): number {
  const model = ctx.kitchenModel;
  if (model) {
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(nozzle.x, nozzle.y - 0.05, nozzle.z),
      new THREE.Vector3(0, -1, 0),
      0,
      12
    );
    const hits = raycaster.intersectObject(model, true);
    for (const hit of hits) {
      if (hit.object.visible && hit.distance > 1e-4) {
        return Math.min(hit.point.y + 0.03, nozzle.y - 0.2);
      }
    }
  }
  return nozzle.y - 1.6;
}

export class AssetLoader {
  private loader: GLTFLoader;
  private progressCallback?: (progress: number) => void;

  constructor(progressCallback?: (progress: number) => void) {
    this.loader = new GLTFLoader();
    this.progressCallback = progressCallback;
  }

  async loadKitchen(url: string, ctx: SceneContext): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf: GLTF) => {
          try {
            const model = gltf.scene;
            this.processModel(model, ctx);
            resolve(model);
          } catch (error) {
            reject(error);
          }
        },
        (progress) => {
          if (this.progressCallback && progress.total > 0) {
            this.progressCallback(progress.loaded / progress.total);
          }
        },
        (error) => {
          reject(error);
        }
      );
    });
  }

  /**
   * Post-load analysis and wiring. Public so the exact same pipeline can be
   * exercised headlessly (Node) against the real GLB for verification.
   */
  processModel(model: THREE.Group, ctx: SceneContext): void {
    ctx.kitchenModel = model;
    ctx.scene.add(model);

    // G_1 is the tall west-wall cabinet registered as a window interactable
    // (labelled "Kabinet Dapur"). It is stripped from the scene entirely for
    // testing; the real glass windows (G_67, G_68, G_69) are left untouched.
    // Removal happens before any analysis so every downstream system (bbox,
    // collision, window interactables) never sees it.
    this.removeModelNode(model, 'G_1');

    const box = new THREE.Box3().setFromObject(model);
    ctx.sceneBoundingBox = box;
    ctx.floorY = box.min.y;

    this.computeFloorBounds(model, ctx);

    this.calculateSceneScale(model, ctx);

    this.shiftSink(model, ctx);

    this.setupLights(ctx);

    this.buildInteractiveObjects(model, ctx);
    this.normalizeWorkSurfaces(ctx);

    this.makeSinkTransparent(model);

    this.buildWalkableArea(model, ctx);

    this.buildRoomShell(model, ctx);
  }

  /**
   * Extent of the actual floor plane of the room.
   *
   * Unlike `sceneBoundingBox` (which extends into wall slabs and furniture),
   * this is the interior rectangle the player may stand on. It is the largest
   * thin horizontal sheet lying on the floor plane; the room's floor mesh wins
   * because it covers the whole footprint.
   */
  private computeFloorBounds(model: THREE.Object3D, ctx: SceneContext): void {
    ctx.floorBounds = new THREE.Box3();
    let bestArea = -1;

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh !== true) return;
      if (!child.visible) return;

      const b = new THREE.Box3().setFromObject(child);
      if (b.isEmpty()) return;
      const size = new THREE.Vector3();
      b.getSize(size);

      const isThinSheet = size.y <= 0.15 && size.x >= 0.5 && size.z >= 0.5;
      const sitsOnFloor = b.min.y <= ctx.floorY + 0.2 && b.max.y <= ctx.floorY + 0.2;

      if (!isThinSheet || !sitsOnFloor) return;

      const area = size.x * size.z;
      if (area > bestArea) {
        bestArea = area;
        ctx.floorBounds = b.clone();
      }
    });
  }

  /**
   * Real-world scale (model units per meter).
   *
   * Ergonomics counters sit ~0.86–0.9m above the floor. Before we know the
   * scale we search the mesh geometry for surfaces in a plausible band (in
   * world units):
   *   - horizontal sheets (worktops, shelves) with a top in [3, 30] units, and
   *   - floor-standing cabinet bodies whose top lands in [5, 12] units.
   * The median of the collected tops gives the dominant work surface height,
   * and `sceneScale = workSurfaceWorld / 0.88`.
   */
  private calculateSceneScale(model: THREE.Object3D, ctx: SceneContext): void {
    const tops: number[] = [];

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh !== true) return;
      if (!child.visible) return;
      const b = new THREE.Box3().setFromObject(child);
      if (b.isEmpty()) return;
      const size = new THREE.Vector3();
      b.getSize(size);
      const topAboveFloor = b.max.y - ctx.floorY;
      const bottomAboveFloor = b.min.y - ctx.floorY;

      const isHorizontalSheet =
        size.x > 0.2 && size.z > 0.2 && size.x > size.y * 2 && size.z > size.y * 2;
      const isFloorStanding =
        bottomAboveFloor > -0.5 && bottomAboveFloor <= 2 && size.y > 0.4;

      if (isHorizontalSheet && topAboveFloor > 3 && topAboveFloor < 30) {
        tops.push(topAboveFloor);
      } else if (isFloorStanding && topAboveFloor > 5 && topAboveFloor < 12) {
        tops.push(topAboveFloor);
      }
    });

    if (tops.length > 0) {
      tops.sort((a, b) => a - b);
      const workSurface = tops[Math.floor(tops.length / 2)];
      ctx.sceneScale = Math.max(workSurface / 0.88, 1e-6);
      return;
    }

    const size = new THREE.Vector3();
    ctx.sceneBoundingBox.getSize(size);
    ctx.sceneScale = Math.max(size.y / 2.7, 1e-6);
  }

  private setupLights(ctx: SceneContext): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    ctx.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    const box = ctx.sceneBoundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    dirLight.target.position.copy(center);
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = Math.max(size.x, size.y, size.z) * 3;
    const halfMax = Math.max(size.x, size.z) * 0.6;
    dirLight.shadow.camera.left = -halfMax;
    dirLight.shadow.camera.right = halfMax;
    dirLight.shadow.camera.top = halfMax;
    dirLight.shadow.camera.bottom = -halfMax;
    ctx.scene.add(dirLight);
    ctx.scene.add(dirLight.target);

    const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x202020, 0.4);
    ctx.scene.add(hemiLight);
  }

  // ---------------------------------------------------------------------------
  // Interactive objects
  // ---------------------------------------------------------------------------

  private buildInteractiveObjects(model: THREE.Object3D, ctx: SceneContext): void {
    model.updateMatrixWorld(true);
    const groups = this.collectModelGroups(model);

    for (const [groupNode, meshes] of groups) {
      const combinedBox = new THREE.Box3();
      for (const m of meshes) {
        if (m.visible) combinedBox.union(new THREE.Box3().setFromObject(m));
      }
      if (combinedBox.isEmpty()) continue;

      const category = GROUP_CATEGORY[groupNode.name];
      if (category === undefined) {
        const fallback = this.classifyByGeometry(combinedBox, ctx);
        if (fallback === 'skip') continue;
        this.pushInteractive(ctx, groupNode, combinedBox, fallback);
        continue;
      }
      if (category === 'skip') continue;

      if (groupNode.name === 'G_121') {
        this.buildG121Details(groupNode, combinedBox, ctx);
        continue;
      }

      this.pushInteractive(ctx, groupNode, combinedBox, category);

      // Apply specific interactions to named objects
      if (groupNode.name === 'G_10') {
        this.markSinkInteractive(groupNode, ctx);
      } else if (groupNode.name === 'G_1') {
        this.markWindowInteractive(groupNode, 'Kabinet Dapur');
      }
    }

    this.assignDisplayNames(ctx);
  }

  /**
   * Nudges the detected sink (`Mesh9` under G_121 > _ra1) slightly to the
   * left in world X. Runs before interactive/hitbox analysis so the derived
   * sink hitbox and the faucet water anchor pick up the new position. It is a
   * no-op when the expected sink structure is not found.
   */
  private shiftSink(model: THREE.Object3D, ctx: SceneContext): void {
    const worldDx =
      SINK_SHIFT_X_METERS * Math.max(ctx.sceneScale, 1e-6) +
      SINK_SHIFT_X_EXTRA_UNITS;

    model.traverse((child) => {
      if (child.name !== 'Mesh9' || !child.parent || child.parent.name !== '_ra1') return;

      // Convert the world-space delta into this node's local X. The GLB root
      // chain carries a 0.01 scale, so local units differ from world units.
      const parent = child.parent;
      parent.updateWorldMatrix(true, true);
      const parentXScale = new THREE.Vector3()
        .setFromMatrixColumn(parent.matrixWorld, 0)
        .length();
      if (parentXScale === 0) return;

      child.position.x += worldDx / parentXScale;
    });
  }

  /**
   * Makes the sink unit's meshes render as fully transparent. Runs after
   * `buildInteractiveObjects`, so it applies to the sink's cloned materials
   * (created by the faucet highlight wiring) and never leaks onto shared
   * materials elsewhere in the kitchen. Geometry, hitbox and raycasts are
   * untouched.
   */
  private makeSinkTransparent(model: THREE.Object3D): void {
    if (!SINK_TRANSPARENT) return;

    model.traverse((child) => {
      if (child.name !== 'Mesh9' || !child.parent || child.parent.name !== '_ra1') return;

      child.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh !== true) return;
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (!material) return;
        const apply = (mat: THREE.Material): void => {
          mat.transparent = true;
          mat.opacity = 0;
          mat.depthWrite = false;
        };
        if (Array.isArray(material)) material.forEach(apply);
        else apply(material);
      });
    });
  }

  /**
   * Removes a named node (and its whole subtree) from a loaded model. Used to
   * strip a single model node at runtime without touching the .glb itself.
   */
  private removeModelNode(model: THREE.Object3D, name: string): void {
    const nodes: THREE.Object3D[] = [];
    model.traverse((node) => {
      if (node.name === name) nodes.push(node);
    });
    for (const node of nodes) {
      if (node.parent) node.parent.remove(node);
    }
  }

  private markSinkInteractive(groupNode: THREE.Object3D, ctx: SceneContext): void {
    // Mark the group as interactable (not individual meshes)
    groupNode.userData.interactable = true;
    groupNode.userData.interaction = 'faucet';
    groupNode.userData.displayName = 'Wastafel Meja Kerja 2';

    // Faucet materials are cloned once so hover highlight never tints the
    // rest of the kitchen (materials may be shared across the model).
    const highlightMaterials: THREE.Material[] = [];
    groupNode.traverse((child) => {
      if ((child as THREE.Mesh).isMesh !== true) return;
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      if (Array.isArray(material)) {
        const clones = material.map((m) => m.clone());
        mesh.material = clones;
        highlightMaterials.push(...clones);
      } else {
        const clone = material.clone();
        mesh.material = clone;
        highlightMaterials.push(clone);
      }
    });
    groupNode.userData.highlightMaterials = highlightMaterials;
    groupNode.userData.faucetOpen = false;
  }

  private markWindowInteractive(groupNode: THREE.Object3D, label: string): void {
    // Mark the group as interactable
    groupNode.userData.interactable = true;
    groupNode.userData.interaction = 'window';
    groupNode.userData.windowName = groupNode.name;
    groupNode.userData.windowLabel = label;
  }

  /** Groups meshes under the top-level model groups (G_* / interiors). */
  private collectModelGroups(model: THREE.Object3D): Map<THREE.Object3D, THREE.Object3D[]> {
    const groups = new Map<THREE.Object3D, THREE.Object3D[]>();

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh !== true) return;
      const group = this.findGroupNode(child);
      if (!group) return;

      let arr = groups.get(group);
      if (!arr) {
        arr = [];
        groups.set(group, arr);
      }
      arr.push(child);
    });

    return groups;
  }

  private findGroupNode(child: THREE.Object3D): THREE.Object3D | null {
    let node = child.parent;
    while (node) {
      if (/^G_/.test(node.name) || node.name === 'interiors') return node;
      node = node.parent;
    }
    return null;
  }

  /** Geometry-based classification used when a group has no known mapping. */
  private classifyByGeometry(box: THREE.Box3, ctx: SceneContext): KitchenObjectCategory | 'skip' {
    const S = Math.max(ctx.sceneScale, 1e-6);
    const floorH = (box.min.y - ctx.floorY) / S;
    const topM = (box.max.y - ctx.floorY) / S;
    const size = new THREE.Vector3();
    box.getSize(size);
    const h = size.y / S;
    const footprint = Math.min(size.x, size.z) / S;
    const length = Math.max(size.x, size.z) / S;

    if (floorH <= 0.18) {
      if (h >= 1.7 && footprint >= 0.3 && length >= 0.4) return 'fridge';
      if (topM >= 0.7 && topM <= 1.1 && h >= 0.3) return 'counter';
      if (h >= 0.35) return 'cabinet';
      return 'skip';
    }
    if (h < 0.35 && topM >= 0.7 && topM <= 1.15 && footprint >= 0.4 && length >= 0.4) {
      return 'counter';
    }
    if (floorH >= 1.2 && floorH <= 1.55 && h <= 1.1 && footprint >= 0.25) return 'cabinet';
    if (floorH >= 0.6 && floorH <= 1.3 && h >= 0.15) {
      return footprint <= 0.7 && length <= 1.8 ? 'cabinet' : 'skip';
    }
    return 'skip';
  }

  /**
   * G_121 is the long worktop. It is split into:
   *   - `_ra1` (Mesh9): sink basin + faucet           -> 'sink'
   *   - `_ra2` (Mesh10): countertop fixtures/prep cluster -> 'prep_area'
   *   - Mesh11: the worktop slab itself              -> 'counter'
   */
  private buildG121Details(groupNode: THREE.Object3D, fullBox: THREE.Box3, ctx: SceneContext): void {
    const subcats = new Map<string, { node: THREE.Object3D; box: THREE.Box3 }>();

    groupNode.traverse((child) => {
      if (child === groupNode) return;
      if ((child as THREE.Mesh).isMesh !== true) return;

      const parentName = child.parent ? child.parent.name : '';
      const category = G121_SUBGROUP_CATEGORY[parentName];
      if (category === undefined || category === 'skip') return;

      const b = new THREE.Box3().setFromObject(child);
      if (b.isEmpty()) return;

      const existing = subcats.get(category);
      if (existing) {
        existing.box.union(b);
      } else {
        subcats.set(category, { node: child.parent || child, box: b.clone() });
      }
    });

    // The work surface is the top of the worktop slab itself, not the top of
    // a faucet/prep fixture mounted on it.
    const slab = subcats.get('counter');
    const workSurfaceY = slab ? slab.box.max.y : fullBox.max.y;

    let created = false;
    for (const [category, info] of subcats) {
      let box = info.box;

      // Fixtures reach the work front only through the countertop they sit on.
      // Span the fixture's zone over the slab depth so the ergonomics distance
      // is measured to the work line (the counter front), not to the back of a
      // small faucet/pit far behind it.
      if (category !== 'counter' && slab) {
        box = box
          .clone()
          .expandByPoint(new THREE.Vector3(info.box.min.x, info.box.max.y, slab.box.max.z))
          .expandByPoint(new THREE.Vector3(info.box.max.x, info.box.min.y, slab.box.min.z));
      }

      this.pushInteractive(ctx, info.node, box, category as KitchenObjectCategory, workSurfaceY);
      created = true;

      if (category === 'sink') {
        this.markFaucetInteractive(info.node, ctx);
      }
    }

    // Safety: if the split produced nothing (unexpected structure), fall back.
    if (!created) {
      this.pushInteractive(ctx, groupNode, fullBox, 'counter');
    }
  }

  /**
   * Tags the faucet group (Mesh9) as the single interactable faucet object,
   * without touching the model transform:
   *   - `userData.interactable = true` so the crosshair raycast can find it,
   *   - faucet materials are cloned once so hover highlight never tints the
   *     rest of the kitchen (materials may be shared across the model),
   *   - `userData.faucetOpen = false` tracks the ON/OFF state,
   *   - `userData.faucet = { nozzle, splashY }` (WORLD coords) anchors the
   *     water effect to the real spout tip of `Mesh9_img10_17_0`.
   */
  private markFaucetInteractive(node: THREE.Object3D, ctx: SceneContext): void {
    node.userData.interactable = true;
    node.userData.interaction = 'faucet';

    const highlightMaterials: THREE.Material[] = [];
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      if (Array.isArray(material)) {
        const clones = material.map((m) => m.clone());
        mesh.material = clones;
        highlightMaterials.push(...clones);
      } else {
        const clone = material.clone();
        mesh.material = clone;
        highlightMaterials.push(clone);
      }
    });
    node.userData.highlightMaterials = highlightMaterials;
    node.userData.faucetOpen = false;

    // World-space water anchor taken from the real spout mesh.
    const anchor = computeFaucetWaterAnchor(node, ctx);
    node.userData.faucet = { nozzle: anchor.nozzle, splashY: anchor.splashY };
  }

  private pushInteractive(
    ctx: SceneContext,
    obj: THREE.Object3D,
    bbox: THREE.Box3,
    category: KitchenObjectCategory,
    surfaceYOverride?: number
  ): void {
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    ctx.interactiveObjects.push({
      name: obj.name,
      displayName: CATEGORY_DISPLAY_NAMES[category],
      category,
      object3D: obj,
      boundingBox: bbox.clone(),
      center: center.clone(),
      height: size.y,
      surfaceY: surfaceYOverride !== undefined ? surfaceYOverride : bbox.max.y,
      movable: !NON_MOVABLE_GROUPS.has(obj.name),
    });
  }

  /**
   * Base-room groups (G_10, G_8, ...) may include taller elements (backsplash,
   * tall side panels) so their bounding-box top overstates the work surface.
   * Snap the work-surface height of every counter/sink/prep object to the
   * authoritative worktop top — the G_121 slab — so ergonomics evaluate against
   * the real working height (~0.85–0.9m) instead of a decorative element.
   */
  private normalizeWorkSurfaces(ctx: SceneContext): void {
    const S = Math.max(ctx.sceneScale, 1e-6);

    let workRefY = ctx.interactiveObjects.find(
      (o) => o.category === 'counter' && (o.name === 'Mesh11' || o.name === 'Mesh30')
    )?.surfaceY;

    if (workRefY === undefined) {
      const candidates = ctx.interactiveObjects
        .filter((o) => o.category === 'counter')
        .map((o) => o.surfaceY)
        .filter((y) => (y - ctx.floorY) / S >= 0.7 && (y - ctx.floorY) / S <= 1.05)
        .sort((a, b) => a - b);
      if (candidates.length > 0) {
        workRefY = candidates[Math.floor(candidates.length / 2)];
      }
    }

    if (workRefY === undefined) return;

    for (const obj of ctx.interactiveObjects) {
      if (obj.category !== 'counter' && obj.category !== 'prep_area' && obj.category !== 'sink') continue;
      if (Math.abs(obj.surfaceY - workRefY) / S > 0.08) {
        obj.surfaceY = workRefY;
      }
    }
  }

  /** Adds unique readable labels for repeated categories ("Meja Kerja Dapur 1", ...). */
  private assignDisplayNames(ctx: SceneContext): void {
    const counts = new Map<KitchenObjectCategory, number>();

    const sorted = [...ctx.interactiveObjects].sort((a, b) => a.center.x - b.center.x);
    for (const obj of sorted) {
      const n = (counts.get(obj.category) ?? 0) + 1;
      counts.set(obj.category, n);
      if (n > 1) {
        obj.displayName = `${CATEGORY_DISPLAY_NAMES[obj.category]} ${n}`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Walkable area (used by debug overlay / navigation metadata)
  // ---------------------------------------------------------------------------

  private buildWalkableArea(model: THREE.Object3D, ctx: SceneContext): void {
    void model;
    const bounds = ctx.floorBounds && !ctx.floorBounds.isEmpty() ? ctx.floorBounds : ctx.sceneBoundingBox;

    const minCorner = new THREE.Vector3(
      bounds.min.x,
      ctx.floorY,
      bounds.min.z
    );
    const maxCorner = new THREE.Vector3(
      bounds.max.x,
      ctx.floorY,
      bounds.max.z
    );

    ctx.walkableArea = [minCorner, maxCorner];
  }

  private buildRoomShell(model: THREE.Object3D, ctx: SceneContext): void {
    const wallNames = ['G_0_extern_wall', 'G_1_extern_wall', 'G_3_extern_wall'];
    let standardWallMaterial: THREE.Material | THREE.Material[] | null = null;
    let floorMaterial: THREE.Material | THREE.Material[] | null = null;
    let floorGeo: THREE.BufferGeometry | null = null;
    const ceilingY = ctx.sceneBoundingBox.max.y;

    // Pass 1: find standard wall material (from G_1 or G_3) and floor
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh !== true) return;
      const mesh = child as THREE.Mesh;

      const groupNode = this.findGroupNode(mesh);
      const groupName = groupNode?.name ?? '';

      if (wallNames.includes(groupName) && groupName !== 'G_0_extern_wall') {
        if (!standardWallMaterial) {
          standardWallMaterial = mesh.material;
        }
      }

      if (groupName === 'interiors' || mesh.name === 'Mesh4_img2_4_0') {
        if (!floorMaterial) {
          floorMaterial = mesh.material;
          floorGeo = mesh.geometry;
        }
      }
    });

    // Pass 2: apply standard material to all exterior walls
    if (standardWallMaterial) {
      const stdMat = standardWallMaterial;
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh !== true) return;
        const mesh = child as THREE.Mesh;
        const groupNode = this.findGroupNode(mesh);
        const groupName = groupNode?.name ?? '';
        if (wallNames.includes(groupName) && mesh.material !== stdMat) {
          mesh.material = stdMat;
        }
      });
    }

    // Add missing north wall (at z = maxZ of scene bounding box)
    if (standardWallMaterial) {
      const roomBox = ctx.sceneBoundingBox;
      const minX = roomBox.min.x;
      const maxX = roomBox.max.x;
      const minY = roomBox.min.y;
      const maxY = roomBox.max.y;
      const maxZ = roomBox.max.z;

      const wallWidth = maxX - minX;
      const wallHeight = maxY - minY;

      const wallGeo = new THREE.PlaneGeometry(wallWidth, wallHeight);
      const stdMat = standardWallMaterial as THREE.Material | THREE.Material[];
      const wallMat = Array.isArray(stdMat) ? stdMat[0].clone() : stdMat.clone();
      wallMat.side = THREE.DoubleSide;

      const northWall = new THREE.Mesh(wallGeo, wallMat);
      northWall.rotation.y = Math.PI;
      northWall.position.set(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        maxZ
      );
      northWall.name = 'north_wall';
      northWall.receiveShadow = true;
      northWall.castShadow = true;
      model.add(northWall);
    }

    // Create ceiling covering full room bounds (not just floor geometry)
    if (floorMaterial) {
      const roomBox = ctx.sceneBoundingBox;
      const roomWidth = roomBox.max.x - roomBox.min.x;
      const roomDepth = roomBox.max.z - roomBox.min.z;

      const ceilingGeo = new THREE.PlaneGeometry(roomWidth, roomDepth);
      const mat = floorMaterial as THREE.Material | THREE.Material[];
      const ceilingMat = Array.isArray(mat) ? mat[0].clone() : mat.clone();
      ceilingMat.side = THREE.DoubleSide;

      const ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat);
      ceilingMesh.rotation.x = -Math.PI / 2;
      ceilingMesh.position.set(
        (roomBox.min.x + roomBox.max.x) / 2,
        ceilingY,
        (roomBox.min.z + roomBox.max.z) / 2
      );
      ceilingMesh.name = 'ceiling';
      ceilingMesh.receiveShadow = true;
      model.add(ceilingMesh);
    }

    // Mark windows as interactable
    this.setupWindowInteractables(model);
  }

  private setupWindowInteractables(model: THREE.Object3D): void {
    const windowGroupNames = ['G_67', 'G_68', 'G_69'];
    const windowLabels: Record<string, string> = {
      'G_67': 'Jendela 1',
      'G_68': 'Jendela 2',
      'G_69': 'Jendela 3',
    };

    model.traverse((node) => {
      if (windowGroupNames.includes(node.name)) {
        node.userData.interactable = true;
        node.userData.interaction = 'window';
        node.userData.windowName = node.name;
        node.userData.windowLabel = windowLabels[node.name];
      }
    });
  }
}