import * as THREE from "three";
import type { ControlInput } from "./types";
import { PlayerController } from "./PlayerController";
import { InteractionSystem } from "./InteractionSystem";

interface VRController {
  inputSource: XRInputSource;
  grip: THREE.Group;
  handedness: XRHandedness;
}

export class VRSystem {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private player: PlayerController;
  private vrButton: HTMLElement;
  private interactionSystem: InteractionSystem;
  private xrSession: XRSession | null = null;
  private vrSupported: boolean = false;
  private referenceSpace: XRReferenceSpace | null = null;
  private controllers: VRController[] = [];
  private laserLine: THREE.Line;
  private laserDot: THREE.Mesh;
  private laserRaycaster: THREE.Raycaster;
  private readonly laserMaxDistance = 5;
  private readonly thumbstickDeadzone = 0.15;
  private lastHoveredObject: THREE.Object3D | null = null;
  private frame: XRFrame | null = null;
  private controllerLogDone = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    player: PlayerController,
    vrButton: HTMLElement,
    interactionSystem: InteractionSystem
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.vrButton = vrButton;
    this.interactionSystem = interactionSystem;

    this.laserRaycaster = new THREE.Raycaster();
    this.laserRaycaster.far = this.laserMaxDistance;

    const laserGeometry = new THREE.BufferGeometry();
    laserGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
    const laserMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 });
    this.laserLine = new THREE.Line(laserGeometry, laserMaterial);
    this.laserLine.name = "vr_laser_line";
    this.laserLine.visible = false;
    this.scene.add(this.laserLine);

    const dotGeometry = new THREE.SphereGeometry(0.02, 8, 8);
    const dotMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 });
    this.laserDot = new THREE.Mesh(dotGeometry, dotMaterial);
    this.laserDot.name = "vr_laser_dot";
    this.laserDot.visible = false;
    this.scene.add(this.laserDot);

    this.checkSupport();
  }

  private async checkSupport(): Promise<void> {
    try {
      if (typeof navigator !== "undefined" && navigator.xr) {
        const supported = await navigator.xr.isSessionSupported("immersive-vr");
        this.vrSupported = supported;
        if (supported) {
          this.vrButton.style.display = "block";
          this.setupButton();
        }
      }
    } catch {
      this.vrSupported = false;
    }
  }

  private setupButton(): void {
    this.vrButton.addEventListener("click", () => {
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
      const session = await navigator.xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor", "bounded-floor"],
      });

      this.xrSession = session;
      this.renderer.xr.enabled = true;
      await this.renderer.xr.setSession(session);

      this.player.vrMode = true;

      this.referenceSpace = await session.requestReferenceSpace("local-floor");

      session.addEventListener("inputsourceschange", (e) => this.onInputSourcesChange(e));
      this.onInputSourcesChange({ session } as XRInputSourcesChangeEvent);

      this.vrButton.textContent = "Keluar VR";

      session.addEventListener("end", () => this.onSessionEnd());
    } catch (err) {
      console.warn("Gagal masuk mode VR:", err);
    }
  }

  private onInputSourcesChange(event: XRInputSourcesChangeEvent): void {
    const session = event.session;
    const newSources = session.inputSources;

    for (const source of newSources) {
      if (source.handedness === "left" || source.handedness === "right") {
        const existing = this.controllers.find((c) => c.inputSource === source);
        if (!existing) {
          const grip = new THREE.Group();
          grip.name = `xr_controller_${source.handedness}`;
          grip.userData.inputSource = source;
          this.scene.add(grip);
          this.controllers.push({ inputSource: source, grip, handedness: source.handedness });

          if (!this.controllerLogDone) {
            console.log(`[VR] Controller detected: handedness=${source.handedness}, gamepad=${!!source.gamepad}`);
            if (source.gamepad) {
              console.log(`[VR] Gamepad: axes=${source.gamepad.axes.length}, buttons=${source.gamepad.buttons.length}`);
            }
          }
        }
      }
    }

    this.controllers = this.controllers.filter((c) => Array.from(newSources).includes(c.inputSource));

    this.controllerLogDone = true;
  }

  private onSessionEnd(): void {
    this.xrSession = null;
    this.referenceSpace = null;
    this.player.vrMode = false;
    this.controllers = [];
    this.laserLine.visible = false;
    this.laserDot.visible = false;
    this.clearHover();
    this.vrButton.textContent = "Masuk VR";
    this.controllerLogDone = false;
  }

  private exitVR(): void {
    if (this.xrSession) {
      this.xrSession.end();
    }
  }

  public setFrame(frame: XRFrame | null): void {
    this.frame = frame;
  }

  public updateControllers(): void {
    if (!this.xrSession || !this.referenceSpace || !this.frame) return;

    for (const controller of this.controllers) {
      const pose = this.frame.getPose(controller.inputSource.gripSpace!, this.referenceSpace);
      if (pose) {
        const transform = pose.transform;
        controller.grip.position.set(transform.position.x, transform.position.y, transform.position.z);
        controller.grip.quaternion.set(transform.orientation.x, transform.orientation.y, transform.orientation.z, transform.orientation.w);
        controller.grip.visible = true;
      } else {
        controller.grip.visible = false;
      }
    }

    this.updateLaser();
  }

  private updateLaser(): void {
    if (!this.xrSession || !this.referenceSpace || !this.frame) {
      this.laserLine.visible = false;
      this.laserDot.visible = false;
      this.clearHover();
      return;
    }

    const rightController = this.controllers.find((c) => c.handedness === "right");
    if (!rightController || !rightController.inputSource.targetRaySpace) {
      this.laserLine.visible = false;
      this.laserDot.visible = false;
      this.clearHover();
      return;
    }

    const pose = this.frame.getPose(rightController.inputSource.targetRaySpace, this.referenceSpace);
    if (!pose) {
      this.laserLine.visible = false;
      this.laserDot.visible = false;
      this.clearHover();
      return;
    }

    const transform = pose.transform;
    const origin = new THREE.Vector3(transform.position.x, transform.position.y, transform.position.z);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
      new THREE.Quaternion(transform.orientation.x, transform.orientation.y, transform.orientation.z, transform.orientation.w)
    );

    this.laserRaycaster.set(origin, direction);

    const hits = this.laserRaycaster.intersectObjects(this.interactionSystem.getRoots(), true);
    let hitPoint: THREE.Vector3 | null = null;
    let hitObject: THREE.Object3D | null = null;

    if (hits.length > 0) {
      const interactable = this.interactionSystem.findInteractable(hits[0].object);
      if (interactable) {
        hitPoint = hits[0].point.clone();
        hitObject = interactable;
      }
    }

    if (hitPoint) {
      const positions = this.laserLine.geometry.attributes.position.array as Float32Array;
      positions[0] = origin.x; positions[1] = origin.y; positions[2] = origin.z;
      positions[3] = hitPoint.x; positions[4] = hitPoint.y; positions[5] = hitPoint.z;
      this.laserLine.geometry.attributes.position.needsUpdate = true;
      this.laserLine.visible = true;

      this.laserDot.position.copy(hitPoint);
      this.laserDot.visible = true;

      if (hitObject !== this.lastHoveredObject) {
        this.clearHover();
        this.interactionSystem.setHovered(hitObject);
        this.lastHoveredObject = hitObject;
      }
    } else {
      const endPoint = origin.clone().add(direction.clone().multiplyScalar(this.laserMaxDistance));
      const positions = this.laserLine.geometry.attributes.position.array as Float32Array;
      positions[0] = origin.x; positions[1] = origin.y; positions[2] = origin.z;
      positions[3] = endPoint.x; positions[4] = endPoint.y; positions[5] = endPoint.z;
      this.laserLine.geometry.attributes.position.needsUpdate = true;
      this.laserLine.visible = true;
      this.laserDot.visible = false;
      this.clearHover();
    }
  }

  private clearHover(): void {
    if (this.lastHoveredObject) {
      this.interactionSystem.setHovered(null);
      this.lastHoveredObject = null;
    }
  }

  public getInput(): ControlInput {
    const input: ControlInput = {
      moveForward: 0,
      moveRight: 0,
      lookX: 0,
      lookY: 0,
      interact: false,
    };

    if (!this.xrSession) return input;

    const leftController = this.controllers.find((c) => c.handedness === "left");
    if (leftController && leftController.inputSource.gamepad) {
      const gp = leftController.inputSource.gamepad;
      const moveX = gp.axes.length > 0 ? gp.axes[0] : 0;
      const moveY = gp.axes.length > 1 ? gp.axes[1] : 0;

      if (Math.abs(moveX) > this.thumbstickDeadzone) {
        input.moveRight = moveX;
      }
      if (Math.abs(moveY) > this.thumbstickDeadzone) {
        input.moveForward = -moveY;
      }

      const len = Math.hypot(input.moveForward, input.moveRight);
      if (len > 1) {
        input.moveForward /= len;
        input.moveRight /= len;
      }
    }

    const rightController = this.controllers.find((c) => c.handedness === "right");
    if (rightController && rightController.inputSource.gamepad) {
      const gp = rightController.inputSource.gamepad;
      if (gp.buttons.length > 0 && gp.buttons[0].pressed) {
        input.interact = true;
      }
    }

    return input;
  }

  public getHoverTarget(): THREE.Object3D | null {
    return this.lastHoveredObject;
  }

  public getHoverType(): string {
    return this.lastHoveredObject?.userData?.interaction ?? "none";
  }

  public getHoverLabel(): string | null {
    if (!this.lastHoveredObject) return null;
    const type = this.lastHoveredObject.userData.interaction;
    if (type === "faucet") return "klik/f untuk menyalakan/mematikan kran";
    if (type === "window") return "klik/f untuk membuka/menutup jendela";
    if (type === "stove") return "klik/f untuk menyalakan/mematikan kompor";
    if (type === "fridge") return "klik/f untuk membuka/menutup kulkas";
    if (type === "serving_table") return "klik/f untuk menghidangkan makanan";
    return "klik/f untuk berinteraksi";
  }

  public tryInteract(): boolean {
    if (!this.lastHoveredObject) return false;
    return this.interactionSystem.tryInteract();
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
    this.scene.remove(this.laserLine);
    this.scene.remove(this.laserDot);
    for (const controller of this.controllers) {
      this.scene.remove(controller.grip);
    }
    this.controllers = [];
    this.laserLine.geometry.dispose();
    (this.laserLine.material as THREE.Material).dispose();
    this.laserDot.geometry.dispose();
    (this.laserDot.material as THREE.Material).dispose();
  }
}

