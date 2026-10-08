import type { ControlInput } from './types';

export class MobileControls {
  private dpadUp: HTMLButtonElement;
  private dpadDown: HTMLButtonElement;
  private dpadLeft: HTMLButtonElement;
  private dpadRight: HTMLButtonElement;
  private interactBtn: HTMLButtonElement;
  private moveBtn: HTMLButtonElement | null;
  private moveButtonsZone: HTMLElement | null;
  private canvas: HTMLCanvasElement;
  private portraitOverlay: HTMLElement;

  private dpadState = { up: false, down: false, left: false, right: false };

  private cameraTouchId: number | null = null;
  private lastCameraTouch = { x: 0, y: 0 };
  private rawLookDelta = { x: 0, y: 0 };
  private smoothedLookDelta = { x: 0, y: 0 };

  private pendingInteract = false;
  private pendingMoveToggle = false;
  private pendingPlace = false;
  private pendingCancel = false;
  private rotateInput = 0;

  private readonly MOBILE_CAMERA_SENSITIVITY = 0.0015;
  private readonly CAMERA_SMOOTH_FACTOR = 0.15;
  private readonly DPAD_ZONE_HEIGHT = 120;
  private readonly UI_ZONE_TOP = 80;

  private isPortraitPaused = false;
  private boundHandlers: { target: EventTarget; event: string; handler: EventListenerOrEventListenerObject; options?: AddEventListenerOptions }[] = [];

  constructor() {
    this.dpadUp = document.getElementById('btn-dpad-up') as HTMLButtonElement;
    this.dpadDown = document.getElementById('btn-dpad-down') as HTMLButtonElement;
    this.dpadLeft = document.getElementById('btn-dpad-left') as HTMLButtonElement;
    this.dpadRight = document.getElementById('btn-dpad-right') as HTMLButtonElement;
    this.interactBtn = document.getElementById('btn-mobile-interact') as HTMLButtonElement;
    this.moveBtn = document.getElementById('btn-mobile-move') as HTMLButtonElement | null;
    this.moveButtonsZone = document.getElementById('mobile-move-buttons');
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.portraitOverlay = document.getElementById('portrait-overlay')!;

    this.setupDpad();
    this.setupCameraSwipe();
    this.setupInteractButton();
    this.setupMoveButtons();
    this.setupOrientationLock();
  }

  private addListener(target: EventTarget, event: string, handler: (e: any) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(event, handler, options);
    this.boundHandlers.push({ target, event, handler, options });
  }

  private setupDpad(): void {
    const setDirection = (dir: keyof typeof this.dpadState, value: boolean) => {
      this.dpadState[dir] = value;
    };

    this.addListener(this.dpadUp, 'touchstart', (e) => { e.preventDefault(); setDirection('up', true); }, { passive: false });
    this.addListener(this.dpadUp, 'touchend', () => setDirection('up', false));
    this.addListener(this.dpadUp, 'touchcancel', () => setDirection('up', false));

    this.addListener(this.dpadDown, 'touchstart', (e) => { e.preventDefault(); setDirection('down', true); }, { passive: false });
    this.addListener(this.dpadDown, 'touchend', () => setDirection('down', false));
    this.addListener(this.dpadDown, 'touchcancel', () => setDirection('down', false));

    this.addListener(this.dpadLeft, 'touchstart', (e) => { e.preventDefault(); setDirection('left', true); }, { passive: false });
    this.addListener(this.dpadLeft, 'touchend', () => setDirection('left', false));
    this.addListener(this.dpadLeft, 'touchcancel', () => setDirection('left', false));

    this.addListener(this.dpadRight, 'touchstart', (e) => { e.preventDefault(); setDirection('right', true); }, { passive: false });
    this.addListener(this.dpadRight, 'touchend', () => setDirection('right', false));
    this.addListener(this.dpadRight, 'touchcancel', () => setDirection('right', false));
  }

  private setupCameraSwipe(): void {
    this.addListener(this.canvas, 'touchstart', (e: TouchEvent) => {
      if (this.isPortraitPaused) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (this.cameraTouchId !== null) continue;
        if (this.isTouchInDpadZone(touch)) continue;
        if (this.isTouchInUiZone(touch)) continue;

        this.cameraTouchId = touch.identifier;
        this.lastCameraTouch = { x: touch.clientX, y: touch.clientY };
        break;
      }
    }, { passive: true });

    const onMove = (e: TouchEvent) => {
      if (this.isPortraitPaused) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier !== this.cameraTouchId) continue;

        const dx = touch.clientX - this.lastCameraTouch.x;
        const dy = touch.clientY - this.lastCameraTouch.y;

        this.rawLookDelta.x += dx * this.MOBILE_CAMERA_SENSITIVITY;
        this.rawLookDelta.y += dy * this.MOBILE_CAMERA_SENSITIVITY;

        this.lastCameraTouch = { x: touch.clientX, y: touch.clientY };
        break;
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

    this.addListener(this.canvas, 'touchmove', onMove, { passive: true });
    this.addListener(this.canvas, 'touchend', onEnd);
    this.addListener(this.canvas, 'touchcancel', onEnd);
  }

  private isTouchInDpadZone(touch: Touch): boolean {
    const rect = this.canvas.getBoundingClientRect();
    return touch.clientY > rect.bottom - this.DPAD_ZONE_HEIGHT &&
           touch.clientX < rect.left + 160;
  }

  private isTouchInUiZone(touch: Touch): boolean {
    const rect = this.canvas.getBoundingClientRect();
    return touch.clientY < rect.top + this.UI_ZONE_TOP;
  }

  private setupInteractButton(): void {
    this.addListener(this.interactBtn, 'touchstart', (e) => {
      e.preventDefault();
      this.pendingInteract = true;
    }, { passive: false });

    if (this.moveBtn) {
      this.addListener(this.moveBtn, 'touchstart', (e) => {
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
      this.addListener(rotLeft, 'touchstart', (e) => { e.preventDefault(); this.rotateInput = -1; }, { passive: false });
      this.addListener(rotLeft, 'touchend', () => { this.rotateInput = 0; });
      this.addListener(rotLeft, 'touchcancel', () => { this.rotateInput = 0; });
    }
    if (rotRight) {
      this.addListener(rotRight, 'touchstart', (e) => { e.preventDefault(); this.rotateInput = 1; }, { passive: false });
      this.addListener(rotRight, 'touchend', () => { this.rotateInput = 0; });
      this.addListener(rotRight, 'touchcancel', () => { this.rotateInput = 0; });
    }
    if (placeBtn) {
      this.addListener(placeBtn, 'touchstart', (e) => { e.preventDefault(); this.pendingPlace = true; }, { passive: false });
    }
    if (cancelBtn) {
      this.addListener(cancelBtn, 'touchstart', (e) => { e.preventDefault(); this.pendingCancel = true; }, { passive: false });
    }
  }

  private setupOrientationLock(): void {
    const checkOrientation = () => {
      const isPortrait = window.matchMedia('(orientation: portrait)').matches;
      if (isPortrait) {
        this.pauseForPortrait();
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
          screen.orientation.lock('landscape').catch(() => {
            // Lock failed, overlay stays visible
          });
        }
      } else {
        this.resumeFromPortrait();
      }
    };

    this.addListener(window, 'orientationchange', checkOrientation);
    this.addListener(window, 'resize', checkOrientation);

    const dismissBtn = document.getElementById('btn-dismiss-portrait');
    if (dismissBtn) {
      this.addListener(dismissBtn, 'click', () => {
        this.portraitOverlay.style.display = 'none';
      });
    }

    checkOrientation();
  }

  private pauseForPortrait(): void {
    if (this.isPortraitPaused) return;
    this.isPortraitPaused = true;
    this.portraitOverlay.style.display = 'flex';
    this.resetAllInputs();
  }

  private resumeFromPortrait(): void {
    if (!this.isPortraitPaused) return;
    this.isPortraitPaused = false;
    this.portraitOverlay.style.display = 'none';
  }

  public isPortraitPausedState(): boolean {
    return this.isPortraitPaused;
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
    if (this.isPortraitPaused) {
      return this.getZeroInput();
    }

    let moveForward = 0;
    let moveRight = 0;

    if (this.dpadState.up) moveForward += 1;
    if (this.dpadState.down) moveForward -= 1;
    if (this.dpadState.right) moveRight += 1;
    if (this.dpadState.left) moveRight -= 1;

    if (moveForward !== 0 && moveRight !== 0) {
      const invSqrt2 = 0.7071067811865475;
      moveForward *= invSqrt2;
      moveRight *= invSqrt2;
    }

    this.smoothedLookDelta.x += (this.rawLookDelta.x - this.smoothedLookDelta.x) * this.CAMERA_SMOOTH_FACTOR;
    this.smoothedLookDelta.y += (this.rawLookDelta.y - this.smoothedLookDelta.y) * this.CAMERA_SMOOTH_FACTOR;

    const lookX = this.smoothedLookDelta.x;
    const lookY = this.smoothedLookDelta.y;

    this.rawLookDelta.x = 0;
    this.rawLookDelta.y = 0;

    const input: ControlInput = {
      moveForward,
      moveRight,
      lookX,
      lookY,
      interact: this.pendingInteract,
      rotateInput: this.rotateInput,
      moveToggle: this.pendingMoveToggle,
      placeItem: this.pendingPlace,
      cancelMove: this.pendingCancel,
      isMobile: true,
    };

    this.pendingInteract = false;
    this.pendingMoveToggle = false;
    this.pendingPlace = false;
    this.pendingCancel = false;

    return input;
  }

  private getZeroInput(): ControlInput {
    return {
      moveForward: 0,
      moveRight: 0,
      lookX: 0,
      lookY: 0,
      interact: false,
      rotateInput: 0,
      moveToggle: false,
      placeItem: false,
      cancelMove: false,
      isMobile: true,
    };
  }

  private resetAllInputs(): void {
    this.dpadState = { up: false, down: false, left: false, right: false };
    this.rawLookDelta = { x: 0, y: 0 };
    this.smoothedLookDelta = { x: 0, y: 0 };
    this.pendingInteract = false;
    this.pendingMoveToggle = false;
    this.pendingPlace = false;
    this.pendingCancel = false;
    this.rotateInput = 0;
    this.cameraTouchId = null;
  }

  public dispose(): void {
    for (const { target, event, handler, options } of this.boundHandlers) {
      target.removeEventListener(event, handler, options);
    }
    this.boundHandlers = [];
    this.resetAllInputs();
  }
}