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
  private lookX: number = 0;
  private lookY: number = 0;

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

      if (e.code === 'KeyE' || e.code === 'Space') {
        this.pendingInteract = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  private setupMouse(): void {
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
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      });

      this.canvas.addEventListener('click', () => {
        if (this.isPointerLocked) {
          this.pendingInteract = true;
        } else {
          this.tryRequestPointerLock();
        }
      });
    } else {
      // No Pointer Lock API: drag to look, click does not lock.
      this.canvas.addEventListener('click', () => {
        this.pendingInteract = true;
      });

      document.addEventListener('mousedown', (e) => {
        this.dragActive = true;
        this.lastDrag = { x: e.clientX, y: e.clientY };
      });

      document.addEventListener('mousemove', (e) => {
        if (!this.dragActive) return;
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
    const input: ControlInput = {
      moveForward: 0,
      moveRight: 0,
      lookX: this.lookX,
      lookY: this.lookY,
      interact: this.pendingInteract,
    };

    this.lookX = 0;
    this.lookY = 0;
    this.pendingInteract = false;

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