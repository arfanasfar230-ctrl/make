import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GameMode, SceneContext, ControlInput, InteractiveObject } from './modules/types';
import { AssetLoader } from './modules/AssetLoader';
import { PlayerController } from './modules/PlayerController';
import { DesktopControls } from './modules/DesktopControls';
import { MobileControls } from './modules/MobileControls';
import { CollisionSystem } from './modules/CollisionSystem';
import { ErgonomicsSystem } from './modules/ErgonomicsSystem';
import { InteractionSystem, INTERACT_PROMPT } from './modules/InteractionSystem';
import { VRSystem } from './modules/VRSystem';
import { DebugSystem } from './modules/DebugSystem';
import { FridgeInteractionSystem, FridgeState } from './modules/FridgeInteractionSystem';

const GLB_BASE = (() => {
  try {
    return import.meta.env.BASE_URL ?? `${window.location.origin}/`;
  } catch {
    return `${window.location.origin}/`;
  }
})();

class KitchenErgonomicsApp {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock!: THREE.Clock;

  private ctx!: SceneContext;
  private assetLoader!: AssetLoader;
  private player!: PlayerController;
  private desktopControls: DesktopControls | null = null;
  private mobileControls: MobileControls | null = null;
  private collision!: CollisionSystem;
  private ergonomics!: ErgonomicsSystem;
  private interaction!: InteractionSystem;
  private fridgeInteraction!: FridgeInteractionSystem;
  private vrSystem: VRSystem | null = null;
  private debugSystem!: DebugSystem;

  private currentMode: GameMode = 'desktop';
  private isRunning = false;
  private highlightedObject: InteractiveObject | null = null;
  private originalMaterials: Map<THREE.Object3D, THREE.Material | THREE.Material[]> = new Map();

  private loadingScreen: HTMLElement;
  private loadingBar: HTMLElement;
  private loadingText: HTMLElement;
  private modeSelection: HTMLElement;
  private hud: HTMLElement;
  private ergoPanel: HTMLElement;
  private ergoTitle: HTMLElement;
  private ergoScoreRing: SVGCircleElement;
  private ergoScoreValue: HTMLElement;
  private ergoStatus: HTMLElement;
  private ergoDetails: HTMLElement;
  private ergoRecommendations: HTMLElement;
  private interactionPrompt: HTMLElement;
  private promptText: HTMLElement;
  private interactionPanel: HTMLElement;
  private interactionPanelOptions: HTMLElement;
  private playerPosEl: HTMLElement;
  private mobileControlsEl: HTMLElement;
  private portraitOverlay: HTMLElement;
  private debugBtn: HTMLElement;
  private pointerLockHint!: HTMLElement;
  private sensitivityWrap!: HTMLElement;
  private sensitivitySlider!: HTMLInputElement;
  private sensitivityValue!: HTMLElement;
  private reachGroup: THREE.Group | null = null;
  private showReachIndicator = true;
  private colliderHelper: THREE.Mesh | null = null;

  constructor() {
    this.clock = new THREE.Clock();

    this.loadingScreen = document.getElementById('loading-screen')!;
    this.loadingBar = document.getElementById('loading-bar')!;
    this.loadingText = document.getElementById('loading-text')!;
    this.modeSelection = document.getElementById('mode-selection')!;
    this.hud = document.getElementById('hud')!;
    this.ergoPanel = document.getElementById('ergonomics-panel')!;
    this.ergoTitle = document.getElementById('ergo-title')!;
    this.ergoScoreRing = document.getElementById('ergo-score-ring') as unknown as SVGCircleElement;
    this.ergoScoreValue = document.getElementById('ergo-score-value')!;
    this.ergoStatus = document.getElementById('ergo-status')!;
    this.ergoDetails = document.getElementById('ergo-details')!;
    this.ergoRecommendations = document.getElementById('ergo-recommendations')!;
    this.interactionPrompt = document.getElementById('interaction-prompt')!;
    this.promptText = document.getElementById('prompt-text')!;
    this.interactionPanel = document.getElementById('interaction-panel')!;
    this.interactionPanelOptions = document.getElementById('interaction-panel-options')!;
    this.playerPosEl = document.getElementById('player-pos')!;
    this.mobileControlsEl = document.getElementById('mobile-controls')!;
    this.portraitOverlay = document.getElementById('portrait-overlay')!;
    this.debugBtn = document.getElementById('btn-toggle-debug')!;
    this.pointerLockHint = document.getElementById('pointer-lock-hint')!;
    this.sensitivityWrap = document.getElementById('sensitivity-wrap')!;
    this.sensitivitySlider = document.getElementById('sensitivity-slider') as HTMLInputElement;
    this.sensitivityValue = document.getElementById('sensitivity-value')!;

    this.setupRenderer();
    this.setupModeSelection();
    this.setupPortraitDetection();
    this.setupDebugButton();
    this.setupSensitivity();
    this.renderer.setAnimationLoop(this.animate);
  }

  private setupRenderer(): void {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
    this.scene.add(this.camera);

    window.addEventListener('resize', () => this.onResize());

    this.ctx = {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      clock: this.clock,
kitchenModel: null,
      sceneBoundingBox: new THREE.Box3(),
      floorBounds: new THREE.Box3(),
      floorY: 0,
      sceneScale: 1,
      walkableArea: [],
      interactiveObjects: [],
    };

    this.assetLoader = new AssetLoader((progress) => {
      const pct = Math.round(progress * 100);
      this.loadingBar.style.width = `${pct}%`;
      this.loadingText.textContent = `${pct}%`;
    });
  }

  private setupModeSelection(): void {
    const btnDesktop = document.getElementById('btn-desktop')!;
    const btnMobile = document.getElementById('btn-mobile')!;
    const btnVR = document.getElementById('btn-vr')!;

    btnDesktop.addEventListener('click', () => this.startGame('desktop'));
    btnMobile.addEventListener('click', () => this.startGame('mobile'));
    btnVR.addEventListener('click', () => this.startGame('vr'));

    this.checkVRSupport(btnVR);
  }

  private async checkVRSupport(btnVR: HTMLElement): Promise<void> {
    try {
      if (navigator.xr) {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        if (supported) {
          btnVR.style.display = 'flex';
        }
      }
    } catch {
      // VR not supported
    }
  }

  private setupPortraitDetection(): void {
    const overlay = this.portraitOverlay;
    const dismissBtn = document.getElementById('btn-dismiss-portrait')!;

    const checkOrientation = () => {
      if (window.matchMedia('(orientation: portrait)').matches && this.currentMode === 'mobile') {
        overlay.style.display = 'flex';

        if (screen.orientation && typeof screen.orientation.lock === 'function') {
          screen.orientation.lock('landscape').catch(() => {
            // Orientation lock not supported or failed
          });
        }
      } else {
        overlay.style.display = 'none';
      }
    };

    dismissBtn.addEventListener('click', () => {
      overlay.style.display = 'none';
    });

    window.addEventListener('orientationchange', checkOrientation);
    window.addEventListener('resize', checkOrientation);
  }

  private setupDebugButton(): void {
    this.debugBtn.addEventListener('click', () => {
      if (this.debugSystem) {
        this.debugSystem.toggle();
        this.player?.setDebugVisibility(this.debugSystem.isEnabled());
      }
    });
  }

  private setupSensitivity(): void {
    let value = 1;
    try {
      const stored = Number(localStorage.getItem('dapur-look-sensitivity'));
      if (Number.isFinite(stored) && stored > 0) value = stored;
    } catch {
      value = 1;
    }

    this.sensitivitySlider.value = String(value);
    this.sensitivityValue.textContent = `${value.toFixed(1)}x`;

    this.sensitivitySlider.addEventListener('input', () => {
      const v = Number(this.sensitivitySlider.value);
      this.sensitivityValue.textContent = `${v.toFixed(1)}x`;
      if (this.player) this.player.setLookSensitivity(v);
      try {
        localStorage.setItem('dapur-look-sensitivity', String(v));
      } catch {
        // Storage unavailable (private mode) - sensitivity still applies.
      }
    });
  }

  private updatePointerLockHint(locked: boolean): void {
    const show = this.currentMode === 'desktop' && !locked;
    this.pointerLockHint.style.display = show ? 'block' : 'none';
  }

  private async startGame(mode: GameMode): Promise<void> {
    if (this.isRunning) return;
    this.currentMode = mode;
    this.modeSelection.style.display = 'none';
    this.loadingScreen.style.display = 'flex';

    try {
      const glbUrl = `${GLB_BASE}simple_linear_kitchen.glb`;
      const model = await this.withTimeout(
        this.assetLoader.loadKitchen(glbUrl, this.ctx),
        45000,
        'Waktu memuat model habis'
      );
      this.ctx.kitchenModel = model;

      this.loadingBar.style.width = '100%';
      this.loadingText.textContent = '100%';

      await new Promise(resolve => setTimeout(resolve, 500));

      this.collision = new CollisionSystem(this.ctx);
      this.ergonomics = new ErgonomicsSystem(this.ctx);
      this.interaction = new InteractionSystem(this.ctx);

      await this.loadFridge();

      this.player = new PlayerController(this.ctx);
      this.debugSystem = new DebugSystem(this.ctx);

      // Verify spawn is valid (not inside furniture, not outside room)
      const safeSpawn = this.collision.resolvePosition(
        this.player.getPosition(),
        this.player.state.radius,
        this.player.getHeight()
      );
      safeSpawn.y = this.ctx.floorY;
      this.player.spawn(safeSpawn);

      this.debugSystem.setCollisionBoxes(this.collision.getCollisionBoxes());
      this.debugSystem.setSpawnPoint(safeSpawn.clone());

      this.setupReachIndicator();

      if (mode === 'desktop') {
        this.desktopControls = new DesktopControls(
          this.ctx.renderer.domElement as HTMLCanvasElement,
          (locked) => this.updatePointerLockHint(locked)
        );
        this.player.setLookSensitivity(Number(this.sensitivitySlider.value));
        this.sensitivityWrap.style.display = 'flex';
        this.updatePointerLockHint(false);
      } else if (mode === 'mobile') {
        this.mobileControls = new MobileControls();
        this.mobileControlsEl.style.display = 'block';
        this.pointerLockHint.style.display = 'none';
        this.sensitivityWrap.style.display = 'none';
      } else if (mode === 'vr') {
        const vrBtn = document.getElementById('btn-vr-enter')!;
        try {
          this.vrSystem = new VRSystem(
            this.renderer,
            this.scene,
            this.camera,
            this.player,
            vrBtn
          );
        } catch (err) {
          console.warn('VR tidak tersedia:', err);
        }
      }

      this.hud.style.display = 'block';
      this.debugBtn.style.display = 'block';

      if (mode === 'mobile') {
        document.getElementById('controls-hint')!.style.display = 'none';
      }

      this.setupInteractionListener();

      this.loadingScreen.style.display = 'none';
      this.isRunning = true;
      this.clock.start();

    } catch (error) {
      console.error('Gagal memuat proyek:', error);
      this.loadingText.textContent = 'Gagal memuat model. Periksa koneksi lalu coba lagi.';
      this.loadingBar.style.width = '0%';
      this.loadingScreen.style.display = 'none';
      this.modeSelection.style.display = 'flex';
      this.currentMode = 'desktop';
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  }

  private async loadFridge(): Promise<void> {
    const fridgeUrl = `${GLB_BASE}kulkas.glb`;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(fridgeUrl);
    const fridgeModel = gltf.scene;

    fridgeModel.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    fridgeModel.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(fridgeModel);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const targetHeight = 1.8;
    const currentHeightM = size.y / this.ctx.sceneScale;
    const scale = targetHeight / currentHeightM;
    fridgeModel.scale.setScalar(scale);

    fridgeModel.updateMatrixWorld(true);
    const scaledBBox = new THREE.Box3().setFromObject(fridgeModel);

    const targetX = 24.29;
    const targetZ = 31.89;
    const targetY = this.ctx.floorY - scaledBBox.min.y;

    fridgeModel.position.set(targetX, targetY, targetZ);
    fridgeModel.name = 'kulkas';
    fridgeModel.userData.isFridge = true;

    this.ctx.scene.add(fridgeModel);
    this.ctx.kitchenModel?.add(fridgeModel);

    this.fridgeInteraction = new FridgeInteractionSystem(this.ctx, this.collision);
    await this.fridgeInteraction.initialize(fridgeModel, gltf.animations);
  }

  private setupReachIndicator(): void {
    if (!this.player) return;

    const scale = this.ctx.sceneScale;
    const armReach = 0.7 * scale;

    const geoRing = new THREE.RingGeometry(armReach * 0.85, armReach, 48);
    const matRing = new THREE.MeshBasicMaterial({
      color: 0x44ff88,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(geoRing, matRing);
    ring.rotation.x = -Math.PI / 2;

    const geoCircle = new THREE.RingGeometry(0, armReach * 0.25, 48);
    const matCircle = new THREE.MeshBasicMaterial({
      color: 0x44ff88,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const circle = new THREE.Mesh(geoCircle, matCircle);
    circle.rotation.x = -Math.PI / 2;

    this.reachGroup = new THREE.Group();
    this.reachGroup.add(ring);
    this.reachGroup.add(circle);
    this.ctx.scene.add(this.reachGroup);
  }

  private updateReachIndicator(): void {
    if (!this.reachGroup) return;
    this.reachGroup.position.set(
      this.player.state.position.x,
      this.ctx.floorY + 0.02,
      this.player.state.position.z
    );
  }

  private setupInteractionListener(): void {
    const canvas = this.ctx.renderer.domElement as HTMLCanvasElement;

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;

      if (this.currentMode === 'desktop' && this.desktopControls && !this.desktopControls.isLocked()) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (this.fridgeInteraction) {
        this.fridgeInteraction.setMouse(mouseX, mouseY);
        if (this.fridgeInteraction.onMouseDown(e)) {
          e.stopPropagation();
          return;
        }
      }

      if (this.currentMode !== 'desktop' && this.interaction?.getHover()) {
        this.showInteractionPanel();
      }
      if (this.highlightedObject) {
        this.showErgonomics(this.highlightedObject);
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (this.fridgeInteraction) {
        this.fridgeInteraction.onMouseUp();
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (this.fridgeInteraction) {
        this.fridgeInteraction.setMouse(mouseX, mouseY);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        this.hideErgonomics();
        this.hideInteractionPanel();
        if (this.fridgeInteraction) {
          this.fridgeInteraction.hideInteractionMenu();
        }
      }

      if (this.fridgeInteraction && this.fridgeInteraction.getState() !== FridgeState.IDLE) {
        if (this.fridgeInteraction.onKeyDown(e.code)) {
          return;
        }
      }

      if (e.code === 'KeyF') {
        if (this.fridgeInteraction && this.fridgeInteraction.isFridgeHovered()) {
          this.fridgeInteraction.showInteractionMenu();
        } else if (this.interaction?.getHover()) {
          this.showInteractionPanel();
        }
      }
    });

    const ergoClose = document.getElementById('ergo-close')!;
    ergoClose.addEventListener('click', () => this.hideErgonomics());
  }

  private showInteractionPanel(): void {
    const hover = this.interaction?.getHover();
    const hoverType = this.interaction?.getHoverType?.();
    if (!hover || !hoverType || hoverType === 'none') return;

    this.interactionPanelOptions.innerHTML = '';

    const title = this.interactionPanel.querySelector('h4')!;
    const label = hover.userData.windowLabel || hover.userData.displayName || 'Objek';

    if (hoverType === 'faucet') {
      title.textContent = 'Kran Wastafel';
      const isOpen = this.interaction.isFaucetOpen();

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'interaction-option-btn';
      toggleBtn.textContent = isOpen ? 'Matikan Kran' : 'Nyalakan Kran';
      toggleBtn.addEventListener('click', () => {
        this.interaction.tryInteract();
        this.hideInteractionPanel();
      });
      this.interactionPanelOptions.appendChild(toggleBtn);
    } else if (hoverType === 'window') {
      title.textContent = label;
      const windowName = hover.userData.windowName;
      const isOpen = this.interaction.getWindowSystem().isWindowOpen(windowName);

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'interaction-option-btn';
      toggleBtn.textContent = isOpen ? 'Tutup Jendela' : 'Buka Jendela';
      toggleBtn.addEventListener('click', () => {
        this.interaction.tryInteract();
        this.hideInteractionPanel();
      });
      this.interactionPanelOptions.appendChild(toggleBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'interaction-option-btn cancel';
    cancelBtn.textContent = 'Batal';
    cancelBtn.addEventListener('click', () => this.hideInteractionPanel());
    this.interactionPanelOptions.appendChild(cancelBtn);

    this.interactionPanel.style.display = 'block';
  }

  private hideInteractionPanel(): void {
    this.interactionPanel.style.display = 'none';
    this.interactionPanelOptions.innerHTML = '';
  }

  private showErgonomics(obj: InteractiveObject): void {
    const result = this.ergonomics.analyze(this.player.state, obj);

    this.ergoPanel.style.display = 'block';
    this.ergoTitle.textContent = obj.displayName;

    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (result.score / 100) * circumference;
    this.ergoScoreRing.style.strokeDashoffset = `${offset}`;

    if (result.score >= 70) {
      this.ergoScoreRing.style.stroke = '#4caf50';
    } else if (result.score >= 40) {
      this.ergoScoreRing.style.stroke = '#ff9800';
    } else {
      this.ergoScoreRing.style.stroke = '#f44336';
    }

    this.ergoScoreValue.textContent = `${result.score}`;
    this.ergoStatus.textContent = result.status;
    this.ergoStatus.className = result.statusClass;

    this.ergoDetails.innerHTML = '';
    for (const param of result.parameters) {
      const pct = Math.round((param.value / param.maxValue) * 100);
      let color = '#4caf50';
      if (pct < 50) color = '#f44336';
      else if (pct < 70) color = '#ff9800';

      this.ergoDetails.innerHTML += `
        <div class="ergo-detail-row">
          <span class="ergo-detail-label">${param.name}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.75rem;opacity:0.6;">${param.description}</span>
            <div class="ergo-detail-bar">
              <div class="ergo-detail-fill" style="width:${pct}%;background:${color};"></div>
            </div>
          </div>
        </div>
      `;
    }

    this.ergoRecommendations.innerHTML = `
      <div class="rec-title">Rekomendasi:</div>
      <ul>
        ${result.recommendations.map(r => `<li>${r}</li>`).join('')}
      </ul>
    `;

    this.highlightObject(obj);
  }

  private hideErgonomics(): void {
    this.ergoPanel.style.display = 'none';
    this.unhighlightAll();
  }

  private highlightObject(obj: InteractiveObject): void {
    this.unhighlightAll();
    this.highlightedObject = obj;

    obj.object3D.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        this.originalMaterials.set(child, child.material);
        child.material = new THREE.MeshBasicMaterial({
          color: 0xe94560,
          transparent: true,
          opacity: 0.3,
          wireframe: false,
          depthWrite: false,
        });
      }
    });
  }

  private unhighlightAll(): void {
    if (this.highlightedObject) {
      this.highlightedObject.object3D.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const orig = this.originalMaterials.get(child);
          if (orig) {
            child.material = orig;
            this.originalMaterials.delete(child);
          }
        }
      });
      this.highlightedObject = null;
    }
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    if (!this.isRunning) return;

    const delta = Math.min(this.clock.getDelta(), 0.05);

    let input: ControlInput;

    if (this.currentMode === 'desktop' && this.desktopControls) {
      input = this.desktopControls.getInput();
    } else if (this.currentMode === 'mobile' && this.mobileControls) {
      input = this.mobileControls.getInput();
    } else if (this.currentMode === 'vr' && this.vrSystem) {
      if (this.vrSystem.isInVR()) {
        input = this.vrSystem.getInput();
      } else {
        input = { moveForward: 0, moveRight: 0, lookX: 0, lookY: 0, interact: false };
      }
    } else {
      input = { moveForward: 0, moveRight: 0, lookX: 0, lookY: 0, interact: false };
    }

    this.player.update(input, delta, (pos, radius) => {
      return this.collision.resolvePosition(pos, radius, this.player.getHeight());
    });

    if (this.fridgeInteraction) {
      this.fridgeInteraction.update(delta);
    }

    if (this.showReachIndicator) {
      this.updateReachIndicator();
    }

    const fridgeHovered = this.fridgeInteraction?.isFridgeHovered() ?? false;
    const fridgeState = this.fridgeInteraction?.getState() ?? FridgeState.IDLE;

    if (!fridgeHovered && fridgeState === FridgeState.IDLE) {
      const nearest = this.ergonomics.findNearestObject(this.player.getPosition(), ['fridge']);
      if (nearest) {
        this.promptText.textContent = `${nearest.displayName} - Tekan [E] atau klik untuk menganalisis`;
        this.interactionPrompt.style.display = 'block';

        if (input.interact) {
          this.showErgonomics(nearest);
        }
      } else {
        this.interactionPrompt.style.display = 'none';
      }

      // Crosshair-driven interaction wins over the proximity prompt.
      const hover = this.interaction.update(delta);
      if (hover) {
        const label = this.interaction.getHoverLabel?.() ?? INTERACT_PROMPT;
        this.promptText.textContent = label;
        this.interactionPrompt.style.display = 'block';

        if (input.interact) {
          this.showInteractionPanel();
        }
      }
    } else {
      this.interaction.update(delta);
    }

    this.playerPosEl.textContent = `Pos: ${this.player.state.position.x.toFixed(2)}, ${this.player.state.position.y.toFixed(2)}, ${this.player.state.position.z.toFixed(2)}`;

    this.renderer.render(this.scene, this.camera);
  };
}

window.addEventListener('DOMContentLoaded', () => {
  new KitchenErgonomicsApp();
});
