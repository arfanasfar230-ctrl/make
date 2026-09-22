import * as THREE from 'three';
import type { SceneContext } from './types';

export class ProximityTeleportSystem {
  private ctx: SceneContext;
  private readonly TARGET_POSITION = new THREE.Vector3(31.79, -0.01, 18.50);
  private readonly RADIUS = 1.2;
  private wasInside = false;
  private hasTriggered = false;

  private popup: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private yesBtn: HTMLElement | null = null;
  private noBtn: HTMLElement | null = null;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundClickOutside: (e: MouseEvent) => void;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundClickOutside = this.handleClickOutside.bind(this);
    this.createPopup();
  }

  private createPopup(): void {
    this.overlay = document.createElement('div');
    this.overlay.id = 'proximity-teleport-overlay';
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
      <h3 style="margin: 0 0 12px; font-size: 1.25rem; color: #38bdf8;">Masuk ke ErgoSim?</h3>
      <p style="margin: 0 0 24px; opacity: 0.8;">Anda akan diarahkan ke halaman ErgoSim.</p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="proximity-yes-btn" style="
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
        <button id="proximity-no-btn" style="
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

    this.yesBtn = document.getElementById('proximity-yes-btn')!;
    this.noBtn = document.getElementById('proximity-no-btn')!;

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
    window.location.assign('https://projek-2-enuma.vercel.app/');
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
    this.hasTriggered = false;
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

  public update(): void {
    if (this.isPopupVisible()) return;

    const playerPos = this.ctx.camera.position.clone();
    playerPos.y = this.ctx.floorY;

    const targetPos = this.TARGET_POSITION.clone();
    targetPos.y = this.ctx.floorY;

    const distance = playerPos.distanceTo(targetPos);
    const isInside = distance <= this.RADIUS;

    if (isInside && !this.wasInside) {
      this.showPopup();
      this.hasTriggered = true;
    }

    if (!isInside && this.wasInside) {
      this.hasTriggered = false;
    }

    this.wasInside = isInside;
  }

  public isPopupVisible(): boolean {
    return this.overlay?.style.display === 'flex';
  }

  public dispose(): void {
    this.hidePopup();
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}