import * as THREE from 'three';
import type { SceneContext, CollisionBox } from './types';
import { CollisionSystem } from './CollisionSystem';

export enum FridgeState {
  IDLE = 'idle',
  INTERACTION_MENU = 'interaction_menu',
}

export enum FridgeDoorState {
  CLOSED = 'closed',
  OPENING = 'opening',
  OPEN = 'open',
  CLOSING = 'closing',
}

export interface FridgeEvents {
  onDoorOpened?: () => void;
  onDoorClosed?: () => void;
  onDoorCollision?: () => void;
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

  private readonly INTERACTION_DISTANCE = 2.5;

  private interactionPanel: HTMLElement | null = null;
  private interactionPanelOptions: HTMLElement | null = null;
  private promptText: HTMLElement | null = null;
  private interactionPrompt: HTMLElement | null = null;
  private fridgeHovered = false;
  private pointerLocked = false;

  private doorState: FridgeDoorState = FridgeDoorState.CLOSED;
  private doorAnimationDuration = 0;
  private doorAnimationTimer = 0;
  private doorCooldown = 0;
  private doorCollisionPenaltyApplied = false;
  private events: FridgeEvents = {};

  constructor(ctx: SceneContext, collision: CollisionSystem) {
    this.ctx = ctx;
    this.collision = collision;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
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
      this.doorAnimationDuration = doorAnim.duration;
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

    this.updateDoorAnimation(delta);
    this.updateCollider();
    this.checkHover();
  }

  private updateDoorAnimation(delta: number): void {
    if (this.isDoorAnimating()) {
      this.doorAnimationTimer += delta;
      this.checkDoorCollision();
      if (this.doorAnimationTimer >= this.doorAnimationDuration) {
        if (this.doorState === FridgeDoorState.OPENING) {
          this.doorState = FridgeDoorState.OPEN;
          this.isOpen = true;
          this.doorCooldown = 1.4;
          this.events.onDoorOpened?.();
        } else {
          this.doorState = FridgeDoorState.CLOSED;
          this.isOpen = false;
          this.doorCooldown = 0.5;
          this.events.onDoorClosed?.();
        }
      }
    }

    if (this.doorCooldown > 0) {
      this.doorCooldown -= delta;
    }
  }

  private updateCollider(): void {
    if (!this.fridgeModel || !this.fridgeCollider) return;

    this.fridgeModel.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(this.fridgeModel);
    this.fridgeCollider.min.copy(bbox.min);
    this.fridgeCollider.max.copy(bbox.max);
  }

  private isOpen = false;

  public isFridgeOpen(): boolean {
    return this.isOpen;
  }

  public getDoorState(): FridgeDoorState {
    return this.doorState;
  }

  public isDoorAnimating(): boolean {
    return this.doorState === FridgeDoorState.OPENING || this.doorState === FridgeDoorState.CLOSING;
  }

  public setEvents(events: FridgeEvents): void {
    this.events = events;
  }

  private checkDoorCollision(): void {
    if (this.doorCollisionPenaltyApplied) return;
    if (!this.fridgeModel) return;

    const playerPos = this.ctx.camera.position.clone();
    playerPos.y = this.ctx.floorY;
    const fridgePos = this.fridgeModel.position.clone();
    fridgePos.y = this.ctx.floorY;

    const distance = playerPos.distanceTo(fridgePos);
    const threshold = 1.5 * Math.max(this.ctx.sceneScale, 1e-6);

    if (distance < threshold) {
      this.doorCollisionPenaltyApplied = true;
      this.events.onDoorCollision?.();
    }
  }

  private checkHover(): void {
    if (!this.fridgeModel || this.state === FridgeState.INTERACTION_MENU) return;

    const castFrom = this.pointerLocked
      ? new THREE.Vector2(0, 0)
      : this.mouse;

    this.raycaster.setFromCamera(castFrom, this.ctx.camera);
    this.raycaster.far = this.INTERACTION_DISTANCE * Math.max(this.ctx.sceneScale, 1e-6);

    const hits = this.raycaster.intersectObject(this.fridgeModel, true);
    const isHovered = hits.length > 0;

    this.fridgeHovered = isHovered;

    if (isHovered && this.state === FridgeState.IDLE) {
      this.showPrompt('Kulkas — [F] Buka/Tutup Pintu | [E] Analisis');
    } else if (!isHovered && this.state === FridgeState.IDLE) {
      this.hidePrompt();
    }
  }

  public setMouse(x: number, y: number): void {
    this.mouse.set(x, y);
  }

  public setPointerLocked(locked: boolean): void {
    this.pointerLocked = locked;
    if (locked) {
      this.mouse.set(0, 0);
    }
  }

  public onMouseDown(_event: MouseEvent): boolean {
    return false;
  }

  public onMouseUp(): void {
    this.state = FridgeState.IDLE;
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
    if (this.doorCooldown > 0) return;
    if (this.isDoorAnimating()) return;

    if (this.doorState === FridgeDoorState.CLOSED) {
      this.doorState = FridgeDoorState.OPENING;
      this.doorAnimationAction.reset();
      this.doorAnimationAction.timeScale = 1;
      this.doorAnimationAction.paused = false;
      this.doorAnimationAction.play();
      this.doorAnimationTimer = 0;
      this.doorCollisionPenaltyApplied = false;
      this.showPrompt('Pintu Kulkas Terbuka');
    } else if (this.doorState === FridgeDoorState.OPEN) {
      this.doorState = FridgeDoorState.CLOSING;
      this.doorAnimationAction.timeScale = -1;
      this.doorAnimationAction.paused = false;
      this.doorAnimationAction.play();
      this.doorAnimationTimer = 0;
      this.showPrompt('Pintu Kulkas Ditutup');
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

    document.exitPointerLock?.();

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
