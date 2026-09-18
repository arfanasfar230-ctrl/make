import * as THREE from 'three';
import type { SceneContext, CollisionBox } from './types';
import { CollisionSystem } from './CollisionSystem';

export enum FridgeState {
  IDLE = 'idle',
  MOVE = 'move',
  ROTATE = 'rotate',
  INTERACTION_MENU = 'interaction_menu',
}

export class FridgeInteractionSystem {
  private ctx: SceneContext;
  private collision: CollisionSystem;
  private fridgeModel: THREE.Group | null = null;
  private fridgeCollider: CollisionBox | null = null;
  private animationMixer: THREE.AnimationMixer | null = null;
  private doorAnimationAction: THREE.AnimationAction | null = null;
  private state: FridgeState = FridgeState.IDLE;

  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private movePlane: THREE.Plane;
  private moveOffset: THREE.Vector3 = new THREE.Vector3();
  private isDragging = false;
  private dragStartPos: THREE.Vector3 | null = null;

  private readonly FRIDGE_MOVE_SPEED = 1.0;
  private readonly ROTATION_SPEED = Math.PI / 2;
  private readonly INTERACTION_DISTANCE = 2.5;

  private interactionPanel: HTMLElement | null = null;
  private interactionPanelOptions: HTMLElement | null = null;
  private promptText: HTMLElement | null = null;
  private interactionPrompt: HTMLElement | null = null;
  private fridgeHovered = false;
  // Track pointer lock state so we always use crosshair (0,0) in FPS mode
  private pointerLocked = false;

  constructor(ctx: SceneContext, collision: CollisionSystem) {
    this.ctx = ctx;
    this.collision = collision;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.movePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  public isFridgeHovered(): boolean {
    return this.fridgeHovered;
  }

  public async initialize(fridgeModel: THREE.Group, animations: THREE.AnimationClip[] = []): Promise<void> {
    this.fridgeModel = fridgeModel;
    this.setupCollider();
    this.setupAnimation(animations);
    this.setupUI();
  }

  private setupCollider(): void {
    if (!this.fridgeModel) return;

    this.fridgeModel.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(this.fridgeModel);

    this.fridgeCollider = {
      min: bbox.min.clone(),
      max: bbox.max.clone(),
      object3D: this.fridgeModel,
    };

    this.collision.addCollisionBox(this.fridgeCollider);
  }

  private setupAnimation(animations: THREE.AnimationClip[]): void {
    if (!this.fridgeModel) return;

    this.animationMixer = new THREE.AnimationMixer(this.fridgeModel);

    const doorAnim = animations.find((clip) => clip.name === 'CINEMA_4D_Main');
    if (doorAnim && this.animationMixer) {
      this.doorAnimationAction = this.animationMixer.clipAction(doorAnim);
      this.doorAnimationAction.setLoop(THREE.LoopOnce, 1);
      this.doorAnimationAction.clampWhenFinished = true;
    }
  }

  private getBaseUrl(): string {
    try {
      return import.meta.env.BASE_URL ?? `${window.location.origin}/`;
    } catch {
      return `${window.location.origin}/`;
    }
  }

  private setupUI(): void {
    this.interactionPanel = document.getElementById('interaction-panel');
    this.interactionPanelOptions = document.getElementById('interaction-panel-options');
    this.promptText = document.getElementById('prompt-text');
    this.interactionPrompt = document.getElementById('interaction-prompt');
  }

  public update(delta: number): void {
    if (this.animationMixer) {
      this.animationMixer.update(delta);
    }

    this.updateCollider();
    this.checkHover();
  }

  private updateCollider(): void {
    if (!this.fridgeModel || !this.fridgeCollider) return;

    this.fridgeModel.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(this.fridgeModel);
    this.fridgeCollider.min.copy(bbox.min);
    this.fridgeCollider.max.copy(bbox.max);
  }

  public onMoveRequested?: () => void;
  private isOpen = false;

  private checkHover(): void {
    if (!this.fridgeModel || this.state === FridgeState.INTERACTION_MENU) return;

    // In FPS/pointer-lock mode, ALWAYS use crosshair (center) for detection.
    // Only use actual mouse position when cursor is free (e.g. mobile or unlocked).
    const castFrom = this.pointerLocked
      ? new THREE.Vector2(0, 0)
      : this.mouse;

    this.raycaster.setFromCamera(castFrom, this.ctx.camera);
    this.raycaster.far = this.INTERACTION_DISTANCE * Math.max(this.ctx.sceneScale, 1e-6);

    const hits = this.raycaster.intersectObject(this.fridgeModel, true);
    const isHovered = hits.length > 0;

    this.fridgeHovered = isHovered;

    if (isHovered && this.state === FridgeState.IDLE) {
      this.showPrompt('Kulkas — [F] Buka/Tutup Pintu | [G] Pindah & Putar | [E] Analisis');
    } else if (!isHovered && this.state === FridgeState.IDLE) {
      this.hidePrompt();
    }
  }

  public setMouse(x: number, y: number): void {
    this.mouse.set(x, y);
  }

  /** Call this from main.ts whenever pointer lock state changes. */
  public setPointerLocked(locked: boolean): void {
    this.pointerLocked = locked;
    if (locked) {
      // Always use crosshair center when pointer is locked
      this.mouse.set(0, 0);
    }
  }

  public onMouseDown(_event: MouseEvent): boolean {
    // Movement & rotation are handled cleanly by FurnitureMoveSystem ([G] / UI button)
    return false;
  }

  public onMouseUp(): void {
    if (this.state === FridgeState.MOVE) {
      this.state = FridgeState.IDLE;
      this.isDragging = false;
      this.dragStartPos = null;
    }
  }

  public onKeyDown(key: string): boolean {
    if (!this.fridgeModel) return false;

    if (key === 'KeyF' && this.isPlayerNearFridge()) {
      this.toggleFridgeDoor();
      return true;
    }

    if (key === 'Escape') {
      this.hideInteractionMenu();
      return true;
    }

    return false;
  }

  public toggleFridgeDoor(): void {
    if (!this.doorAnimationAction) return;

    if (this.isOpen) {
      this.doorAnimationAction.timeScale = -1;
      this.doorAnimationAction.paused = false;
      this.doorAnimationAction.play();
      this.isOpen = false;
      this.showPrompt('Pintu Kulkas Ditutup');
    } else {
      this.doorAnimationAction.reset();
      this.doorAnimationAction.timeScale = 1;
      this.doorAnimationAction.paused = false;
      this.doorAnimationAction.play();
      this.isOpen = true;
      this.showPrompt('Pintu Kulkas Terbuka');
    }
  }

  private isPlayerNearFridge(): boolean {
    if (!this.fridgeModel) return false;
    const playerPos = this.ctx.camera.position.clone();
    playerPos.y = this.ctx.floorY;
    const fridgePos = this.fridgeModel.position.clone();
    fridgePos.y = this.ctx.floorY;
    return playerPos.distanceTo(fridgePos) < this.INTERACTION_DISTANCE * Math.max(this.ctx.sceneScale, 1e-6);
  }

  private showPrompt(text: string): void {
    if (this.promptText && this.interactionPrompt) {
      this.promptText.textContent = text;
      this.interactionPrompt.style.display = 'block';
    }
  }

  public hidePrompt(): void {
    if (this.interactionPrompt) {
      this.interactionPrompt.style.display = 'none';
    }
  }

  public showInteractionMenu(): void {
    if (!this.interactionPanel || !this.interactionPanelOptions) return;

    this.state = FridgeState.INTERACTION_MENU;
    this.interactionPanelOptions.innerHTML = '';

    const title = this.interactionPanel.querySelector('h4');
    if (title) title.textContent = 'Kulkas';

    const openBtn = document.createElement('button');
    openBtn.className = 'interaction-option-btn';
    openBtn.textContent = this.isOpen ? 'Tutup Pintu Kulkas' : 'Buka Pintu Kulkas';
    openBtn.addEventListener('click', () => {
      this.toggleFridgeDoor();
      this.hideInteractionMenu();
    });
    this.interactionPanelOptions.appendChild(openBtn);

    const moveBtn = document.createElement('button');
    moveBtn.className = 'interaction-option-btn';
    moveBtn.textContent = '📦 Pindah & Putar Kulkas (G)';
    moveBtn.addEventListener('click', () => {
      this.hideInteractionMenu();
      this.onMoveRequested?.();
    });
    this.interactionPanelOptions.appendChild(moveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'interaction-option-btn cancel';
    cancelBtn.textContent = 'Batal';
    cancelBtn.addEventListener('click', () => this.hideInteractionMenu());
    this.interactionPanelOptions.appendChild(cancelBtn);

    this.interactionPanel.style.display = 'block';
    this.hidePrompt();
  }

  public hideInteractionMenu(): void {
    if (this.interactionPanel) {
      this.interactionPanel.style.display = 'none';
      this.interactionPanelOptions!.innerHTML = '';
    }
    this.state = FridgeState.IDLE;
  }

  private openFridge(): void {
    if (this.doorAnimationAction) {
      this.doorAnimationAction.reset();
      this.doorAnimationAction.play();
    }
  }

  public getState(): FridgeState {
    return this.state;
  }

  public getFridgeModel(): THREE.Group | null {
    return this.fridgeModel;
  }

  public dispose(): void {
    if (this.animationMixer) {
      this.animationMixer.stopAllAction();
    }
    if (this.fridgeCollider) {
      this.collision.removeCollisionBox(this.fridgeCollider);
    }
    this.hideInteractionMenu();
    this.hidePrompt();
  }
}