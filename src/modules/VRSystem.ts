import * as THREE from 'three';
import type { ControlInput } from './types';
import { PlayerController } from './PlayerController';

export class VRSystem {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private player: PlayerController;
  private vrButton: HTMLElement;
  private xrSession: XRSession | null = null;
  private vrSupported: boolean = false;
  private controllerGroup: THREE.Group;
  private inputSources: XRInputSourceArray | XRInputSource[] = [];

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    player: PlayerController,
    vrButton: HTMLElement
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.vrButton = vrButton;

    // Invisible controller rig managed by WebXR
    this.controllerGroup = new THREE.Group();
    this.controllerGroup.name = 'xr_controller_rig';
    this.scene.add(this.controllerGroup);

    this.checkSupport();
  }

  private async checkSupport(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.xr) {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        this.vrSupported = supported;
        if (supported) {
          this.vrButton.style.display = 'block';
          this.setupButton();
        }
      }
    } catch {
      this.vrSupported = false;
    }
  }

  private setupButton(): void {
    this.vrButton.addEventListener('click', () => {
      if (this.xrSession) {
        this.exitVR();
      } else {
        this.enterVR();
      }
    });
  }

  private async enterVR(): Promise<void> {
    try {
      if (!navigator.xr) return;
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });

      this.xrSession = session;
      this.renderer.xr.enabled = true;
      await this.renderer.xr.setSession(session);

      this.player.vrMode = true;

      this.inputSources = session.inputSources;
      session.addEventListener('inputsourceschange', (e) => {
        this.inputSources = (e as XRInputSourcesChangeEvent).session.inputSources;
      });

      this.vrButton.textContent = 'Keluar VR';

      session.addEventListener('end', () => {
        this.xrSession = null;
        this.player.vrMode = false;
        this.inputSources = [];
        this.vrButton.textContent = 'Masuk VR';
      });
    } catch (err) {
      console.warn('Gagal masuk mode VR:', err);
    }
  }

  private exitVR(): void {
    if (this.xrSession) {
      this.xrSession.end();
    }
  }

  /**
   * Reads controller/head input from the WebXR session.
   * Movement follows the head-facing direction but ignores vertical lean.
   */
  public getInput(): ControlInput {
    const input: ControlInput = {
      moveForward: 0,
      moveRight: 0,
      lookX: 0,
      lookY: 0,
      interact: false,
    };

    if (!this.xrSession) return input;

    let source: XRInputSource | undefined;
    for (const s of this.inputSources) {
      if (s.gamepad) {
        source = s;
        break;
      }
    }

    if (source && source.gamepad) {
      const gp = source.gamepad;
      const moveX = gp.axes.length > 0 ? gp.axes[0] : 0;
      const moveY = gp.axes.length > 1 ? gp.axes[1] : 0;

      input.moveForward = -moveY;
      input.moveRight = moveX;

      if (gp.buttons.length > 0 && gp.buttons[0].pressed) {
        input.interact = true;
      }
    }

    const headPos = this.renderer.xr.getCamera().position;
    if (headPos) {
      if (Math.abs(headPos.x) > 0.05 || Math.abs(headPos.z) > 0.05) {
        input.moveForward += -headPos.z * 5;
        input.moveRight += headPos.x * 5;
      }
    }

    return input;
  }

  public isVRSupported(): boolean {
    return this.vrSupported;
  }

  public isInVR(): boolean {
    return this.xrSession !== null;
  }

  public dispose(): void {
    if (this.xrSession) {
      this.xrSession.end().catch(() => {});
    }
    this.scene.remove(this.controllerGroup);
  }
}