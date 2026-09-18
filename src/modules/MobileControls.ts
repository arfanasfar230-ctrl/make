import type { ControlInput } from './types';

export class MobileControls {
  private joystickBase: HTMLElement;
  private joystickStick: HTMLElement;
  private interactBtn: HTMLElement;
  private moveBtn: HTMLElement | null;
  private touchZone: HTMLElement;
  private moveButtonsZone: HTMLElement | null;

  private stickPos = { x: 0, y: 0 };
  private stickTouchId: number | null = null;
  private cameraTouchId: number | null = null;
  private lastCameraTouch = { x: 0, y: 0 };
  private lookDelta = { x: 0, y: 0 };
  private pendingInteract: boolean = false;
  private pendingMoveToggle: boolean = false;
  private pendingPlace: boolean = false;
  private pendingCancel: boolean = false;
  private rotateInput: number = 0;

  private readonly STICK_RADIUS = 40;
  private readonly DEAD_ZONE = 0.15;

  constructor() {
    this.joystickBase = document.getElementById('joystick-base')!;
    this.joystickStick = document.getElementById('joystick-stick')!;
    this.interactBtn = document.getElementById('btn-mobile-interact')!;
    this.moveBtn = document.getElementById('btn-mobile-move');
    this.touchZone = document.getElementById('mobile-controls')!;
    this.moveButtonsZone = document.getElementById('mobile-move-buttons');

    this.setupJoystick();
    this.setupCamera();
    this.setupInteractButton();
    this.setupMoveButtons();
  }

  private setupJoystick(): void {
    const base = this.joystickBase;

    base.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.stickTouchId !== null) return;
      const touch = e.changedTouches[0];
      this.stickTouchId = touch.identifier;
      this.updateStickPosition(touch);
    }, { passive: false });

    const onMove = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.stickTouchId) {
          e.preventDefault();
          this.updateStickPosition(touch);
          break;
        }
      }
    };

    const onEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.stickTouchId) {
          this.stickTouchId = null;
          this.stickPos = { x: 0, y: 0 };
          this.joystickStick.style.transform = 'translate(0px, 0px)';
          break;
        }
      }
    };

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  private updateStickPosition(touch: Touch): void {
    const rect = this.joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this.STICK_RADIUS) {
      dx = (dx / dist) * this.STICK_RADIUS;
      dy = (dy / dist) * this.STICK_RADIUS;
    }

    this.joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;

    this.stickPos.x = dx / this.STICK_RADIUS;
    this.stickPos.y = -dy / this.STICK_RADIUS;
  }

  private setupCamera(): void {
    this.touchZone.addEventListener('touchstart', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.stickTouchId) continue;
        if (this.cameraTouchId !== null) continue;

        const rect = this.touchZone.getBoundingClientRect();
        if (touch.clientX > rect.width * 0.4) {
          this.cameraTouchId = touch.identifier;
          this.lastCameraTouch = { x: touch.clientX, y: touch.clientY };
          break;
        }
      }
    }, { passive: true });

    const onMove = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.cameraTouchId) {
          const dx = touch.clientX - this.lastCameraTouch.x;
          const dy = touch.clientY - this.lastCameraTouch.y;
          this.lookDelta.x += dx * 0.3;
          this.lookDelta.y += dy * 0.3;
          this.lastCameraTouch = { x: touch.clientX, y: touch.clientY };
          break;
        }
      }
    };

    const onEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.cameraTouchId) {
          this.cameraTouchId = null;
          break;
        }
      }
    };

    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  private setupInteractButton(): void {
    this.interactBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.pendingInteract = true;
    }, { passive: false });

    if (this.moveBtn) {
      this.moveBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.pendingMoveToggle = true;
      }, { passive: false });
    }
  }

  private setupMoveButtons(): void {
    const rotLeft = document.getElementById('btn-mobile-rot-left');
    const rotRight = document.getElementById('btn-mobile-rot-right');
    const placeBtn = document.getElementById('btn-mobile-place');
    const cancelBtn = document.getElementById('btn-mobile-cancel');

    if (rotLeft) {
      rotLeft.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.rotateInput = -1;
      }, { passive: false });
      rotLeft.addEventListener('touchend', () => {
        this.rotateInput = 0;
      });
    }

    if (rotRight) {
      rotRight.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.rotateInput = 1;
      }, { passive: false });
      rotRight.addEventListener('touchend', () => {
        this.rotateInput = 0;
      });
    }

    if (placeBtn) {
      placeBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.pendingPlace = true;
      }, { passive: false });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.pendingCancel = true;
      }, { passive: false });
    }
  }

  public setMoveMode(active: boolean): void {
    if (this.moveButtonsZone) {
      this.moveButtonsZone.style.display = active ? 'flex' : 'none';
    }
    if (this.interactBtn) {
      this.interactBtn.style.display = active ? 'none' : 'block';
    }
    if (this.moveBtn) {
      this.moveBtn.style.display = active ? 'none' : 'block';
    }
  }

  public showMoveButton(visible: boolean): void {
    if (this.moveBtn && !this.moveButtonsZone?.style.display.includes('flex')) {
      this.moveBtn.style.display = visible ? 'block' : 'none';
    }
  }

  public getInput(): ControlInput {
    const input: ControlInput = {
      moveForward: Math.abs(this.stickPos.y) > this.DEAD_ZONE ? this.stickPos.y : 0,
      moveRight: Math.abs(this.stickPos.x) > this.DEAD_ZONE ? this.stickPos.x : 0,
      lookX: this.lookDelta.x,
      lookY: this.lookDelta.y,
      interact: this.pendingInteract,
      rotateInput: this.rotateInput,
      moveToggle: this.pendingMoveToggle,
      placeItem: this.pendingPlace,
      cancelMove: this.pendingCancel,
    };

    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    this.pendingInteract = false;
    this.pendingMoveToggle = false;
    this.pendingPlace = false;
    this.pendingCancel = false;

    return input;
  }

  public dispose(): void {
    // Cleanup listeners handled by DOM element removal
  }
}
