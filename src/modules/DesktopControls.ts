import type { ControlInput } from './types';

/**
 * DesktopControls
 *
 * First-person camera look using the Pointer Lock API.
 *  - Click the game canvas to request pointer lock (cursor hidden, mouse deltas
 *    feed the camera directly via `movementX/movementY`).
 *  - ESC (native) releases pointer lock; look input is zeroed while unlocked.
 *  - Movement is WASD (optionally arrow keys as aliases). Arrow keys are never
 *    used for camera look.
 *  - If Pointer Lock is unsupported, falls back to click-and-drag look instead
 *    of failing.
 */
export class DesktopControls {
  private keys: Set<string> = new Set();
  private canvas: HTMLCanvasElement;
  private isPointerLocked: boolean = false;
  private lockSupported: boolean;
  private pendingInteract: boolean = false;
  private pendingMoveToggle: boolean = false;
  private pendingRotateSnap: boolean = false;
  private pendingPlace: boolean = false;
  private pendingCancel: boolean = false;
  private rotateWheelDelta: number = 0;
  private lookX: number = 0;
  private lookY: number = 0;

  // Double-click detection for pointer lock
  private lastClickTime = 0;
  private readonly DOUBLE_CLICK_THRESHOLD = 300; // ms

  // Fallback drag-look (Pointer Lock unavailable)
  private dragActive = false;
  private lastDrag = { x: 0, y: 0 };

  private onLockChange?: (locked: boolean) => void;

  constructor(canvas: HTMLCanvasElement, onLockChange?: (locked: boolean) => void) {
    this.canvas = canvas;
    this.onLockChange = onLockChange;
    this.lockSupported = typeof canvas.requestPointerLock === 'function';

    this.setupKeyboard();
    this.setupMouse();
  }

  private setupKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);

      if (e.code === 'KeyE') {
        this.pendingInteract = true;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        this.pendingInteract = true;
        this.pendingPlace = true;
      }
      if (e.code === 'KeyG') {
        this.pendingMoveToggle = true;
      }
      if (e.code === 'KeyR') {
        this.pendingRotateSnap = true;
      }
      if (e.code === 'Escape') {
        this.pendingCancel = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  private setupMouse(): void {
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    window.addEventListener('wheel', (e) => {
      // deltaY > 0 is scroll down, deltaY < 0 is scroll up
      this.rotateWheelDelta += (e.deltaY > 0 ? 1 : -1) * 35;
    }, { passive: true });

    if (this.lockSupported) {
      document.addEventListener('pointerlockchange', () => {
        this.isPointerLocked = document.pointerLockElement === this.canvas;
        this.lookX = 0;
        this.lookY = 0;
        this.onLockChange?.(this.isPointerLocked);
      });

      document.addEventListener('pointerlockerror', () => {
        this.isPointerLocked = false;
        this.lookX = 0;
        this.lookY = 0;
        this.onLockChange?.(false);
      });

      document.addEventListener('mousemove', (e) => {
        if (!this.isPointerLocked) return;
        // If holding right mouse button, rotate the object instead of turning camera
        if (e.buttons === 2) {
          this.rotateWheelDelta += e.movementX * 12;
          return;
        }
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      });

      this.canvas.addEventListener('click', (e) => {
        if (this.isPointerLocked) {
          this.pendingInteract = true;
          this.pendingPlace = true;
        } else {
          const now = performance.now();
          if (now - this.lastClickTime <= this.DOUBLE_CLICK_THRESHOLD) {
            this.tryRequestPointerLock();
          }
          this.lastClickTime = now;
        }
      });

      // Touch support for double-tap to lock
      this.canvas.addEventListener('touchend', (e) => {
        if (this.isPointerLocked) return;
        const now = performance.now();
        if (now - this.lastClickTime <= this.DOUBLE_CLICK_THRESHOLD) {
          this.tryRequestPointerLock();
        }
        this.lastClickTime = now;
      }, { passive: true });
    } else {
      // No Pointer Lock API: drag to look, click does not lock.
      this.canvas.addEventListener('click', () => {
        this.pendingInteract = true;
        this.pendingPlace = true;
      });

      document.addEventListener('mousedown', (e) => {
        this.dragActive = true;
        this.lastDrag = { x: e.clientX, y: e.clientY };
      });

      document.addEventListener('mousemove', (e) => {
        if (!this.dragActive) return;
        if (e.buttons === 2) {
          this.rotateWheelDelta += (e.clientX - this.lastDrag.x) * 12;
          this.lastDrag = { x: e.clientX, y: e.clientY };
          return;
        }
        this.lookX += e.clientX - this.lastDrag.x;
        this.lookY += e.clientY - this.lastDrag.y;
        this.lastDrag = { x: e.clientX, y: e.clientY };
      });

      document.addEventListener('mouseup', () => {
        this.dragActive = false;
      });
    }
  }

  private tryRequestPointerLock(): void {
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).catch(() => {
          this.isPointerLocked = false;
          this.onLockChange?.(false);
        });
      }
    } catch {
      this.isPointerLocked = false;
      this.onLockChange?.(false);
    }
  }

  public getInput(): ControlInput {
    let rotateInput = 0;
    if (this.keys.has('KeyQ')) rotateInput -= 1;
    if (this.keys.has('KeyE')) rotateInput += 1;

    const input: ControlInput = {
      moveForward: 0,
      moveRight: 0,
      lookX: this.lookX,
      lookY: this.lookY,
      interact: this.pendingInteract,
      rotateInput,
      rotateWheelDelta: this.rotateWheelDelta,
      rotateSnap: this.pendingRotateSnap,
      moveToggle: this.pendingMoveToggle,
      placeItem: this.pendingPlace,
      cancelMove: this.pendingCancel,
    };

    this.lookX = 0;
    this.lookY = 0;
    this.pendingInteract = false;
    this.pendingMoveToggle = false;
    this.pendingRotateSnap = false;
    this.pendingPlace = false;
    this.pendingCancel = false;
    this.rotateWheelDelta = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) input.moveForward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) input.moveForward -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) input.moveRight -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) input.moveRight += 1;

    return input;
  }

  public isLocked(): boolean {
    return this.isPointerLocked;
  }

  public dispose(): void {
    // Listeners are global and cleaned up with the page
  }
}