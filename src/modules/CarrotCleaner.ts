import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { SceneContext } from './types';

interface CarrotCleanerOptions {
  onCleanComplete?: () => void;
  onClose?: () => void;
}

const GLB_URL = '/carrot.glb';

export class CarrotCleaner {
  private ctx: SceneContext;
  private options: CarrotCleanerOptions;
  private container!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private carrotGroup: THREE.Group | null = null;

  // Dirt effect (Canvas 2D -> texture, sebagai overlay mesh, TIDAK menghapus wortel)
  private dirtCanvas!: HTMLCanvasElement;
  private dirtCtx!: CanvasRenderingContext2D;
  private dirtTexture!: THREE.CanvasTexture;
  private dirtMeshes: THREE.Mesh[] = [];
  private carrotMaskCanvas: HTMLCanvasElement | null = null;
  private carrotScrubRegionCanvas: HTMLCanvasElement | null = null;
  private carrotScratchCanvas: HTMLCanvasElement | null = null;
  private raycaster: THREE.Raycaster | null = null;

  private cleanProgress = 0;
  private targetProgress = 0;
  private animationId: number | null = null;
  private statusElement!: HTMLElement;
  private closeButton!: HTMLButtonElement;
  private isOpen = false;
  private threeInitialized = false;
  private cleanCompleteFired = false;
  private lastScrubTime = 0;
  private scrubAccumulator = 0;

  constructor(ctx: SceneContext, options: CarrotCleanerOptions = {}) {
    this.ctx = ctx;
    this.options = options;
    this.createModal();
    this.setupEventListeners();
  }

  // ---------------------------------------------------------------------------
  // Modal DOM
  // ---------------------------------------------------------------------------

  private createModal(): void {
    this.container = document.createElement('div');
    this.container.id = 'carrot-cleaner-modal';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 10000;
      display: none;
      font-family: system-ui, sans-serif;
    `;

    const overlay = document.createElement('div');
    overlay.id = 'carrot-cleaner-overlay';
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(2px);
    `;

    const modal = document.createElement('div');
    modal.id = 'carrot-cleaner-popup';
    modal.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 33vw;
      max-width: 400px;
      height: 50vh;
      max-height: 500px;
      min-width: 280px;
      min-height: 350px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      background: rgba(0, 0, 0, 0.04);
    `;

    const title = document.createElement('h3');
    title.textContent = 'Bersihkan Wortel';
    title.style.cssText = `
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: #333;
    `;

    this.closeButton = document.createElement('button');
    this.closeButton.innerHTML = '&times;';
    this.closeButton.style.cssText = `
      background: none;
      border: none;
      color: #666;
      font-size: 1.5rem;
      cursor: pointer;
      padding: 4px 8px;
      line-height: 1;
      border-radius: 4px;
      transition: color 0.2s, background 0.2s;
    `;
    this.closeButton.onmouseenter = () => {
      this.closeButton.style.color = '#000';
      this.closeButton.style.background = 'rgba(0, 0, 0, 0.1)';
    };
    this.closeButton.onmouseleave = () => {
      this.closeButton.style.color = '#666';
      this.closeButton.style.background = 'none';
    };

    header.appendChild(title);
    header.appendChild(this.closeButton);

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'carrot-cleaner-canvas';
    this.canvas.style.cssText = `
      flex: 1;
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
      cursor: crosshair;
    `;

    this.statusElement = document.createElement('div');
    this.statusElement.id = 'carrot-cleaner-status';
    this.statusElement.style.cssText = `
      padding: 8px 16px;
      font-size: 0.85rem;
      color: #666;
      text-align: center;
      background: rgba(0, 0, 0, 0.04);
      border-top: 1px solid rgba(0, 0, 0, 0.1);
    `;
    this.statusElement.textContent = 'Memuat model...';

    modal.appendChild(header);
    modal.appendChild(this.canvas);
    modal.appendChild(this.statusElement);
    this.container.appendChild(overlay);
    this.container.appendChild(modal);

    document.body.appendChild(this.container);
  }

  // ---------------------------------------------------------------------------
  // Three.js init (setelah modal tampil supaya canvas punya ukuran)
  // ---------------------------------------------------------------------------

  private initializeThreeJS(): void {
    if (this.threeInitialized) return;
    this.threeInitialized = true;

    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    console.log('[CarrotCleaner] init canvas size:', cw, ch);

    if (cw === 0 || ch === 0) {
      requestAnimationFrame(() => {
        this.threeInitialized = false;
        this.initializeThreeJS();
      });
      return;
    }

    this.setupThreeJS();
    void this.loadCarrotModel();
  }

  private setupThreeJS(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    console.log('[CarrotCleaner] renderer size:', this.renderer.getSize(new THREE.Vector2()));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x222222);

    this.camera = new THREE.PerspectiveCamera(45, this.canvas.clientWidth / this.canvas.clientHeight, 0.01, 100);
    this.camera.position.set(0, 0, 3);
    this.camera.lookAt(0, 0, 0);

    // Lighting cukup supaya model tidak hitam.
    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 2.4);
    dir.position.set(3, 5, 4);
    this.scene.add(dir);

    const dir2 = new THREE.DirectionalLight(0xffeedd, 1.2);
    dir2.position.set(-4, 2, -3);
    this.scene.add(dir2);

    this.setupDirtCanvas();
    window.addEventListener('resize', () => this.onResize());
  }

  // ---------------------------------------------------------------------------
  // Dirt canvas (Canvas 2D), fase 2 — overlay, bukan alphaMap
  // ---------------------------------------------------------------------------

  private setupDirtCanvas(): void {
    this.dirtCanvas = document.createElement('canvas');
    this.dirtCanvas.width = 512;
    this.dirtCanvas.height = 512;
    this.dirtCtx = this.dirtCanvas.getContext('2d')!;

    this.drawDirtPattern();

    this.dirtTexture = new THREE.CanvasTexture(this.dirtCanvas);
    this.dirtTexture.needsUpdate = true;
    this.dirtTexture.colorSpace = THREE.SRGBColorSpace;
  }

  /**
   * Rasterizes the carrot's UV-space footprint (from the model's geometry +
   * UV attributes) into a 512x512 mask canvas. Pixels covered by any carrot
   * triangle are opaque; everything else stays transparent. Used to bound both
   * dirt painting and brush erasing strictly to the carrot surface.
   */
  private buildCarrotMask(root: THREE.Object3D): void {
    const W = 512;
    const H = 512;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const cctx = canvas.getContext('2d')!;
    cctx.clearRect(0, 0, W, H);
    cctx.fillStyle = '#000';
    cctx.beginPath();

    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry;
      const uv = geo.attributes.uv;
      const index = geo.index;
      if (!uv) return;

      const px = (i: number) => uv.getX(i) * W;
      const py = (i: number) => (1 - uv.getY(i)) * H;
      const count = index ? Math.floor(index.count / 3) : Math.floor(uv.count / 3);

      for (let t = 0; t < count; t++) {
        const a = index ? index.getX(t * 3) : t * 3;
        const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        cctx.moveTo(px(a), py(a));
        cctx.lineTo(px(b), py(b));
        cctx.lineTo(px(c), py(c));
        cctx.closePath();
      }
    });

    cctx.fill();
    this.carrotMaskCanvas = canvas;
  }

  /**
   * Builds the SCREEN-SPACE scrub region used as the "batas gosok": the union
   * of every projected triangle of the carrot (the silhouette as seen by the
   * camera), WITHOUT dilation — hanya area model (siluet) persis yang dihitung.
   * Pixels outside this region never erase dirt / never add progress.
   * Segitiga dengan vertex di belakang kamera (NDC z di luar [-1, 1]) dilewati
   * supaya tidak menghasilkan pixel region dari proyeksi terbalik.
   */
  private buildScrubRegion(): void {
    const W = 512;
    const H = 512;
    if (!this.carrotGroup || !this.camera) return;

    this.carrotGroup.updateMatrixWorld(true);

    const silhouette = document.createElement('canvas');
    silhouette.width = W;
    silhouette.height = H;
    const sctx = silhouette.getContext('2d')!;
    sctx.clearRect(0, 0, W, H);
    sctx.fillStyle = '#000';
    sctx.beginPath();

    const tmp = new THREE.Vector3();
    this.carrotGroup.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name.endsWith('_dirt')) return;
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      const index = geo.index;
      if (!pos) return;

      const toScreen = (i: number) => {
        tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
        tmp.project(this.camera);
        return { x: (tmp.x * 0.5 + 0.5) * W, y: (0.5 - tmp.y * 0.5) * H, z: tmp.z };
      };

      const count = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
      for (let t = 0; t < count; t++) {
        const a = index ? index.getX(t * 3) : t * 3;
        const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        const pa = toScreen(a);
        const pb = toScreen(b);
        const pc = toScreen(c);
        // Skip segitiga yang ada vertex-nya di belakang kamera / di luar near-far
        // (NDC z di luar [-1, 1]) supaya proyeksinya tidak "terbalik" dan
        // menimbulkan pixel region di luar area model.
        if (pa.z < -1 || pa.z > 1 || pb.z < -1 || pb.z > 1 || pc.z < -1 || pc.z > 1) continue;
        sctx.moveTo(pa.x, pa.y);
        sctx.lineTo(pb.x, pb.y);
        sctx.lineTo(pc.x, pc.y);
        sctx.closePath();
      }
    });
    sctx.fill();

    // TANPA dilasi: region = siluet wortel persis (toleransi 0), sehingga
    // hitbox pembersihan hanya tepat pada area model.
    this.carrotScrubRegionCanvas = silhouette;
  }

  private drawDirtPattern(): void {
    const ctx = this.dirtCtx;
    const w = this.dirtCanvas.width;
    const h = this.dirtCanvas.height;

    // Mulai transparan (tidak ada kotoran).
    ctx.clearRect(0, 0, w, h);

    // Lapisan dasar kotoran rata supaya baseline progress dekat 0%.
    ctx.fillStyle = 'rgba(94, 66, 38, 0.72)';
    ctx.fillRect(0, 0, w, h);

    // Splotches kotoran coklat.
    for (let i = 0; i < 120; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = Math.random() * 42 + 14;
      const alpha = Math.random() * 0.75 + 0.25;

      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(94, 66, 38, ${alpha})`);
      g.addColorStop(1, 'rgba(94, 66, 38, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Beberapa goresan kotoran memanjang.
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = Math.random() * 70 + 25;
      const thick = Math.random() * 6 + 2;
      const angle = Math.random() * Math.PI;
      const alpha = Math.random() * 0.5 + 0.2;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      const g = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
      g.addColorStop(0, 'rgba(94, 66, 38, 0)');
      g.addColorStop(0.5, `rgba(94, 66, 38, ${alpha})`);
      g.addColorStop(1, 'rgba(94, 66, 38, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(-len / 2, -thick / 2, len, thick);
      ctx.restore();
    }

    // Clip kotoran ke area permukaan wortel (UV mask) supaya background/outside
    // tidak pernah mendapat kotoran dan baseline progress dekat 0%.
    const mask = this.carrotMaskCanvas;
    if (mask) {
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(mask, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ---------------------------------------------------------------------------
  // Load model + auto fit (`fase 1`: model OPAQUE, tanpa dirt alphaMap)
  // ---------------------------------------------------------------------------

  private async loadCarrotModel(): Promise<void> {
    console.log('[CarrotCleaner] load mulai dari', GLB_URL);
    const loader = new GLTFLoader();

    try {
      const gltf = await loader.loadAsync(GLB_URL);
      console.log('[CarrotCleaner] GLB berhasil di-load');

      this.carrotGroup = gltf.scene;
      this.carrotGroup.name = 'carrot';
      this.scene.add(this.carrotGroup);

      this.prepareMeshes(this.carrotGroup);
      this.autoFit(this.glbSceneRoot());
      this.buildCarrotMask(this.carrotGroup);
      this.buildScrubRegion();
      this.drawDirtPattern();
      this.dirtTexture.needsUpdate = true;
      this.applyDirtVisual(0);
      this.statusElement.textContent = 'Gosok untuk membersihkan...';
      this.startAnimation();
    } catch (err) {
      console.error('[CarrotCleaner] GAGAL load model:', err);
      this.statusElement.textContent = 'Gagal memuat model wortel';
    }
  }

  private glbSceneRoot(): THREE.Object3D {
    return this.carrotGroup ?? this.scene;
  }

  /**
   * Klon material menjadi OPAQUE penuh supaya wortel pasti kelihatan, lalu
   * tambahkan mesh overlay dirt (material dasar, mapping Canvas 2D) per mesh.
   */
  private prepareMeshes(root: THREE.Object3D): void {
    let meshCount = 0;

    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshCount++;

      const stats = this.logMesh(mesh);

      // ------- BASE (fase 1: opaque) -------
      const baseMats = this.cloneOpaqueMaterials(mesh);
      const baseMesh = mesh;
      baseMesh.material = baseMats;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;

      // ------- DIRT OVERLAY (fase 2) -------
      // Mesh dengan geometri identik + material yang memakai CanvasTexture.
      // Overlay melapisi wortel; menggosok menghapus kotoran pada canvas,
      // warna wortel asli tetap terlihat (base opaque) di bawahnya.
      const dirtMesh = new THREE.Mesh(mesh.geometry.clone(), this.makeDirtMaterial());
      dirtMesh.name = `${mesh.name}_dirt`;
      dirtMesh.renderOrder = 10;
      dirtMesh.position.copy(mesh.position);
      dirtMesh.quaternion.copy(mesh.quaternion);
      dirtMesh.scale.copy(mesh.scale);

      // Tambahkan sebagai sibling agar transform identik dengan base.
      (mesh.parent ?? root).add(dirtMesh);
      this.dirtMeshes.push(dirtMesh);

      console.log(`[CarrotCleaner] mesh #${meshCount} siap. base=${stats.matType}`);
    });

    console.log('[CarrotCleaner] jumlah mesh:', meshCount, '| jumlah dirt overlay:', this.dirtMeshes.length);
  }

  private logMesh(mesh: THREE.Mesh): { matType: string } {
    const geo = mesh.geometry;
    const bb = geo.boundingBox ?? geo.computeBoundingBox();
    const bs = geo.boundingSphere ?? geo.computeBoundingSphere();
    const mat = mesh.material as any;
    const matType = Array.isArray(mat) ? mat.map((m: any) => m.type).join(',') : mat?.type;

    console.log('[CarrotCleaner] mesh:', mesh.name || '(no name)');
    console.log('[CarrotCleaner] material type:', matType);
    console.log('[CarrotCleaner] geometry bounding box:', bb ? `min(${bb.min.x},${bb.min.y},${bb.min.z}) max(${bb.max.x},${bb.max.y},${bb.max.z})` : 'none');
    console.log('[CarrotCleaner] geometry bounding sphere:', bs ? `center(${bs.center.x},${bs.center.y},${bs.center.z}) r=${bs.radius}` : 'none');
    return { matType };
  }

  private cloneOpaqueMaterials(mesh: THREE.Mesh): THREE.Material | THREE.Material[] {
    const m = mesh.material as THREE.Material | THREE.Material[];
    const list = Array.isArray(m) ? m : [m];
    const clones = list.map((orig) => {
      const c = orig.clone();
      c.transparent = false;
      c.opacity = 1;
      if ('alphaTest' in c) (c as THREE.Material).alphaTest = 0;
      if ('depthWrite' in c) (c as THREE.Material).depthWrite = true;
      if (c.side !== undefined) c.side = THREE.DoubleSide;
      return c;
    });
    return clones.length === 1 ? clones[0] : clones;
  }

  private makeDirtMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map: this.dirtTexture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Auto fit (bounding box + bounding sphere) — tanpa skala/kamera hardcoded
  // ---------------------------------------------------------------------------

  private autoFit(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    console.log('[CarrotCleaner] bbox size:', size.x.toFixed(3), size.y.toFixed(3), size.z.toFixed(3));
    console.log('[CarrotCleaner] bbox center:', center.x.toFixed(3), center.y.toFixed(3), center.z.toFixed(3));
    console.log('[CarrotCleaner] sphere center:', sphere.center.x.toFixed(3), sphere.center.y.toFixed(3), sphere.center.z.toFixed(3), 'r=', sphere.radius.toFixed(3));

    // Reset transform supaya orientasi terkontrol.
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);

    // Baringkan wortel: arah panjang model (sumbu +Z, tempat ujung terluar)
    // diputar ke sumbu +X sehingga tampil memanjang kiri-kanan di layar.
    root.rotation.set(0, Math.PI / 2, 0);
    root.updateMatrixWorld(true);

    // Skala dulu baru center-ulang, supaya pusat model tepat di origin
    // (offset tidak boleh dikurangkan sebelum skala — itu menyebabkan model
    // terpental keluar frame dan siluet gosok tak bertepatan dengan pointer).
    const maxDimension = Math.max(size.x, size.y, size.z);
    const targetSize = 1.5 * 20 * 20; // skala dunia model 20x lagi (30 -> 600)
    const scale = maxDimension > 0 ? targetSize / maxDimension : 1;
    root.scale.setScalar(scale);
    console.log('[CarrotCleaner] scale:', scale);

    root.updateMatrixWorld(true);

    const fittedBox = new THREE.Box3().setFromObject(root);
    const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
    root.position.sub(fittedCenter);
    root.updateMatrixWorld(true);

    const fittedSize = fittedBox.getSize(new THREE.Vector3());
    const maxFitted = Math.max(fittedSize.x, fittedSize.y, fittedSize.z);

    // Framming: wortel mengisi ±65% tinggi canvas modal. Kamera tetap di LUAR
    // model sehingga proyeksi siluet & gosokan valid (tidak masuk ke dalam mesh).
    const PCT = 0.65;
    const fovRadians = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (maxFitted / 2) / Math.tan(fovRadians / 2) / PCT;

    this.camera.position.set(0, maxFitted * 0.05, distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = Math.max(0.001, distance * 0.01);
    this.camera.far = distance + maxFitted;
    this.camera.updateProjectionMatrix();
    // Pastikan matrixWorld/matrixWorldInverse kamera ter-update SEBELUM
    // masking/proyeksi dihitung (tanpa ini proyeksi memakai matrix identity).
    this.camera.updateMatrixWorld(true);

    console.log('[CarrotCleaner] camera position:', this.camera.position.toArray().map(v => v.toFixed(3)).join(', '));
    console.log('[CarrotCleaner] camera fov:', this.camera.fov, '| near:', this.camera.near, '| far:', this.camera.far);
    console.log('[CarrotCleaner] model position:', root.position.toArray().map(v => v.toFixed(3)).join(', '), '| scale:', root.scale.toArray().map(v => v.toFixed(3)).join(', '));
  }

  // ---------------------------------------------------------------------------
  // Dirt visual & cleaning
  // ---------------------------------------------------------------------------

  private applyDirtVisual(progress: number): void {
    const t = Math.min(1, Math.max(0, progress));
    for (const m of this.dirtMeshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      if (!mat) continue;
      // Overlay tetap dikunci opacity 1; kotoran dihapus lewat Canvas (alpha).
      mat.opacity = 0.65 + 0.35 * t;
    }
  }

  private scrubAtPointer(e: PointerEvent): void {
    // Pemetaan mouse → canvas sederhana (bukan raycast).
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * this.dirtCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * this.dirtCanvas.height;

    // Hitbox = persis bentuk wortel: raycast pointer ke mesh wortel (base,
    // bukan overlay _dirt). Tanpa hit pada permukaan model → gosokan diabaikan.
    if (!this.isPointerOnCarrot(e, rect)) return;

    const brushRadius = 22 * (window.devicePixelRatio || 1);

    // Sapuan menggosok hanya "mengikis" sebagian kotoran per stamp (destination-out
    // memakai alpha source sebagai kekuatan pengurangan). Untuk membersihkan satu
    // titik dibutuhkan beberapa lintasan gosokan, sehingga durasi terasa natural
    // (~15 detik gosok terus-menerus) tanpa timer/rate-limit buatan.
    const g = this.dirtCtx.createRadialGradient(x, y, 0, x, y, brushRadius);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.42)');
    g.addColorStop(1, 'rgba(0,0,0,0)');

    const mask = this.carrotMaskCanvas;
    if (mask) {
      // Gabungkan brush dengan mask UV wortel, lalu hapus — texel di luar
      // bentuk wortel dijamin tidak pernah terhapus.
      if (!this.carrotScratchCanvas) {
        this.carrotScratchCanvas = document.createElement('canvas');
        this.carrotScratchCanvas.width = this.dirtCanvas.width;
        this.carrotScratchCanvas.height = this.dirtCanvas.height;
      }
      const scratch = this.carrotScratchCanvas;
      const sctx = scratch.getContext('2d')!;
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.globalCompositeOperation = 'source-over';
      sctx.drawImage(mask, 0, 0);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = g;
      sctx.beginPath();
      sctx.arc(x, y, brushRadius, 0, Math.PI * 2);
      sctx.fill();
      sctx.globalCompositeOperation = 'source-over';

      this.dirtCtx.globalCompositeOperation = 'destination-out';
      this.dirtCtx.drawImage(scratch, 0, 0);
      this.dirtCtx.globalCompositeOperation = 'source-over';
    } else {
      this.dirtCtx.globalCompositeOperation = 'destination-out';
      this.dirtCtx.fillStyle = g;
      this.dirtCtx.beginPath();
      this.dirtCtx.arc(x, y, brushRadius, 0, Math.PI * 2);
      this.dirtCtx.fill();
      this.dirtCtx.globalCompositeOperation = 'source-over';
    }

    this.dirtTexture.needsUpdate = true;
  }

  /**
   * Hitbox pembersihan = persis area permukaan model wortel. Pointer dikonversi
   * ke NDC lalu di-raycast ke mesh dasar wortel (overlay _dirt dikecualikan).
   * Tanpa intersect → pointer tidak berada di atas model → gosokan diabaikan.
   */
  private isPointerOnCarrot(e: PointerEvent, rect: DOMRect): boolean {
    if (!this.carrotGroup || !this.camera) return false;
    if (!this.raycaster) this.raycaster = new THREE.Raycaster();

    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    const targets: THREE.Mesh[] = [];
    this.carrotGroup.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name.endsWith('_dirt')) return;
      targets.push(mesh);
    });

    return this.raycaster.intersectObjects(targets, false).length > 0;
  }

  private updateProgressFromDirt(): void {
    const now = performance.now();
    if (now - this.lastScrubTime < 40 && this.scrubAccumulator < 1) return;
    this.lastScrubTime = now;

    const dirtImg = this.dirtCtx.getImageData(0, 0, this.dirtCanvas.width, this.dirtCanvas.height);
    const ddata = dirtImg.data;

    // Progress murni dari kotoran yang benar-benar tersisa di dalam area
    // gosok (scrub region: siluet wortel ∩ UV mask). Tidak ada rate-limit.
    const region = this.carrotScrubRegionCanvas;
    const uvMask = this.carrotMaskCanvas;
    let cleanPct = 0;
    if (region && uvMask) {
      const regionImg = region.getContext('2d')!.getImageData(0, 0, region.width, region.height);
      const rdata = regionImg.data;
      const maskImg = uvMask.getContext('2d')!.getImageData(0, 0, uvMask.width, uvMask.height);
      const mdata = maskImg.data;
      let maskPx = 0;
      let dirtyPx = 0;
      const n = ddata.length / 4;
      for (let i = 0; i < n; i++) {
        if (rdata[i * 4 + 3] > 127 && mdata[i * 4 + 3] > 127) {
          maskPx++;
          if (ddata[i * 4 + 3] > 8) dirtyPx++;
        }
      }
      // Denominator kosong: jangan dianggap 100% — dianggap 0.
      cleanPct = maskPx > 0 ? ((maskPx - dirtyPx) / maskPx) * 100 : 0;
    }

    // Progress tidak pernah turun.
    this.targetProgress = Math.max(this.targetProgress, Math.min(100, Math.max(0, cleanPct)));
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  private startAnimation(): void {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);

      // Progress mengikuti kebersihan nyata secara langsung. targetProgress
      // sudah dijamin tidak pernah turun (lihat updateProgressFromDirt).
      if (this.cleanProgress !== this.targetProgress) {
        this.cleanProgress = this.targetProgress;
        this.applyDirtVisual(this.cleanProgress / 100);
        this.updateStatus();
      }

      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    };
    animate();
  }

  // ---------------------------------------------------------------------------
  // Input events
  // ---------------------------------------------------------------------------

  private setupEventListeners(): void {
    this.closeButton.addEventListener('click', () => this.close());
    const overlay = this.container.querySelector('#carrot-cleaner-overlay');
    overlay?.addEventListener('click', () => this.close());

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.carrotGroup) {
        this.carrotGroup.rotation.y += e.deltaY * 0.005;
        this.carrotGroup.updateMatrixWorld(true);
        this.buildScrubRegion();
      }
    }, { passive: false });
  }

  private onPointerDown(e: PointerEvent): void {
    this.scrubAtPointer(e);
    this.updateProgressFromDirt();
  }

  private onPointerMove(e: PointerEvent): void {
    // Menggosok TANPA tombol ditekan: pointermove langsung menggosok selama
    // pointer berada di scrub region (filter region dilakukan di scrubAtPointer).
    this.scrubAtPointer(e);
    this.updateProgressFromDirt();
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  private updateStatus(): void {
    const pct = Math.round(this.cleanProgress);
    if (pct >= 100) {
      this.statusElement.textContent = 'Bersih!';
      this.statusElement.style.color = '#4caf50';
      this.statusElement.style.fontWeight = '600';

      if (!this.cleanCompleteFired) {
        this.cleanCompleteFired = true;
        this.options.onCleanComplete?.();
        setTimeout(() => this.close(), 1000); 
      }
    } else {
      this.statusElement.textContent = `Bersih: ${pct}% - Gosok untuk membersihkan...`;
      this.statusElement.style.color = '#666';
      this.statusElement.style.fontWeight = '400';
    }
  }

  // ---------------------------------------------------------------------------
  // Open / close / resize
  // ---------------------------------------------------------------------------

  private onResize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.renderer) {
      this.renderer.setSize(w, h);
    }
    if (this.carrotGroup) {
      this.buildScrubRegion();
    }
    console.log('[CarrotCleaner] resize ->', w, 'x', h);
  }

  public open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    console.log('[CarrotCleaner] open()');
    this.container.style.display = 'block';
    this.disableMainSceneInteraction();

    requestAnimationFrame(() => {
      console.log('[CarrotCleaner] canvas saat open:', this.canvas.clientWidth, 'x', this.canvas.clientHeight);
      this.onResize();
      this.initializeThreeJS();
    });
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.container.style.display = 'none';
    this.enableMainSceneInteraction();
    this.options.onClose?.();
  }

  public isOpened(): boolean {
    return this.isOpen;
  }

  private disableMainSceneInteraction(): void {
    this.ctx.renderer.domElement.style.pointerEvents = 'none';
  }

  private enableMainSceneInteraction(): void {
    this.ctx.renderer.domElement.style.pointerEvents = 'auto';
  }

  public dispose(): void {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this.renderer) this.renderer.dispose();
    if (this.dirtTexture) this.dirtTexture.dispose();
    this.container.remove();
    this.enableMainSceneInteraction();
  }
}