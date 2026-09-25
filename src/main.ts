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
import { FurnitureMoveSystem } from './modules/FurnitureMoveSystem';
import { DoorTeleportSystem } from './modules/DoorTeleportSystem';
import { ProximityTeleportSystem } from './modules/ProximityTeleportSystem';
import { CarrotCleaner } from './modules/CarrotCleaner';

const GLB_BASE = (() => {
  try {
    return import.meta.env.BASE_URL ?? `${window.location.origin}/`;
  } catch {
    return `${window.location.origin}/`;
  }
})();

// Jeda setelah kran dinyalakan sebelum popup membersihkan wortel muncul.
const CARROT_CLEAN_DELAY_MS = 4300;

// Panci dekoratif di atas Meja Kerja Dapur 3 (G_8). X/Z adalah posisi world
// target; Y ditentukan lewat raycast ke bawah agar dasar panci tepat di
// permukaan meja (G_8), bukan di backsplash. Versi baru lebih kecil (0.19 m).
const PAN_GLB = `${GLB_BASE}panci.glb`;
const PAN_TARGET_X = 19.1;
const PAN_TARGET_Z = 4.4;
const PAN_TARGET_HEIGHT_M = 0.19;

// Set penyajian dekoratif (public/low_poly_tableware.glb) di atas worktop
// G_121, di area bekas klaster bumbu (_ra2/Mesh10 yang sudah dihapus). X/Z
// adalah posisi world; Y ditentukan lewat raycast ke bawah (findTableSurfaceY)
// agar dasar placemat menempel persis di permukaan slab (Mesh11, y≈8.8).
// Skala dinormalisasi ke diameter piring (anchor Dish) 0.20 m; jika mesh
// piring tidak ditemukan, fallback ke lebar placemat (0.334 m).
const SAJI_GLB = `${GLB_BASE}low_poly_tableware.glb`;
const SAJI_TARGET_X = 12.59;
const SAJI_TARGET_Z = 3.45;
const SAJI_TARGET_WIDTH_M = 0.2; // diameter piring target (anchor Dish)
const SAJI_FALLBACK_WIDTH_M = 0.334; // lebar placemat target bila Dish tak ada

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
  private furnitureMove!: FurnitureMoveSystem;
  private doorTeleport!: DoorTeleportSystem;
  private proximityTeleport!: ProximityTeleportSystem;
  private carrotCleaner!: CarrotCleaner;
  private carrotCleanSucceeded = false;
  private faucetCarrotTimer: ReturnType<typeof setTimeout> | null = null;

  private currentMode: GameMode = 'desktop';
  private isRunning = false;
  private highlightedObject: InteractiveObject | null = null;
  // Ergonomics highlight: yellow outline Box3Helper (replaces pink material-swap)
  private ergoHighlightHelper: THREE.Box3Helper | null = null;

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
  private moveModeHud!: HTMLElement;
  private moveModeObjTitle!: HTMLElement;
  private moveToast!: HTMLElement;
  private moveToastTimer: ReturnType<typeof setTimeout> | null = null;

  // Faint blue hitbox highlight
  private hitboxHelper: THREE.Box3Helper | null = null;
  private hitboxTargetObj: InteractiveObject | null = null;
  private hitboxRaycaster: THREE.Raycaster = new THREE.Raycaster();
  private hitboxScreenCenter: THREE.Vector2 = new THREE.Vector2(0, 0);

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
    this.moveModeHud = document.getElementById('move-mode-hud')!;
    this.moveModeObjTitle = document.getElementById('move-obj-title')!;
    this.moveToast = document.getElementById('move-toast')!;

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

      await this.loadJendelaG1();

      this.interaction = new InteractionSystem(this.ctx);

      this.carrotCleaner = new CarrotCleaner(this.ctx, {
        onCleanComplete: () => {
          console.log('Carrot cleaning complete!');
          this.carrotCleanSucceeded = true;
        },
        onClose: () => {
          console.log('Carrot cleaner closed');
          // Setelah selesai membersihkan, kembalikan ke popup opsi kran
          // supaya player bisa mematikan kran.
          if (this.carrotCleanSucceeded) {
            this.carrotCleanSucceeded = false;
            this.showInteractionPanel();
          }
        }
      });

      this.doorTeleport = new DoorTeleportSystem(this.ctx);
      this.proximityTeleport = new ProximityTeleportSystem(this.ctx);

      await this.loadFridge();

      await this.loadPan();

      await this.loadServingSet();

      this.player = new PlayerController(this.ctx);
      this.debugSystem = new DebugSystem(this.ctx);

      this.furnitureMove = new FurnitureMoveSystem(this.ctx, this.collision, {
        onStartMove: (obj) => {
          this.moveModeObjTitle.textContent = obj.displayName;
          this.moveModeHud.style.display = 'block';
          this.hideErgonomics();
          this.hideInteractionPanel();
          this.showToast(`📦 Memindahkan ${obj.displayName} — Arahkan kursor, scroll/Q/E untuk putar, klik/Space untuk letakkan`);
          if (this.mobileControls) this.mobileControls.setMoveMode(true);
        },
        onPlaced: (obj) => {
          this.moveModeHud.style.display = 'none';
          this.showToast(`✅ ${obj.displayName} berhasil dipindahkan`);
          if (this.mobileControls) this.mobileControls.setMoveMode(false);
        },
        onCancelled: (obj) => {
          this.moveModeHud.style.display = 'none';
          this.showToast(`↩️ Pemindahan ${obj.displayName} dibatalkan`);
          if (this.mobileControls) this.mobileControls.setMoveMode(false);
        },
      });

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
          (locked) => {
            this.updatePointerLockHint(locked);
            // Tell fridge system about pointer lock so it uses crosshair
            if (this.fridgeInteraction) {
              this.fridgeInteraction.setPointerLocked(locked);
            }
          }
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
      this.setupErgoMoveButton();

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

    if (this.ctx.kitchenModel) {
      this.ctx.kitchenModel.add(fridgeModel);
    } else {
      this.ctx.scene.add(fridgeModel);
    }

    const finalBox = new THREE.Box3().setFromObject(fridgeModel);
    const finalCenter = new THREE.Vector3();
    finalBox.getCenter(finalCenter);
    const finalSize = new THREE.Vector3();
    finalBox.getSize(finalSize);

    this.ctx.interactiveObjects.push({
      name: 'kulkas',
      displayName: 'Kulkas',
      category: 'fridge',
      object3D: fridgeModel,
      boundingBox: finalBox.clone(),
      center: finalCenter.clone(),
      height: finalSize.y,
      surfaceY: finalBox.max.y,
      movable: true,
    });

    this.fridgeInteraction = new FridgeInteractionSystem(this.ctx, this.collision);
    await this.fridgeInteraction.initialize(fridgeModel, gltf.animations);
    this.fridgeInteraction.onMoveRequested = () => {
      const fridgeObj = this.ctx.interactiveObjects.find((o) => o.name === 'kulkas');
      if (fridgeObj && this.furnitureMove) {
        this.furnitureMove.startMoving(fridgeObj);
      }
    };
  }

  /**
   * World Y dari permukaan pertama yang terlihat tepat di bawah (x, z).
   * Dipakai untuk mendudukkan panci di atas permukaan meja yang benar (G_8),
   * bukan nilai `surfaceY` hasil normalisasi yang bisa menunjuk ke backsplash.
   */
  private findTableSurfaceY(x: number, z: number): number {
    const model = this.ctx.kitchenModel;
    if (!model) return this.ctx.floorY;
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(x, 12, z),
      new THREE.Vector3(0, -1, 0),
      0,
      100
    );
    const hits = raycaster.intersectObject(model, true);
    for (const hit of hits) {
      if (hit.object.visible && hit.distance > 1e-4) {
        return hit.point.y;
      }
    }
    return this.ctx.floorY;
  }

  /**
   * Memuat panci GLB dan mendudukkannya di atas Meja Kerja Dapur 3 (G_8).
   * Hanya dekorasi: tanpa hitbox, tanpa interaksi. Skala dinormalisasi ke
   * tinggi nyata (PAN_TARGET_HEIGHT_M) dan posisi Y dihitung dari raycast
   * ke bawah di titik target sehingga dasar panci menyentuh permukaan meja
   * tanpa melayang atau menembus.
   */
  private async loadPan(): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(PAN_GLB);
    const pan = gltf.scene;

    pan.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    pan.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(pan);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const currentHeightM = size.y / this.ctx.sceneScale;
    let scale = PAN_TARGET_HEIGHT_M / Math.max(currentHeightM, 1e-6);
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    pan.scale.setScalar(scale);

    pan.updateMatrixWorld(true);
    const scaledBBox = new THREE.Box3().setFromObject(pan);

    const surfaceY = this.findTableSurfaceY(PAN_TARGET_X, PAN_TARGET_Z);
    pan.position.set(PAN_TARGET_X, surfaceY - scaledBBox.min.y, PAN_TARGET_Z);
    pan.name = 'panci';

    if (this.ctx.kitchenModel) {
      this.ctx.kitchenModel.add(pan);
    } else {
      this.ctx.scene.add(pan);
    }
  }

  /**
   * Memuat set penyajian (low_poly_tableware.glb) dan mendudukkannya di area
   * bekas klaster bumbu (worktop G_121). Hanya dekorasi: tanpa hitbox, tanpa
   * interaksi. Skala dinormalisasi ke diameter piring target
   * (SAJI_TARGET_WIDTH_M = 0.20 m) memakai mesh piring (Dish) sebagai anchor;
   * bila mesh piring tidak ditemukan, fallback ke lebar placemat
   * (SAJI_FALLBACK_WIDTH_M). Posisi Y dihitung dari raycast ke bawah
   * (findTableSurfaceY) sehingga dasar placemat menempel persis di permukaan
   * slab (Mesh11, y≈8.8). Rotation Y = 0 sesuai orientasi asli asset.
   */
  private async loadServingSet(): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(SAJI_GLB);
    const set = gltf.scene;

    set.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    set.updateMatrixWorld(true);

    // Perbaiki HANYA z-fighting pada alas placemat: plane `Mat_24_-_Default_0`
    // persis sebidang dengan top slab (keduanya di y=8.8) sehingga berkedip/
    // kabur saat kamera bergerak. Diberi bias depth render-time (polygon
    // offset) pada mesh alas saja. Appearance material asli GLB (color, map,
    // normalMap, metalness, roughness, opacity) tidak diubah sama sekali.
    const matNode = set.getObjectByName('Mat_24_-_Default_0');
    if (matNode) {
      const matMat = (matNode as THREE.Mesh).material as THREE.MeshStandardMaterial;
      matMat.polygonOffset = true;
      matMat.polygonOffsetFactor = -1;
      matMat.polygonOffsetUnits = -1;
    }

    let anchorWorld: number | null = null;
    const dish = set.getObjectByName('Dish_09_-_Default_0');
    if (dish) {
      const dishBox = new THREE.Box3().setFromObject(dish);
      const dishSize = new THREE.Vector3();
      dishBox.getSize(dishSize);
      anchorWorld = Math.max(dishSize.x, dishSize.z);
    }

    const bbox = new THREE.Box3().setFromObject(set);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    let scale: number;
    if (anchorWorld !== null) {
      const currentDishM = anchorWorld / this.ctx.sceneScale;
      scale = SAJI_TARGET_WIDTH_M / Math.max(currentDishM, 1e-6);
    } else {
      const currentWidthM = size.x / this.ctx.sceneScale;
      scale = SAJI_FALLBACK_WIDTH_M / Math.max(currentWidthM, 1e-6);
    }
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    set.scale.setScalar(scale);

    set.updateMatrixWorld(true);
    const scaledBBox = new THREE.Box3().setFromObject(set);

    const surfaceY = this.findTableSurfaceY(SAJI_TARGET_X, SAJI_TARGET_Z);
    set.position.set(SAJI_TARGET_X, surfaceY - scaledBBox.min.y, SAJI_TARGET_Z);
    set.rotation.y = Math.PI / 2;
    set.name = 'meja_saji';

    if (this.ctx.kitchenModel) {
      this.ctx.kitchenModel.add(set);
    } else {
      this.ctx.scene.add(set);
    }
  }

  private async loadJendelaG1(): Promise<void> {
    const windowUrl = `${GLB_BASE}models/Jendela_G1.glb`;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(windowUrl);
    const windowModel = gltf.scene;
    windowModel.name = 'jendela_g1';

    windowModel.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(windowModel);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    const OPENING_CENTER = new THREE.Vector3(-0.25, 16.90, 14.00);
    windowModel.position.set(
      OPENING_CENTER.x - center.x,
      OPENING_CENTER.y - center.y,
      OPENING_CENTER.z - center.z
    );

    windowModel.userData.interactable = true;
    windowModel.userData.interaction = 'window';
    windowModel.userData.windowName = 'jendela_g1';
    windowModel.userData.windowLabel = 'Jendela G1';

    const mixer = new THREE.AnimationMixer(windowModel);
    const openClip = gltf.animations.find((clip) => clip.name === 'OPEN') ?? null;
    const closeClip = gltf.animations.find((clip) => clip.name === 'CLOSE') ?? null;
    windowModel.userData.mixer = mixer;
    windowModel.userData.windowOpen = openClip;
    windowModel.userData.windowClose = closeClip;

    if (this.ctx.kitchenModel) {
      this.ctx.kitchenModel.add(windowModel);
    } else {
      this.ctx.scene.add(windowModel);
    }
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
        if (this.carrotCleaner?.isOpened()) {
          this.carrotCleaner.close();
        } else {
          this.hideErgonomics();
          this.hideInteractionPanel();
          if (this.fridgeInteraction) {
            this.fridgeInteraction.hideInteractionMenu();
          }
        }
      }

      if (this.fridgeInteraction && this.fridgeInteraction.getState() !== FridgeState.IDLE) {
        if (this.fridgeInteraction.onKeyDown(e.code)) {
          return;
        }
      }

      if (e.code === 'KeyF') {
        // Check if player is gazing at the fridge (via hitbox raycast) OR fridge is hovered
        const gazingAtFridge =
          (this.hitboxTargetObj?.name === 'kulkas') ||
          (this.fridgeInteraction?.isFridgeHovered());

        if (this.fridgeInteraction && gazingAtFridge) {
          // Directly toggle fridge door — no ESC / cursor needed
          this.fridgeInteraction.toggleFridgeDoor();
        } else if (this.interaction?.getHover()) {
          this.showInteractionPanel();
        }
      }
      // [G] key — toggle furniture move mode for nearest object
      if (e.code === 'KeyG' && this.furnitureMove) {
        if (this.furnitureMove.isMoving()) {
          this.furnitureMove.cancel();
        } else {
          this.tryStartFurnitureMove();
        }
      }
    });

    const ergoClose = document.getElementById('ergo-close')!;
    ergoClose.addEventListener('click', () => this.hideErgonomics());
  }

  /** Wire up the "Pindah & Putar" button inside the ergonomics panel. */
  private setupErgoMoveButton(): void {
    const btn = document.getElementById('btn-ergo-move');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const obj = this.highlightedObject;
      this.hideErgonomics();
      if (obj && obj.movable && this.furnitureMove) {
        this.furnitureMove.startMoving(obj);
      }
    });
  }

  /** Try to start moving the object the player is LOOKING AT (crosshair raycast first, proximity fallback). */
  private tryStartFurnitureMove(): void {
    if (!this.furnitureMove || this.furnitureMove.isMoving()) return;

    // Use the hitbox-targeted object if we already computed it this frame
    const target = this.hitboxTargetObj;
    if (target) {
      this.furnitureMove.startMoving(target);
      return;
    }

    // Fallback: pick the object closest to the player within a short range
    const playerPos = this.player.getPosition();
    const scale = this.ctx.sceneScale;
    const maxDist = 3.5 * scale;
    let closest: InteractiveObject | null = null;
    let closestDist = Infinity;
    for (const obj of this.ctx.interactiveObjects) {
      if (!obj.movable) continue;
      const d = playerPos.distanceTo(obj.center);
      if (d < maxDist && d < closestDist) {
        closestDist = d;
        closest = obj;
      }
    }
    if (closest) {
      this.furnitureMove.startMoving(closest);
    } else {
      this.showToast('⚠️ Arahkan pandangan ke barang yang ingin dipindahkan');
    }
  }

  /**
   * Raycast from camera centre to find which interactive object the player is
   * looking at, then show / hide the faint blue hitbox helper accordingly.
   */
  private updateHitboxHelper(): void {
    if (this.furnitureMove?.isMoving()) {
      // Hide during active move
      if (this.hitboxHelper) this.hitboxHelper.visible = false;
      this.hitboxTargetObj = null;
      return;
    }

    const scale = Math.max(this.ctx.sceneScale, 1e-6);
    // Collect all mesh objects from interactive objects for raycasting
    const candidateMeshes: THREE.Object3D[] = [];
    for (const obj of this.ctx.interactiveObjects) {
      if (!obj.movable) continue;
      obj.object3D.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) candidateMeshes.push(child);
      });
    }

    this.hitboxRaycaster.setFromCamera(this.hitboxScreenCenter, this.ctx.camera);
    this.hitboxRaycaster.far = 4.5 * scale;

    let targeted: InteractiveObject | null = null;

    if (candidateMeshes.length > 0) {
      const hits = this.hitboxRaycaster.intersectObjects(candidateMeshes, false);
      if (hits.length > 0) {
        // Walk up to find which InteractiveObject this mesh belongs to
        outer: for (const hit of hits) {
          let node: THREE.Object3D | null = hit.object;
          while (node) {
            for (const obj of this.ctx.interactiveObjects) {
              if (obj.object3D === node || obj.object3D.getObjectById(node.id)) {
                targeted = obj;
                break outer;
              }
            }
            node = node.parent;
          }
        }
      }
    }

    // If raycast missed, check if any object is very close AND in front of camera
    if (!targeted) {
      const playerPos = this.player.getPosition();
      const forward = new THREE.Vector3();
      this.ctx.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      const closeRange = 2.2 * scale;
      let bestDot = 0.6; // must be looking roughly at it (within ~53°)
      for (const obj of this.ctx.interactiveObjects) {
        if (!obj.movable) continue;
        const toObj = new THREE.Vector3().subVectors(obj.center, playerPos);
        const dist = toObj.length();
        if (dist > closeRange) continue;
        toObj.y = 0;
        toObj.normalize();
        const dot = toObj.dot(forward);
        if (dot > bestDot) {
          bestDot = dot;
          targeted = obj;
        }
      }
    }

    this.hitboxTargetObj = targeted;

    if (targeted) {
      // Build a tight bounding box around the object (with tiny padding)
      targeted.object3D.updateMatrixWorld(true);
      const tightBox = new THREE.Box3().setFromObject(targeted.object3D);
      // Very small padding (5 cm in world units) so it's snug
      const pad = 0.05 * scale;
      tightBox.expandByScalar(pad);

      if (!this.hitboxHelper) {
        this.hitboxHelper = new THREE.Box3Helper(tightBox, new THREE.Color(0x38bdf8));
        // Make the lines semi-transparent blue
        const mat = this.hitboxHelper.material as THREE.LineBasicMaterial;
        mat.transparent = true;
        mat.opacity = 0.45;
        mat.depthWrite = false;
        mat.linewidth = 1;
        this.ctx.scene.add(this.hitboxHelper);
      } else {
        this.hitboxHelper.box.copy(tightBox);
      }
      this.hitboxHelper.visible = true;
    } else {
      if (this.hitboxHelper) this.hitboxHelper.visible = false;
    }
  }

  private showToast(message: string): void {
    if (this.moveToastTimer !== null) {
      clearTimeout(this.moveToastTimer);
      this.moveToastTimer = null;
    }
    this.moveToast.textContent = message;
    this.moveToast.style.display = 'block';
    this.moveToast.classList.remove('toast-fade');
    // Force reflow to restart CSS transition
    void this.moveToast.offsetWidth;
    this.moveToast.classList.add('toast-fade');
    this.moveToastTimer = setTimeout(() => {
      this.moveToast.style.display = 'none';
      this.moveToast.classList.remove('toast-fade');
      this.moveToastTimer = null;
    }, 3500);
  }

  private showInteractionPanel(): void {
    const hover = this.interaction?.getHover();
    const hoverType = this.interaction?.getHoverType?.();
    if (!hover || !hoverType || hoverType === 'none') return;

    document.exitPointerLock?.();

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
        // Setelah kran menyala, aus popup pembersih wortel muncul beberapa
        // detik kemudian.
        if (this.interaction.isFaucetOpen()) {
          this.scheduleCarrotCleanPrompt();
        }
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

  /**
   * Setelah kran dinyalakan, munculkan popup pembersihan wortel setelah
   * jeda CARROT_CLEAN_DELAY_MS (4,3 detik).
   */
  private scheduleCarrotCleanPrompt(): void {
    if (this.faucetCarrotTimer !== null) clearTimeout(this.faucetCarrotTimer);
    this.faucetCarrotTimer = setTimeout(() => {
      this.faucetCarrotTimer = null;
      if (!this.carrotCleaner?.isOpened()) this.carrotCleaner.open();
    }, CARROT_CLEAN_DELAY_MS);
  }

  private showErgonomics(obj: InteractiveObject): void {
    const result = this.ergonomics.analyze(this.player.state, obj);

    document.exitPointerLock?.();

    this.ergoPanel.style.display = 'block';
    this.ergoTitle.textContent = obj.displayName;

    const moveBtn = document.getElementById('btn-ergo-move');
    if (moveBtn) {
      moveBtn.style.display = obj.movable ? 'block' : 'none';
    }

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

    // Use a yellow Box3Helper outline — no material swapping
    obj.object3D.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj.object3D);
    const pad = 0.04 * Math.max(this.ctx.sceneScale, 1e-6);
    box.expandByScalar(pad);

    if (!this.ergoHighlightHelper) {
      this.ergoHighlightHelper = new THREE.Box3Helper(box, new THREE.Color(0xffd700));
      const mat = this.ergoHighlightHelper.material as THREE.LineBasicMaterial;
      mat.transparent = true;
      mat.opacity = 0.7;
      mat.depthWrite = false;
      this.ctx.scene.add(this.ergoHighlightHelper);
    } else {
      this.ergoHighlightHelper.box.copy(box);
    }
    this.ergoHighlightHelper.visible = true;
  }

  private unhighlightAll(): void {
    if (this.highlightedObject) {
      // Just hide the helper — no materials to restore
      if (this.ergoHighlightHelper) {
        this.ergoHighlightHelper.visible = false;
      }
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

    // --- Furniture Move System ---
    if (this.furnitureMove) {
      if (this.furnitureMove.isMoving()) {
        // While in move mode: pass all rotation / place / cancel inputs to the move system.
        // Suppress normal player interaction so [E] doesn't also fire ergonomics.
        this.furnitureMove.update(delta, input);

        // Show mobile move button hint visibility
        if (this.mobileControls) {
          this.mobileControls.showMoveButton(false);
        }

        // Still allow player walking (WASD) while repositioning
        this.player.update(input, delta, (pos, radius) => {
          return this.collision.resolvePosition(pos, radius, this.player.getHeight());
        });

        if (this.showReachIndicator) this.updateReachIndicator();
        this.playerPosEl.textContent = `Pos: ${this.player.state.position.x.toFixed(2)}, ${this.player.state.position.y.toFixed(2)}, ${this.player.state.position.z.toFixed(2)}`;
        this.renderer.render(this.scene, this.camera);
        return;
      }

      // Not in move mode: check for moveToggle input ([G] key / mobile move button)
      if (input.moveToggle) {
        this.tryStartFurnitureMove();
      }
    }

    // Update faint blue hitbox highlight every frame
    this.updateHitboxHelper();
    // --- End Furniture Move System ---

    this.player.update(input, delta, (pos, radius) => {
      return this.collision.resolvePosition(pos, radius, this.player.getHeight());
    });

    if (this.fridgeInteraction) {
      this.fridgeInteraction.update(delta);
    }

    this.proximityTeleport.update();

    if (this.showReachIndicator) {
      this.updateReachIndicator();
    }

    // Show prompt based on hitbox-targeted object (what player is LOOKING at) rather than just proximity
    const gazed = this.hitboxTargetObj;
    const nearest = gazed ?? this.ergonomics.findNearestObject(this.player.getPosition());
    if (nearest) {
      if (nearest.category === 'fridge') {
        this.promptText.textContent = `${nearest.displayName} — [E] Analisis | [F] Menu | [G] Pindah & Putar`;
      } else if (nearest.movable) {
        this.promptText.textContent = `${nearest.displayName} — [E] Analisis | [G] Pindah & Putar`;
      } else {
        this.promptText.textContent = `${nearest.displayName} — [E] Analisis`;
      }
      this.interactionPrompt.style.display = 'block';

      // Show the mobile move button only when near a moveable object
      if (this.mobileControls) this.mobileControls.showMoveButton(nearest.movable);

      if (input.interact) {
        this.showErgonomics(nearest);
      }
    } else {
      this.interactionPrompt.style.display = 'none';
      if (this.mobileControls) this.mobileControls.showMoveButton(false);
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

    this.playerPosEl.textContent = `Pos: ${this.player.state.position.x.toFixed(2)}, ${this.player.state.position.y.toFixed(2)}, ${this.player.state.position.z.toFixed(2)}`;

    this.renderer.render(this.scene, this.camera);
  };
}

window.addEventListener('DOMContentLoaded', () => {
  new KitchenErgonomicsApp();
});
