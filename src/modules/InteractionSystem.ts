import * as THREE from 'three';
import type { SceneContext } from './types';
import { FaucetWater } from './FaucetWater';
import { WindowSystem, WindowData } from './WindowSystem';

export const INTERACT_PROMPT = 'F / Klik untuk berinteraksi';

export type InteractableType = 'faucet' | 'window' | 'none';

export interface InteractionTarget {
  object: THREE.Object3D;
  type: InteractableType;
  name: string;
  displayName: string;
}

export class InteractionSystem {
  private ctx: SceneContext;
  private raycaster: THREE.Raycaster;
  private center: THREE.Vector2;
  private roots: THREE.Object3D[] = [];
  private faucetRoot: THREE.Object3D | null = null;
  private windowRoots: Map<string, THREE.Object3D> = new Map();
  private hovered: THREE.Object3D | null = null;
  private hoveredType: InteractableType = 'none';
  private highlightMats: Array<{ mat: THREE.Material & { emissive?: THREE.Color }; hex: number }> = [];
  private water: FaucetWater | null = null;
  private windowSystem: WindowSystem;
  private readonly hoverEmissive = 0x1d3a4a;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.raycaster = new THREE.Raycaster();
    this.center = new THREE.Vector2(0, 0);
    this.windowSystem = new WindowSystem(ctx);

    const model = ctx.kitchenModel;
    if (model) {
      model.traverse((child) => {
        if (child.userData.interactable === true) {
          this.roots.push(child);
          if (child.userData.interaction === 'faucet') {
            this.faucetRoot = child;
          }
        }
        if (child.userData.interactable === true && child.userData.interaction === 'window') {
          this.windowRoots.set(child.userData.windowName, child);
        }
      });
    }

    if (this.faucetRoot) {
      const mats = this.faucetRoot.userData.highlightMaterials as THREE.Material[] | undefined;
      if (mats) {
        for (const mat of mats) {
          const withEmissive = mat as THREE.Material & { emissive?: THREE.Color };
          this.highlightMats.push({
            mat: withEmissive,
            hex: withEmissive.emissive ? withEmissive.emissive.getHex() : 0,
          });
        }
      }

      const faucetData = this.faucetRoot.userData.faucet as
        | { nozzle?: THREE.Vector3; splashY?: number }
        | undefined;
      if (faucetData && faucetData.nozzle && faucetData.splashY !== undefined) {
        this.water = new FaucetWater(
          ctx.scene,
          faucetData.nozzle,
          faucetData.splashY,
          Math.max(ctx.sceneScale, 1e-6)
        );
      }
    }
  }

  public getWindowSystem(): WindowSystem {
    return this.windowSystem;
  }

  /** Raycast from the camera center; update hover highlight + water. */
  public update(delta: number): THREE.Object3D | null {
    if (this.roots.length > 0) {
      const S = Math.max(this.ctx.sceneScale, 1e-6);
      this.raycaster.setFromCamera(this.center, this.ctx.camera);
      this.raycaster.far = 2.5 * S;
      const hits = this.raycaster.intersectObjects(this.roots, true);
      const interactable = hits.length > 0 ? this.findInteractable(hits[0].object) : null;
      this.setHovered(interactable);
    }

    if (this.water) {
      this.water.update(delta, Math.max(this.ctx.sceneScale, 1e-6));
    }

    this.windowSystem.update(delta);

    return this.hovered;
  }

  /** Walk up from a hit child mesh to the tagged interactable parent. */
  private findInteractable(obj: THREE.Object3D | null): THREE.Object3D | null {
    let node = obj;
    while (node) {
      if (node.userData.interactable === true) return node;
      node = node.parent;
    }
    return null;
  }

  private setHovered(root: THREE.Object3D | null): void {
    if (root === this.hovered) return;
    this.hovered = root;
    this.hoveredType = root?.userData.interaction as InteractableType ?? 'none';
    const on = root !== null;
    for (const entry of this.highlightMats) {
      if (entry.mat.emissive) {
        entry.mat.emissive.setHex(on ? this.hoverEmissive : entry.hex);
      }
    }
  }

  public getHover(): THREE.Object3D | null {
    return this.hovered;
  }

  public getHoverType(): InteractableType {
    return this.hoveredType;
  }

  public getHoverLabel(): string | null {
    if (!this.hovered) return null;
    if (this.hoveredType === 'faucet') return 'F / Klik - Nyalakan/Matikan Kran';
    if (this.hoveredType === 'window') return 'F / Klik - Buka/Tutup Jendela';
    return INTERACT_PROMPT;
  }

  /**
   * Run the interaction for the hovered object.
   * Faucet: toggles CLOSED <-> OPEN.
   * Window: toggles OPEN <-> CLOSED.
   * Returns true when something happened.
   */
  public tryInteract(): boolean {
    if (!this.hovered) return false;
    if (this.hovered === this.faucetRoot && this.water) {
      this.water.setOpen(!this.water.isOpen());
      this.hovered.userData.faucetOpen = this.water.isOpen();
      return true;
    }
    if (this.hoveredType === 'window') {
      const windowName = this.hovered.userData.windowName;
      if (windowName) {
        this.windowSystem.toggleWindow(windowName);
        return true;
      }
    }
    return false;
  }

  public isFaucetOpen(): boolean {
    return this.water ? this.water.isOpen() : false;
  }
}
