import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { SceneContext } from './types';

const CARROT_GLB = '/carrot.glb';

/** Mesh piring pada low_poly_tableware.glb; anchor posisi hidangan. */
const DISH_NAME = 'Dish_09_-_Default_0';

/** Nama set penyajian di ctx.interactiveObjects (lihat loadServingSet di main.ts). */
const SERVING_TABLE_NAME = 'meja_saji';

/**
 * Panjang wortel rebus yang disajikan. Asset carrot.glb diskalakan ulang agar
 * sumbu terpanjangnya tepat FOOD_TARGET_LENGTH_M. Piring hidangan berdiameter
 * 0.20 m, jadi 0.19 m memberi panjang wortel 95% diameter piring: memenuhi
 * piring dengan margin tipis di kedua ujung, dan tetap proporsional.
 */
const FOOD_TARGET_LENGTH_M = 0.19;

/**
 * Warna "rebus". Material asli carrot.glb bernilai putih dan bergantung penuh
 * pada map, jadi tint oranje inilah yang membedakan hidangan dari wortel mentah.
 */
const COOKED_CARROT_COLOR = 0xff8a3d;

/**
 * Batas radius (dalam unit lokal carrot.glb) yang memisahkan badan wortel dari
 * daun, diukur dari sumbu panjang model.
 *
 * Asset ini diukur langsung: badan wortel (shell yang membentuk silinder
 * meruncing) punya radius maksimal 36,1, sedangkan tiap blade daun mulai
 * 82,5 dan menjulang sampai 104,6. Ada celah lebar di antara keduanya, jadi
 * ambang ini tidak mungkin salah pilih.
 */
const LEAF_BODY_RADIUS = 60;

export type ServeState = 'notReady' | 'readyToServe' | 'served';

export interface ServingEvents {
  /** Dipanggil sekali, saat makanan benar-benar diletakkan di meja hidang. */
  onServed?: () => void;
}

interface FoodAnchor {
  x: number;
  y: number;
  z: number;
}

/**
 * Tahap akhir permainan: menyajikan wortel rebus hasil memasak.
 *
 * Sengaja sederhana, tanpa animasi dan tanpa update per frame:
 *   - tidak ada sistem membawa / inventory makanan;
 *   - tidak ada interaksi mengambil wortel dari panci;
 *   - wortel tidak pernah muncul di area panci.
 *
 * Flux hanya tiga state:
 *   notReady      -> belum memasak; makanan belum ada di scene
 *   readyToServe  -> sudah matang; bisa disajikan lewat interaksi meja hidang
 *   served        -> sudah diletakkan di piring; tahap selesai
 */
export class ServingSystem {
  private ctx: SceneContext;
  private food: THREE.Object3D | null = null;
  private anchor: FoodAnchor | null = null;
  private events: ServingEvents = {};
  private state: ServeState = 'notReady';

  constructor(ctx: SceneContext, events: ServingEvents = {}) {
    this.ctx = ctx;
    this.events = events;
  }

  public getState(): ServeState {
    return this.state;
  }

  public isReadyToServe(): boolean {
    return this.state === 'readyToServe';
  }

  /**
   * Memuat carrot.glb sekali saat layar loading, menskalakannya ke ukuran
   * hidangan, dan menambahkannya ke scene dengan visible = false supaya tidak
   * ada jeda/flash saat pemain-serving di detik terakhir.
   *
   * Makanan sengaja di-parent ke kitchenModel dan diposisikan dalam koordinat
   * WORLD, bukan ke object penyajian: loadServingSet() memutar set 90 derajat
   * (rotation.y = Math.PI / 2), sehingga koordinat lokal set tidak bisa dipakai
   * langsung untuk koordinat dunia.
   */
  public async preload(servingSetRoot: THREE.Object3D): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(CARROT_GLB);
    const food = gltf.scene;

    food.name = 'wortel_rebus';
    food.visible = false;
    food.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.tintCooked(mesh);
    });

    const S = Math.max(this.ctx.sceneScale, 1e-6);
    this.stripLeaves(food);
    food.updateMatrixWorld(true);
    this.layFlat(food);
    food.updateMatrixWorld(true);
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(food).getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    food.scale.setScalar((FOOD_TARGET_LENGTH_M * S) / maxDim);

    if (this.ctx.kitchenModel) {
      this.ctx.kitchenModel.add(food);
    } else {
      this.ctx.scene.add(food);
    }
    food.updateMatrixWorld(true);

    this.food = food;
    this.anchor = this.computeAnchor(servingSetRoot);
  }

  /** Dipanggil sekali saat minigame memasak berhasil. Idempotent. */
  public markReady(): void {
    if (this.state === 'served') return;
    this.state = 'readyToServe';
  }

  /**
   * Meletakkan wortel rebus di piring. Mengembalikan false bila makanan belum
   * siap (belum dimasak) atau asset gagal dimuat; InteractionSystem memakai nilai
   * ini agar tidak ada feedback palsu.
   */
  public serve(): boolean {
    if (this.state !== 'readyToServe') return false;
    if (!this.food || !this.anchor) return false;

    const food = this.food;
    const anchor = this.anchor;

    // Rotasi hasil layFlat() dipertahankan; hanya posisi yang dihitung ulang.
    food.position.set(0, 0, 0);
    food.updateMatrixWorld(true);

    // Yang diposisikan adalah KOTAK SELUBUNG (AABB), bukan origin model.
    // carrot.glb punya origin di luar pusat badannya, jadi menempelkan min.y
    // saja membuat wortel meleset dari tengah piring. Karena itu pusat AABB
    // ditahan di tengah piring dan min.y ditempelkan ke permukaan piring.
    const box = new THREE.Box3().setFromObject(food);
    const center = new THREE.Vector3();
    box.getCenter(center);
    food.position.set(anchor.x - center.x, anchor.y - box.min.y, anchor.z - center.z);

    food.updateMatrixWorld(true);
    food.visible = true;

    this.state = 'served';
    this.events.onServed?.();
    return true;
  }

  /**
   * Anchor diambil dari mesh piring dalam koordinat dunia. Dish berada di dalam
   * objectTableware yang sudah diputar 90 derajat, jadi world matrix wajib
   * di-refresh sebelum Box3 dihitung.
   */
  private computeAnchor(servingSetRoot: THREE.Object3D): FoodAnchor | null {
    const dish = servingSetRoot.getObjectByName(DISH_NAME);
    if (dish) {
      dish.updateWorldMatrix(true, true);
      const dishBox = new THREE.Box3().setFromObject(dish);
      if (Number.isFinite(dishBox.min.x) && Number.isFinite(dishBox.max.y)) {
        const center = new THREE.Vector3();
        dishBox.getCenter(center);
        return { x: center.x, y: dishBox.max.y, z: center.z };
      }
    }

    // Fallback: permukaan meja saji dari InteractiveObject yang didaftarkan
    // loadServingSet(). Bergeser hanya jika mesh piring hilang dari asset.
    const table = this.ctx.interactiveObjects.find((o) => o.name === SERVING_TABLE_NAME);
    if (table) {
      return { x: table.center.x, y: table.surfaceY, z: table.center.z };
    }
    return null;
  }

  /**
   * Rebahkan wortel agar duduk rata di piring.
   *
   * carrot.glb memutar modelnya sendiri lewat node "Sketchfab_model" (rotasi
   * baking dari Sketchfab), sehingga tanpa koreksi wortel mendatang miring dan
   * menjulang jauh di atas piring. Sumbu lokal diurutkan dari bounding box
   * geometri asli: yang terpanjang dipetakan ke world X (panjang horizontal),
   * yang terpendek ke world Y (tebal ke atas), sisanya ke world Z. Hasilnya
   * wortel rebah dengan tinggi ~0.053 m di atas piring, bukan ~0.135 m.
   */
  private layFlat(root: THREE.Object3D): void {
    let mesh: THREE.Mesh | null = null;
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) mesh = child as THREE.Mesh;
    });
    if (!mesh) return;

    const geometry = (mesh as THREE.Mesh).geometry;
    geometry.computeBoundingBox();
    const geometrySize = new THREE.Vector3();
    (geometry.boundingBox as THREE.Box3).getSize(geometrySize);

    const ranked = [
      { axis: 0, size: geometrySize.x },
      { axis: 1, size: geometrySize.y },
      { axis: 2, size: geometrySize.z },
    ].sort((a, b) => b.size - a.size);

    const lengthAxis = ranked[0].axis;
    const thinAxis = ranked[2].axis;
    const thirdAxis = ranked[1].axis;

    const current = new THREE.Matrix4().extractRotation((mesh as THREE.Mesh).matrixWorld);

    const target = new Array<THREE.Vector3>(3);
    target[lengthAxis] = new THREE.Vector3(1, 0, 0);
    target[thinAxis] = new THREE.Vector3(0, 1, 0);
    target[thirdAxis] = new THREE.Vector3(0, 0, 1);
    let targetRotation = new THREE.Matrix4().makeBasis(target[0], target[1], target[2]);

    // Setelah daun dibuang, bbox badan wortel simetris di dua sumbu pendek,
    // sehingga urutan sumbu bisa menghasilkan basis dengan determinan -1
    // (refleksi, bukan rotasi). setFromRotationMatrix tidak bisa membaca
    // matriks refleksi, dan hasilnya wortel tegak menyamping. Membalik satu
    // sumbu restores determinan +1 tanpa mengubah panjang/tebal yang diukur.
    if (targetRotation.determinant() < 0) {
      target[thirdAxis].negate();
      targetRotation = new THREE.Matrix4().makeBasis(target[0], target[1], target[2]);
    }

    const correction = targetRotation.multiply(current.clone().invert());
    root.quaternion.setFromRotationMatrix(correction);
  }

  /**
   * Buang bagian daun pada instance makanan ini saja.
   *
   * carrot.glb tidak punya mesh daun terpisah: seluruh wortel beserta daunnya
   * adalah satu mesh ("Object_2", 160 triangel, satu material, tanpa groups).
   * Daun bisa dilepas karena blade-nya membentuk shell terpisah yang menjulang
   * jauh keluar dari radius badan wortel:
   *   - shell badan : 1-2 triangel, radius maksimal 36,1  (72 triangel total)
   *   - shell daun  : 22 triangel, radius sampai 104,6      (4 blade, 88 triangel)
   * Pemisahan ini diverifikasi silang dengan membelah geometri berdasarkan
   * separuh atlas UV (badan v<=0,48, daun v>=0,55) dan hasilnya identik.
   *
   * Vertex yang jadi tidak terpakai ikut dibuang, bukan hanya triangelnya.
   * Wajib: computeBoundingBox() dan Box3.setFromObject() di three.js membaca
   * atribut position, bukan index. Kalau position masih menyimpan daun,
   * AABB tetap tercemar dan layFlat() serta perhitungan skala ikut salah.
   *
   * Mesh diberi BufferGeometry BARU, sehingga geometri asli tidak tersentuh
   * dan wortel di sistem lain (mis. CLEAN_CARROT) tetap utuh.
   */
  private stripLeaves(root: THREE.Object3D): void {
    let target: THREE.Mesh | null = null;
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) target = child as THREE.Mesh;
    });
    if (!target) return;

    const mesh = target as THREE.Mesh;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    if (!position || !index) return;

    const triangleCount = Math.floor(index.count / 3);

    // Segitungan yang berbagi vertex membentuk satu shell.
    const vertexTriangles = new Map<number, number[]>();
    for (let t = 0; t < triangleCount; t++) {
      for (let k = 0; k < 3; k++) {
        const v = index.getX(t * 3 + k);
        const list = vertexTriangles.get(v);
        if (list) list.push(t);
        else vertexTriangles.set(v, [t]);
      }
    }

    const component = new Int32Array(triangleCount).fill(-1);
    const componentMaxRadius: number[] = [];
    const stack: number[] = [];
    for (let seed = 0; seed < triangleCount; seed++) {
      if (component[seed] !== -1) continue;
      const id = componentMaxRadius.length;
      let maxRadius = 0;
      stack.length = 0;
      stack.push(seed);
      component[seed] = id;
      while (stack.length) {
        const t = stack.pop() as number;
        for (let k = 0; k < 3; k++) {
          const v = index.getX(t * 3 + k);
          maxRadius = Math.max(maxRadius, Math.hypot(position.getX(v), position.getY(v)));
          const neighbours = vertexTriangles.get(v);
          if (!neighbours) continue;
          for (const n of neighbours) {
            if (component[n] === -1) {
              component[n] = id;
              stack.push(n);
            }
          }
        }
      }
      componentMaxRadius.push(maxRadius);
    }

    const isBody = new Uint8Array(triangleCount);
    let keptTriangles = 0;
    for (let t = 0; t < triangleCount; t++) {
      isBody[t] = componentMaxRadius[component[t]] <= LEAF_BODY_RADIUS ? 1 : 0;
      keptTriangles += isBody[t];
    }
    if (keptTriangles === triangleCount) return;

    // Bangun geometri baru hanya dari segitungan badan, lalu padatkan vertex.
    const remap = new Map<number, number>();
    const keptSource: number[] = [];
    const keptIndex: number[] = [];
    for (let t = 0; t < triangleCount; t++) {
      if (!isBody[t]) continue;
      for (let k = 0; k < 3; k++) {
        const v = index.getX(t * 3 + k);
        let mapped = remap.get(v);
        if (mapped === undefined) {
          mapped = keptSource.length;
          remap.set(v, mapped);
          keptSource.push(v);
        }
        keptIndex.push(mapped);
      }
    }

    const stripped = new THREE.BufferGeometry();
    for (const [name, source] of Object.entries(geometry.attributes)) {
      const values = new Float32Array(keptSource.length * source.itemSize);
      for (let nv = 0; nv < keptSource.length; nv++) {
        const v = keptSource[nv];
        for (let c = 0; c < source.itemSize; c++) {
          values[nv * source.itemSize + c] = source.getComponent(v, c);
        }
      }
      const attribute = new THREE.BufferAttribute(values, source.itemSize);
      attribute.normalized = source.normalized;
      stripped.setAttribute(name, attribute);
    }
    stripped.setIndex(keptIndex);
    stripped.computeBoundingBox();
    stripped.computeBoundingSphere();
    mesh.geometry = stripped;
  }

  /** Klon material lalu tint oranye supaya hidangan tidak identik dengan wortel mentah. */
  private tintCooked(mesh: THREE.Mesh): void {
    const material = mesh.material;
    if (Array.isArray(material)) {
      mesh.material = material.map((entry) => {
        const clone = entry.clone() as THREE.MeshStandardMaterial;
        clone.color.setHex(COOKED_CARROT_COLOR);
        return clone;
      });
      return;
    }
    const clone = material.clone() as THREE.MeshStandardMaterial;
    clone.color.setHex(COOKED_CARROT_COLOR);
    mesh.material = clone;
  }
}