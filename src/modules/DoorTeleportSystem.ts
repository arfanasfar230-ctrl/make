import * as THREE from 'three';
import type { SceneContext } from './types';

export class DoorTeleportSystem {
  private ctx: SceneContext;
  private raycaster: THREE.Raycaster;
  private doorHitbox: THREE.Box3;
  private readonly DOOR_POSITION = new THREE.Vector3(31.79, -0.01, 18.50);
  private readonly HITBOX_SIZE = new THREE.Vector3(1.5, 2.5, 0.5);
  private readonly INTERACTION_DISTANCE = 3.0;
  private isHovered = false;
  private hasInteractedThisSession = false;
  private doorHelper: THREE.Box3Helper | null = null;
  private showDebugHitbox = true;

  private popup: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private yesBtn: HTMLElement | null = null;
  private noBtn: HTMLElement | null = null;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundClickOutside: (e: MouseEvent) => void;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.raycaster = new THREE.Raycaster();

    const half = this.HITBOX_SIZE.clone().multiplyScalar(0.5);
    this.doorHitbox = new THREE.Box3(
      this.DOOR_POSITION.clone().sub(half),
      this.DOOR_POSITION.clone().add(half)
    );

    // Create debug hitbox visualization
    this.doorHelper = new THREE.Box3Helper(this.doorHitbox, new THREE.Color(0xff00ff));
    const mat = this.doorHelper.material as THREE.LineBasicMaterial;
    mat.transparent = true;
    mat.opacity = 0.5;
    mat.depthWrite = false;
    this.ctx.scene.add(this.doorHelper);

    this.createPopup();
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundClickOutside = this.handleClickOutside.bind(this);
  }

  private createPopup(): void {
    this.overlay = document.createElement('div');
    this.overlay.id = 'door-teleport-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
    `;

    this.popup = document.createElement('div');
    this.popup.style.cssText = `
      background: #1a1a2e;
      border: 2px solid #38bdf8;
      border-radius: 12px;
      padding: 24px 32px;
      min-width: 300px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #e2e8f0;
    `;

    this.popup.innerHTML = `
      <h3 style="margin: 0 0 12px; font-size: 1.25rem; color: #38bdf8;">Masuk ke ErgoPur?</h3>
      <p style="margin: 0 0 24px; opacity: 0.8;">Anda akan diarahkan ke halaman ErgoPur.</p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="door-yes-btn" style="
          background: #38bdf8;
          color: #0f172a;
          border: none;
          padding: 10px 24px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          font-size: 0.95rem;
          transition: background 0.2s;
        ">Iya</button>
        <button id="door-no-btn" style="
          background: #334155;
          color: #e2e8f0;
          border: none;
          padding: 10px 24px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          font-size: 0.95rem;
          transition: background 0.2s;
        ">Tidak</button>
      </div>
    `;

    this.overlay.appendChild(this.popup);
    document.body.appendChild(this.overlay);

    this.yesBtn = document.getElementById('door-yes-btn')!;
    this.noBtn = document.getElementById('door-no-btn')!;

    this.yesBtn.addEventListener('click', () => this.onYes());
    this.noBtn.addEventListener('click', () => this.onNo());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.onNo();
    });

    this.yesBtn.addEventListener('mouseenter', () => this.yesBtn!.style.background = '#0ea5e9');
    this.yesBtn.addEventListener('mouseleave', () => this.yesBtn!.style.background = '#38bdf8');
    this.noBtn.addEventListener('mouseenter', () => this.noBtn!.style.background = '#475569');
    this.noBtn.addEventListener('mouseleave', () => this.noBtn!.style.background = '#334155');
  }

  private onYes(): void {
    this.hidePopup();
    window.location.assign('https://make-us61.vercel.app/');
  }

  private onNo(): void {
    this.hidePopup();
  }

  private showPopup(): void {
    if (this.overlay) {
      this.overlay.style.display = 'flex';
      document.exitPointerLock?.();
      document.addEventListener('keydown', this.boundKeyDown);
      document.addEventListener('click', this.boundClickOutside);
    }
  }

  private hidePopup(): void {
    if (this.overlay) {
      this.overlay.style.display = 'none';
      document.removeEventListener('keydown', this.boundKeyDown);
      document.removeEventListener('click', this.boundClickOutside);
    }
    this.hasInteractedThisSession = false;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.hidePopup();
    }
  }

  private handleClickOutside(e: MouseEvent): void {
    if (this.overlay && e.target === this.overlay) {
      this.hidePopup();
    }
  }

  public update(delta: number): void {
    if (this.showDebugHitbox && this.doorHelper) {
      this.doorHelper.visible = true;
    } else if (this.doorHelper) {
      this.doorHelper.visible = false;
    }

    if (this.isPopupVisible()) return;

    const scale = Math.max(this.ctx.sceneScale, 1e-6);
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.ctx.camera);
    this.raycaster.far = this.INTERACTION_DISTANCE * scale;

    const hitPoint = new THREE.Vector3();
    const rayOrigin = this.raycaster.ray.origin;
    const rayDir = this.raycaster.ray.direction;

    const invDir = new THREE.Vector3(
      1 / rayDir.x,
      1 / rayDir.y,
      1 / rayDir.z
    );

    const min = this.doorHitbox.min;
    const max = this.doorHitbox.max;

    const t1 = (min.x - rayOrigin.x) * invDir.x;
    const t2 = (max.x - rayOrigin.x) * invDir.x;
    const t3 = (min.y - rayOrigin.y) * invDir.y;
    const t4 = (max.y - rayOrigin.y) * invDir.y;
    const t5 = (min.z - rayOrigin.z) * invDir.z;
    const t6 = (max.z - rayOrigin.z) * invDir.z;

    const tmin = Math.max(Math.max(Math.min(t1, t2), Math.min(t3, t4)), Math.min(t5, t6));
    const tmax = Math.min(Math.min(Math.max(t1, t2), Math.max(t3, t4)), Math.max(t5, t6));

    const intersects = tmax >= tmin && tmax >= 0 && tmin <= this.raycaster.far;

    this.isHovered = intersects;

    if (intersects && !this.hasInteractedThisSession) {
      this.showPrompt();
    } else if (!intersects) {
      this.hidePrompt();
    }
  }

  private showPrompt(): void {
    const prompt = document.getElementById('interaction-prompt');
    const promptText = document.getElementById('prompt-text');
    if (prompt && promptText) {
      promptText.textContent = 'Pintu — [Klik] Masuk ke ErgoPur';
      prompt.style.display = 'block';
    }
  }

  private hidePrompt(): void {
    const prompt = document.getElementById('interaction-prompt');
    if (prompt) {
      prompt.style.display = 'none';
    }
  }

  public tryInteract(): boolean {
    if (!this.isHovered || this.isPopupVisible() || this.hasInteractedThisSession) {
      return false;
    }

    this.hasInteractedThisSession = true;
    this.showPopup();
    return true;
  }

  public isDoorHovered(): boolean {
    return this.isHovered;
  }

  public isPopupVisible(): boolean {
    return this.overlay?.style.display === 'flex';
  }

  public setDebugHitboxVisible(visible: boolean): void {
    this.showDebugHitbox = visible;
    if (visible && !this.doorHelper) {
      this.doorHelper = new THREE.Box3Helper(this.doorHitbox, new THREE.Color(0xff00ff));
      const mat = this.doorHelper.material as THREE.LineBasicMaterial;
      mat.transparent = true;
      mat.opacity = 0.5;
      mat.depthWrite = false;
      this.ctx.scene.add(this.doorHelper);
    }
  }

  public dispose(): void {
    this.hidePopup();
    if (this.doorHelper) {
      this.ctx.scene.remove(this.doorHelper);
      this.doorHelper = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}