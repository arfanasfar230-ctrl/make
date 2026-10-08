import * as THREE from 'three';
import type { SceneContext, PlayerState, ControlInput } from './types';
import { FridgeInteractionSystem, FridgeDoorState } from './FridgeInteractionSystem';
import { CarrotCleaner } from './CarrotCleaner';
import { StoveFireMinigame } from './StoveFireMinigame';
import { WindowSystem } from './WindowSystem';
import { ServingSystem } from './ServingSystem';

export type ErgonomicStep =
  | 'FRIDGE'
  | 'TAKE_CARROT'
  | 'CLEAN_CARROT'
  | 'WINDOW'
  | 'STOVE'
  | 'SERVE'
  | 'FINISHED';

/** Lima aktivitas yang dinilai, masing-masing punya pengukuran sendiri. */
export type ActivityKey = 'KULKAS' | 'CUCI' | 'JENDELA' | 'MASAK' | 'SAJIKAN';

/** Urutan tampil di panel; juga urutan penilaian. */
export const ACTIVITY_ORDER: ActivityKey[] = ['KULKAS', 'CUCI', 'JENDELA', 'MASAK', 'SAJIKAN'];

/**
 * Parameter ergonomis satu aktivitas. Semua jarak dalam METER nyata.
 *
 * - `min` / `max`  : rentang ergonomis (skor 90 di kedua ujungnya)
 * - `ideal`        : titik ideal / rata-rata (skor 100)
 * - `mepet`        : jarak yang dianggap "sangat dekat / mepet" (skor 85)
 * - `nearZero`     : deviasi tambahan di sisi dekat sebelum skor mencapai 0
 * - `farZero`      : deviasi tambahan di sisi jauh sebelum skor mencapai 0
 */
export interface ActivityRange {
  min: number;
  max: number;
  ideal: number;
  mepet: number;
  nearZero: number;
  farZero: number;
}

export interface ActivitySpec {
  key: ActivityKey;
  label: string;
  /** Nama ringkas untuk tabel rincian di modal hasil (panel live pakai `label`). */
  shortLabel: string;
  range: ActivityRange;
}

const ACTIVITY_SPECS: Record<ActivityKey, ActivitySpec> = {
  KULKAS: {
    key: 'KULKAS',
    label: 'Mengambil Bahan dari Kulkas',
    shortLabel: 'Kulkas',
    range: { min: 0.7, max: 1.0, ideal: 0.85, mepet: 0.5, nearZero: 0.45, farZero: 0.8 },
  },
  CUCI: {
    key: 'CUCI',
    label: 'Mencuci Wortel',
    shortLabel: 'Mencuci Wortel',
    range: { min: 0.5, max: 0.7, ideal: 0.6, mepet: 0.4, nearZero: 0.45, farZero: 0.8 },
  },
  JENDELA: {
    key: 'JENDELA',
    label: 'Membuka Jendela',
    shortLabel: 'Membuka Jendela',
    range: { min: 0.6, max: 0.8, ideal: 0.7, mepet: 0.45, nearZero: 0.45, farZero: 0.8 },
  },
  MASAK: {
    key: 'MASAK',
    label: 'Memasak',
    shortLabel: 'Memasak',
    range: { min: 0.5, max: 0.7, ideal: 0.6, mepet: 0.4, nearZero: 0.45, farZero: 0.8 },
  },
  SAJIKAN: {
    key: 'SAJIKAN',
    label: 'Menyajikan',
    shortLabel: 'Menyajikan',
    range: { min: 0.5, max: 0.6, ideal: 0.55, mepet: 0.4, nearZero: 0.45, farZero: 0.6 },
  },
};

/**
 * Step mana yang memakai aktivitas mana. `TAKE_CARROT` mengikuti KULKAS (tetap
 * di stepOrder agar mekanik tidak berubah) tapi tidak punya baris sendiri di
 * panel karena tidak ada pengukuran terpisah.
 */
const STEP_ACTIVITY: Record<ErgonomicStep, ActivityKey | null> = {
  FRIDGE: 'KULKAS',
  TAKE_CARROT: 'KULKAS',
  CLEAN_CARROT: 'CUCI',
  WINDOW: 'JENDELA',
  STOVE: 'MASAK',
  SERVE: 'SAJIKAN',
  FINISHED: null,
};

/** Nama node jendela yang jadi titik ukur + penentu tahap WINDOW selesai. */
export const WINDOW_TARGET_KEY = 'jendela_g1';

export interface ErgonomicAssessmentConfig {
  ranges: Record<ActivityKey, ActivityRange>;
  /** Pengurang kecil bila pintu kulkas menabrak pemain (sisi KULKAS saja). */
  fridgeDoorCollisionPenalty: number;
}

const DEFAULT_CONFIG: ErgonomicAssessmentConfig = {
  ranges: {
    KULKAS: ACTIVITY_SPECS.KULKAS.range,
    CUCI: ACTIVITY_SPECS.CUCI.range,
    JENDELA: ACTIVITY_SPECS.JENDELA.range,
    MASAK: ACTIVITY_SPECS.MASAK.range,
    SAJIKAN: ACTIVITY_SPECS.SAJIKAN.range,
  },
  fridgeDoorCollisionPenalty: 0,
};

/** Skor pada titik ideal, batas rentang, dan posisi sangat mepet. */
const IDEAL_SCORE = 100;
const EDGE_SCORE = 90;
const MEPET_SCORE = 85;

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Kurva mulus dengan turunan kontinu di kedua ujungnya, jadi skor tidak pernah "melompat". */
function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(IDEAL_SCORE, value));
}

/**
 * Interpolasi antar-knot [deviasi, skor] yang sudah terurut menaik. Tiap
 * segmen memakai smoothstep sehingga sambungan antar-segmen tetap mulus.
 * Deviasi di luar knot terakhir memakai nilai knot terakhir (skor 0).
 */
function interpolateKnots(knots: [number, number][], deviation: number): number {
  const d = Math.max(0, deviation);
  for (let i = 0; i < knots.length - 1; i++) {
    const [d0, s0] = knots[i];
    const [d1, s1] = knots[i + 1];
    if (d <= d1) {
      const span = d1 - d0;
      const t = span > 1e-9 ? (d - d0) / span : 1;
      return s0 + (s1 - s0) * smoothstep(t);
    }
  }
  return knots[knots.length - 1][1];
}

/**
 * Skor ergonomi dari "distance from ideal distance" — bukan sekadar cek
 * rentang/tidak. Deviasi nol dari `ideal` = 100, deviasi sejauh batas rentang
 * (`min` atau `max`) = 90, posisi sangat mepet (`mepet`) = 85, lalu turun
 * proporsional sampai 0. Tidak pernah ada lompatan 100 -> 0 di batas rentang.
 */
export function scoreActivityDistance(distanceM: number, range: ActivityRange): number {
  if (!Number.isFinite(distanceM)) return 0;

  const half = (Math.max(range.max, range.min) - Math.min(range.max, range.min)) / 2;
  const deviation = distanceM - range.ideal;

  if (deviation >= 0) {
    return Math.round(
      clampScore(
        interpolateKnots(
          [
            [0, IDEAL_SCORE],
            [half, EDGE_SCORE],
            [half + range.farZero, 0],
          ],
          deviation
        )
      )
    );
  }

  const nearGap = Math.max(0, range.min - range.mepet);
  return Math.round(
    clampScore(
      interpolateKnots(
        [
          [0, IDEAL_SCORE],
          [half, EDGE_SCORE],
          [half + nearGap, MEPET_SCORE],
          [half + nearGap + range.nearZero, 0],
        ],
        -deviation
      )
    )
  );
}

export type ActivityRowState = 'pending' | 'live' | 'done';

export interface ActivityScoreRow {
  key: ActivityKey;
  label: string;
  /** Nama ringkas untuk tabel rincian di modal hasil. */
  shortLabel: string;
  state: ActivityRowState;
  /** Skor final saat `done`, skor live saat `live`, null saat `pending`. */
  score: number | null;
  /** Jarak terakhir yang terukur (meter) — dibekukan bersama skor saat `done`. */
  distance: number;
  /** Jarak ideal aktivitas ini (meter), untuk teks panel. */
  ideal: number;
}

export interface ErgonomicAssessmentResult {
  currentStep: ErgonomicStep;
  /** Aktivitas yang sedang diukur; null setelah semua selesai. */
  currentActivity: ActivityKey | null;
  activities: ActivityScoreRow[];
  distance: number;
  distanceStatus: 'tooClose' | 'ergonomic' | 'tooFar';
  activity: string;
  objectStatus: string;
  activityStatus: 'Selesai' | 'Berlangsung';
  completedCount: number;
  totalCount: number;
  /** Rata-rata 5 skor; null sampai kelima aktivitas selesai. */
  finalScore: number | null;
  finished: boolean;
}

export class ErgonomicAssessmentSystem {
  private ctx: SceneContext;
  private config: ErgonomicAssessmentConfig;

  private fridgeInteraction: FridgeInteractionSystem | null = null;
  private carrotCleaner: CarrotCleaner | null = null;
  private stoveFireMinigame: StoveFireMinigame | null = null;
  private windowSystem: WindowSystem | null = null;
  private servingSystem: ServingSystem | null = null;

  private currentStep: ErgonomicStep = 'FRIDGE';
  private finished = false;

  private stepOrder: ErgonomicStep[] = ['FRIDGE', 'TAKE_CARROT', 'CLEAN_CARROT', 'WINDOW', 'STOVE', 'SERVE'];

  /** Step yang sudah lewat, supaya tidak pernah maju dua kali. */
  private completedSteps: Set<ErgonomicStep> = new Set();

  /**
   * Skor per aktivitas. `null` = belum selesai (TIDAK memakai skor aktivitas
   * lain). Sekali terisi tidak pernah berubah lagi.
   */
  private activityScores: Record<ActivityKey, number | null> = {
    KULKAS: null,
    CUCI: null,
    JENDELA: null,
    MASAK: null,
    SAJIKAN: null,
  };

  /** Jarak terakhir per aktivitas, ditulis hanya selama aktivitas itu live. */
  private activityDistance: Record<ActivityKey, number> = {
    KULKAS: 0,
    CUCI: 0,
    JENDELA: 0,
    MASAK: 0,
    SAJIKAN: 0,
  };

  private finalScore: number | null = null;

  /** Pembacaan live untuk aktivitas yang sedang berjalan. */
  private activeActivity: ActivityKey | null = 'KULKAS';
  private liveDistance = 0;
  private liveScore = 0;

  private lastDistanceStatus: 'tooClose' | 'ergonomic' | 'tooFar' = 'ergonomic';
  private lastActivity = '';
  private lastObjectStatus = '';
  private lastActivityStatus: 'Selesai' | 'Berlangsung' = 'Berlangsung';

  /** Box3 statis untuk target yang tidak terdaftar di ctx.interactiveObjects (jendela). */
  private extraTargets: Map<string, THREE.Box3> = new Map();

  private fridgeDoorOpened = false;
  private fridgeDoorClosed = false;
  private fridgeCollisionHit = false;
  private carrotCleanCompleted = false;
  private windowOpened = false;
  private stoveMinigameCompleted = false;
  private foodServed = false;
  private faucetOn = false;

  private panel: HTMLElement | null = null;
  private onResultChange: ((result: ErgonomicAssessmentResult) => void) | null = null;

  constructor(ctx: SceneContext, config?: Partial<ErgonomicAssessmentConfig>) {
    this.ctx = ctx;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      ranges: { ...DEFAULT_CONFIG.ranges, ...(config?.ranges ?? {}) },
    };
  }

  public setDependencies(
    fridgeInteraction: FridgeInteractionSystem,
    carrotCleaner: CarrotCleaner,
    stoveFireMinigame: StoveFireMinigame,
    windowSystem: WindowSystem
  ): void {
    this.fridgeInteraction = fridgeInteraction;
    this.carrotCleaner = carrotCleaner;
    this.stoveFireMinigame = stoveFireMinigame;
    this.windowSystem = windowSystem;
  }

  public setServingSystem(sys: ServingSystem): void {
    this.servingSystem = sys;
  }

  public setOnResultChange(callback: (result: ErgonomicAssessmentResult) => void): void {
    this.onResultChange = callback;
  }

  public setPanel(panel: HTMLElement): void {
    this.panel = panel;
  }

  /**
   * Mendaftarkan target ukur yang tidak ada di ctx.interactiveObjects. Box3
   * dunia diambil SEKALI karena node ini diam (jendela), sehingga computing
   * per frame tidak diperlukan dan jaraknya stabil.
   */
  public registerMeasurementTarget(key: string, node: THREE.Object3D): void {
    node.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(node);
    if (!box.isEmpty()) this.extraTargets.set(key, box);
  }

  public update(delta: number, playerState: PlayerState, input: ControlInput): void {
    if (this.finished) return;

    this.updateLiveDistance(playerState);
    this.updateStepProgress();
    this.updatePanel();
  }

  // ---------------------------------------------------------------------------
  // Pengukuran live
  // ---------------------------------------------------------------------------

  private rangeFor(key: ActivityKey): ActivityRange {
    return this.config.ranges[key];
  }

  private updateLiveDistance(playerState: PlayerState): void {
    const key = STEP_ACTIVITY[this.currentStep];
    this.activeActivity = key;

    if (!key) {
      this.liveDistance = 0;
      return;
    }

    const box = this.resolveTargetBox();
    if (!box) {
      this.liveDistance = 0;
      return;
    }

    this.liveDistance = this.calculateDistance(playerState, box);
    this.liveScore = scoreActivityDistance(this.liveDistance, this.rangeFor(key));
    this.lastDistanceStatus = this.classifyDistance(key, this.liveDistance);

    // Hanya aktivitas yang BELUM terkunci yang boleh memperbarui jaraknya,
    // supaya jarak aktivitas sebelumnya tidak ikut bergeser.
    if (this.activityScores[key] === null) {
      this.activityDistance[key] = this.liveDistance;
    }
  }

  private classifyDistance(key: ActivityKey, distance: number): 'tooClose' | 'ergonomic' | 'tooFar' {
    const range = this.rangeFor(key);
    if (distance < range.min) return 'tooClose';
    if (distance > range.max) return 'tooFar';
    return 'ergonomic';
  }

  private resolveTargetBox(): THREE.Box3 | null {
    switch (this.currentStep) {
      case 'FRIDGE':
      case 'TAKE_CARROT':
        return this.findObjectByName('kulkas')?.boundingBox ?? null;
      case 'CLEAN_CARROT':
        return this.findObjectByInteraction('faucet')?.boundingBox ?? null;
      case 'WINDOW':
        // Selalu ukur jendela_g1: target ini didaftarkan lewat
        // registerMeasurementTarget karena jendela tidak ada di
        // ctx.interactiveObjects. Fallback hanya jika registrasi terlewat.
        return (
          this.extraTargets.get(WINDOW_TARGET_KEY) ??
          this.findObjectByInteraction('window')?.boundingBox ??
          null
        );
      case 'STOVE':
        return this.findObjectByName('kompor')?.boundingBox ?? null;
      case 'SERVE':
        return this.findObjectByName('meja_saji')?.boundingBox ?? null;
      default:
        return null;
    }
  }

  private findObjectByName(name: string) {
    return this.ctx.interactiveObjects.find(o => o.name === name) || null;
  }

  private findObjectByInteraction(interaction: string) {
    return this.ctx.interactiveObjects.find(o => o.object3D.userData?.interaction === interaction) || null;
  }

  /**
   * Jarak (meter) dari posisi player ke titik terdekat pada XZ di Box3 target.
   * Memakai clamp ke kotak supaya perabot panjang tidak dianggap "jauh" hanya
   * karena pemain berdiri di ujungnya.
   */
  private calculateDistance(playerState: PlayerState, box: THREE.Box3): number {
    const cx = THREE.MathUtils.clamp(playerState.position.x, box.min.x, box.max.x);
    const cz = THREE.MathUtils.clamp(playerState.position.z, box.min.z, box.max.z);
    const dx = playerState.position.x - cx;
    const dz = playerState.position.z - cz;
    return Math.sqrt(dx * dx + dz * dz) / this.ctx.sceneScale;
  }

  // ---------------------------------------------------------------------------
  // Penyimpanan skor per aktivitas
  // ---------------------------------------------------------------------------

  /**
   * Mengunci skor satu aktivitas. Idempotent: panggilan berikutnya diabaikan,
   * sehingga skor yang sudah selesai tidak pernah ikut berubah.
   */
  private lockActivity(key: ActivityKey, penalty = 0): void {
    if (this.activityScores[key] !== null) return;

    const base = scoreActivityDistance(this.activityDistance[key], this.rangeFor(key));
    this.activityScores[key] = clampScore(base - penalty);
    this.refreshFinalScore();
  }

  /** Rata-rata kelima skor; tetap null sampai semuanya terisi. */
  private refreshFinalScore(): void {
    const values = ACTIVITY_ORDER.map(key => this.activityScores[key]);
    if (values.some(v => v === null)) {
      this.finalScore = null;
      return;
    }
    const total = values.reduce<number>((sum, v) => sum + (v as number), 0);
    this.finalScore = Math.round(total / ACTIVITY_ORDER.length);
  }

  // ---------------------------------------------------------------------------
  // Progres tiap step (mekanik interaksi yang ada tidak diubah)
  // ---------------------------------------------------------------------------

  private updateStepProgress(): void {
    switch (this.currentStep) {
      case 'FRIDGE':
        this.updateFridgeStep();
        break;
      case 'TAKE_CARROT':
        this.updateTakeCarrotStep();
        break;
      case 'CLEAN_CARROT':
        this.updateCleanCarrotStep();
        break;
      case 'WINDOW':
        this.updateWindowStep();
        break;
      case 'STOVE':
        this.updateStoveStep();
        break;
      case 'SERVE':
        this.updateServeStep();
        break;
      default:
        break;
    }
  }

  private updateFridgeStep(): void {
    if (!this.fridgeInteraction) return;

    const doorState = this.fridgeInteraction.getDoorState();
    const isDoorOpen = doorState === FridgeDoorState.OPEN;
    const isDoorClosed = doorState === FridgeDoorState.CLOSED;

    this.lastActivity = 'Membuka kulkas';
    this.lastObjectStatus = isDoorOpen ? 'Terbuka' : isDoorClosed ? 'Tertutup' : 'Bergerak';
    this.lastActivityStatus = isDoorClosed && this.fridgeDoorOpened ? 'Selesai' : 'Berlangsung';

    if (isDoorOpen && !this.fridgeDoorOpened) {
      this.fridgeDoorOpened = true;
    }

    if (isDoorClosed && this.fridgeDoorOpened && !this.fridgeDoorClosed) {
      this.fridgeDoorClosed = true;
      // Skor kulkas disimpan saat aktivitas kulkas selesai (pintu tertutup).
      this.lockActivity('KULKAS', this.fridgeCollisionHit ? this.config.fridgeDoorCollisionPenalty : 0);
      this.completeStep('FRIDGE');
      this.completeStep('TAKE_CARROT');
    }
  }

  private updateTakeCarrotStep(): void {
    // Step ini tidak punya pengukuran sendiri: memakai aktivitas KULKAS.
    this.lastActivity = 'Mengambil wortel';
    this.lastObjectStatus = 'Kulkas terbuka';
    this.lastActivityStatus = 'Selesai';
    this.completeStep('TAKE_CARROT');
  }

  private updateCleanCarrotStep(): void {
    if (!this.carrotCleaner) return;

    this.lastActivity = 'Mencuci wortel';
    this.lastObjectStatus = this.faucetOn ? 'Kran menyala' : 'Kran mati';
    this.lastActivityStatus = (this.carrotCleanCompleted && !this.faucetOn) ? 'Selesai' : 'Berlangsung';

    if (this.carrotCleanCompleted && this.faucetOn) {
      this.lastObjectStatus = 'Wortel bersih - matikan kran';
    }

    if (this.carrotCleanCompleted && !this.faucetOn) {
      // Skor cuci disimpan saat mencuci wortel selesai.
      this.lockActivity('CUCI');
      this.completeStep('CLEAN_CARROT');
    }
  }

  public setFaucetState(on: boolean): void {
    this.faucetOn = on;
  }

  private updateWindowStep(): void {
    if (!this.windowSystem) return;

    const isOpen = this.windowSystem.isWindowOpen(WINDOW_TARGET_KEY);

    this.lastActivity = 'Membuka jendela';
    this.lastObjectStatus = isOpen ? 'Terbuka' : 'Tertutup';
    this.lastActivityStatus = isOpen ? 'Selesai' : 'Berlangsung';

    if (isOpen && !this.windowOpened) {
      this.windowOpened = true;
      // Skor jendela disimpan saat jendela benar-benar terbuka.
      this.lockActivity('JENDELA');
      this.completeStep('WINDOW');
    }
  }

  private updateStoveStep(): void {
    if (!this.stoveFireMinigame) return;

    const isMinigameOpen = this.stoveFireMinigame.isOpened();

    this.lastActivity = 'Memasak wortel';
    this.lastObjectStatus = isMinigameOpen ? 'Minigame berjalan' : 'Siap memasak';
    this.lastActivityStatus = this.stoveMinigameCompleted ? 'Selesai' : 'Berlangsung';

    if (this.stoveMinigameCompleted) {
      // Minigame memasak tidak diubah; cukup dikunci di sini.
      this.lockActivity('MASAK');
      this.completeStep('STOVE');
    }
  }

  private updateServeStep(): void {
    const isReady = this.servingSystem?.isReadyToServe() ?? false;

    this.lastActivity = 'Menghidangkan wortel rebus';
    this.lastObjectStatus = this.foodServed
      ? 'Terhidang di meja saji'
      : isReady
        ? 'Siap dihidangkan'
        : 'Belum matang';
    this.lastActivityStatus = this.foodServed ? 'Selesai' : 'Berlangsung';

    if (this.foodServed) {
      this.lockActivity('SAJIKAN');
      this.completeStep('SERVE');
    }
  }

  public completeFridgeAssessment(): void {
    if (this.currentStep !== 'FRIDGE') return;
    this.lockActivity('KULKAS', this.fridgeCollisionHit ? this.config.fridgeDoorCollisionPenalty : 0);
    this.completeStep('FRIDGE');
    this.completeStep('TAKE_CARROT');
  }

  public completeCarrotCleaningAssessment(): void {
    if (this.currentStep !== 'CLEAN_CARROT') return;
    this.lockActivity('CUCI');
    this.completeStep('CLEAN_CARROT');
  }

  public completeWindowAssessment(): void {
    if (this.currentStep !== 'WINDOW') return;
    this.lockActivity('JENDELA');
    this.completeStep('WINDOW');
  }

  public completeStoveAssessment(): void {
    if (this.currentStep !== 'STOVE') return;
    this.lockActivity('MASAK');
    this.completeStep('STOVE');
  }

  public completeServeAssessment(): void {
    if (this.currentStep !== 'SERVE') return;
    this.lockActivity('SAJIKAN');
    this.completeStep('SERVE');
  }

  public onCarrotCleanComplete(): void {
    this.carrotCleanCompleted = true;
  }

  public onStoveMinigameComplete(): void {
    this.stoveMinigameCompleted = true;
    // Dikunci langsung di callback supaya skor memakai jarak saat minigame
    // selesai, bukan frame berikutnya.
    this.lockActivity('MASAK');
  }

  /** Dipanggil ServingSystem tepat saat wortel rebus diletakkan di meja saji. */
  public onFoodServed(): void {
    this.foodServed = true;
    // Skor disajikan diukur dari jarak pada frame klik ini juga: update()
    // ErgonomicAssessmentSystem jalan lebih dulu dalam satu frame, jadi
    // liveDistance sudah sesuai posisi player saat klik.
    this.lockActivity('SAJIKAN');
  }

  public onFridgeDoorCollision(): void {
    this.fridgeCollisionHit = true;
  }

  private completeStep(step: ErgonomicStep): void {
    if (this.completedSteps.has(step)) return;
    this.completedSteps.add(step);

    const currentIndex = this.stepOrder.indexOf(step);
    if (currentIndex === -1) return;

    if (currentIndex + 1 < this.stepOrder.length) {
      this.currentStep = this.stepOrder[currentIndex + 1];
    } else {
      this.currentStep = 'FINISHED';
      this.finished = true;
      this.activeActivity = null;
    }

    this.resetStepFlags();
  }

  private resetStepFlags(): void {
    this.fridgeDoorOpened = false;
    this.fridgeDoorClosed = false;
    this.carrotCleanCompleted = false;
    this.windowOpened = false;
    this.stoveMinigameCompleted = false;
    this.foodServed = false;
    this.faucetOn = false;
  }

  public canInteract(objectType: 'fridge' | 'faucet' | 'window' | 'stove' | 'serving_table'): boolean {
    if (this.finished) return false;

    const requiredStepMap: Record<string, ErgonomicStep> = {
      fridge: 'FRIDGE',
      faucet: 'CLEAN_CARROT',
      window: 'WINDOW',
      stove: 'STOVE',
      serving_table: 'SERVE',
    };

    return this.currentStep === requiredStepMap[objectType];
  }

  public getResult(): ErgonomicAssessmentResult {
    const activities: ActivityScoreRow[] = ACTIVITY_ORDER.map(key => {
      const locked = this.activityScores[key];
      const isLive = this.activeActivity === key && locked === null && !this.finished;
      return {
        key,
        label: ACTIVITY_SPECS[key].label,
        shortLabel: ACTIVITY_SPECS[key].shortLabel,
        state: locked !== null ? 'done' : isLive ? 'live' : 'pending',
        score: locked !== null ? locked : isLive ? this.liveScore : null,
        distance: this.activityDistance[key],
        ideal: this.rangeFor(key).ideal,
      };
    });

    return {
      currentStep: this.currentStep,
      currentActivity: this.activeActivity,
      activities,
      distance: this.liveDistance,
      distanceStatus: this.lastDistanceStatus,
      activity: this.lastActivity,
      objectStatus: this.lastObjectStatus,
      activityStatus: this.lastActivityStatus,
      completedCount: ACTIVITY_ORDER.filter(key => this.activityScores[key] !== null).length,
      totalCount: ACTIVITY_ORDER.length,
      finalScore: this.finalScore,
      finished: this.finished,
    };
  }

  public reset(): void {
    this.currentStep = 'FRIDGE';
    this.finished = false;
    this.finalScore = null;
    this.activeActivity = 'KULKAS';
    this.liveDistance = 0;
    this.liveScore = 0;
    this.lastDistanceStatus = 'ergonomic';
    this.lastActivity = '';
    this.lastObjectStatus = '';
    this.lastActivityStatus = 'Berlangsung';
    this.fridgeCollisionHit = false;
    this.completedSteps.clear();
    this.resetStepFlags();

    for (const key of ACTIVITY_ORDER) {
      this.activityScores[key] = null;
      this.activityDistance[key] = 0;
    }
  }

  private updatePanel(): void {
    if (!this.panel || !this.onResultChange) return;
    this.onResultChange(this.getResult());
  }
}

// -----------------------------------------------------------------------------
// Panel
// -----------------------------------------------------------------------------

export function scoreColor(score: number): string {
  if (score >= 80) return '#4caf50';
  if (score >= 50) return '#ff9800';
  return '#f44336';
}

export function createErgonomicAssessmentPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'ergonomic-assessment-inner';
  panel.style.cssText = `
    position: fixed;
    right: 16px;
    top: 80px;
    width: 300px;
    background: rgba(15, 20, 40, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 16px;
    z-index: 50;
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: #e0e0e0;
    pointer-events: auto;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
  `;

  const rows = ACTIVITY_ORDER.map((key, index) => {
    const spec = ACTIVITY_SPECS[key];
    const range = spec.range;
    return `
      <div class="ergo-row" data-activity="${key}" data-state="pending">
        <div class="ergo-row-top">
          <span class="ergo-row-name">${index + 1}. ${spec.label}</span>
          <span class="ergo-row-score">—</span>
        </div>
        <div class="ergo-row-bottom">
          <span class="ergo-row-state">Belum dikerjakan</span>
          <span class="ergo-row-distance">ideal ${range.ideal.toFixed(2)} m</span>
        </div>
        <div class="ergo-row-bar"><div class="ergo-row-fill" style="width:0%;"></div></div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1);">
      <h3 style="font-size:0.8rem;font-weight:700;letter-spacing:0.06em;color:#e94560;text-transform:uppercase;margin:0;">Penilaian Ergonomi</h3>
      <span style="font-size:0.65rem;opacity:0.5;">jarak live per aktivitas</span>
    </div>

    <div class="ergo-live" data-state="idle">
      <div class="ergo-live-head">
        <span class="ergo-live-name">Menunggu aktivitas</span>
        <span class="ergo-live-badge">LIVE</span>
      </div>
      <div class="ergo-live-metrics">
        <div class="ergo-metric">
          <span class="ergo-metric-label">Jarak</span>
          <span class="ergo-metric-value" data-field="distance">0.00 m</span>
        </div>
        <div class="ergo-metric">
          <span class="ergo-metric-label">Skor</span>
          <span class="ergo-metric-value" data-field="live-score">—</span>
        </div>
      </div>
      <div class="ergo-live-status" data-field="status">·</div>
      <div class="ergo-live-object" data-field="object">—</div>
    </div>

    <div class="ergo-list">${rows}</div>

    <div class="ergo-preview">
      <button type="button" class="ergo-preview-btn" data-field="preview" disabled>
        LIHAT NILAI AKHIR
      </button>
      <p class="ergo-preview-note" data-field="preview-note">Selesaikan kelima aktivitas untuk melihat hasil penilaian.</p>
    </div>

    <div class="ergo-progress">Aktivitas selesai: <span data-field="progress">0 / 5</span></div>
  `;

  // Gaya dasar ditulis lewat <style> sekali saja supaya innerHTML tetap ringkas.
  const style = document.createElement('style');
  style.textContent = `
    #ergonomic-assessment-inner .ergo-live {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 12px;
    }
    #ergonomic-assessment-inner {
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
      touch-action: pan-y;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.25) transparent;
    }
    #ergonomic-assessment-inner::-webkit-scrollbar {
      width: 8px;
    }
    #ergonomic-assessment-inner::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.3);
      border-radius: 8px;
    }
    #ergonomic-assessment-inner::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.5);
    }
    #ergonomic-assessment-inner .ergo-live[data-state="live"] {
      border-color: rgba(76,175,80,0.5);
      box-shadow: 0 0 0 1px rgba(76,175,80,0.15) inset;
    }
    #ergonomic-assessment-inner .ergo-live-head {
      display: flex; justify-content: space-between; align-items: center; gap: 8px;
    }
    #ergonomic-assessment-inner .ergo-live-name {
      font-size: 0.8rem; font-weight: 600; color: #e0e0e0;
    }
    #ergonomic-assessment-inner .ergo-live-badge {
      font-size: 0.55rem; font-weight: 700; letter-spacing: 0.08em;
      color: #4caf50; border: 1px solid rgba(76,175,80,0.4);
      border-radius: 4px; padding: 1px 5px; display: none;
    }
    #ergonomic-assessment-inner .ergo-live[data-state="live"] .ergo-live-badge { display: block; }
    #ergonomic-assessment-inner .ergo-live-metrics {
      display: flex; gap: 12px; margin-top: 8px;
    }
    #ergonomic-assessment-inner .ergo-metric { flex: 1; }
    #ergonomic-assessment-inner .ergo-metric-label {
      display: block; font-size: 0.6rem; text-transform: uppercase; opacity: 0.5;
    }
    #ergonomic-assessment-inner .ergo-metric-value {
      display: block; font-size: 1.15rem; font-weight: 700; margin-top: 2px;
    }
    #ergonomic-assessment-inner .ergo-live-status {
      margin-top: 8px; font-size: 0.72rem; font-weight: 600;
    }
    #ergonomic-assessment-inner .ergo-live-object {
      margin-top: 2px; font-size: 0.7rem; opacity: 0.55;
    }

    #ergonomic-assessment-inner .ergo-list { display: flex; flex-direction: column; gap: 6px; }
    #ergonomic-assessment-inner .ergo-row {
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px; padding: 8px 10px;
      background: rgba(255,255,255,0.02);
    }
    #ergonomic-assessment-inner .ergo-row[data-state="live"] {
      border-color: rgba(76,175,80,0.45);
      background: rgba(76,175,80,0.06);
    }
    #ergonomic-assessment-inner .ergo-row[data-state="done"] {
      border-color: rgba(76,175,80,0.25);
    }
    #ergonomic-assessment-inner .ergo-row[data-state="pending"] { opacity: 0.45; }
    #ergonomic-assessment-inner .ergo-row-top {
      display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
    }
    #ergonomic-assessment-inner .ergo-row-name {
      font-size: 0.74rem; font-weight: 600;
    }
    #ergonomic-assessment-inner .ergo-row-score {
      font-size: 0.95rem; font-weight: 700; font-variant-numeric: tabular-nums;
    }
    #ergonomic-assessment-inner .ergo-row-bottom {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: 8px; margin-top: 3px;
    }
    #ergonomic-assessment-inner .ergo-row-state {
      font-size: 0.62rem; opacity: 0.7;
    }
    #ergonomic-assessment-inner .ergo-row-distance {
      font-size: 0.62rem; opacity: 0.6; font-variant-numeric: tabular-nums;
    }
    #ergonomic-assessment-inner .ergo-row-bar {
      height: 3px; border-radius: 2px; background: rgba(255,255,255,0.08);
      margin-top: 6px; overflow: hidden;
    }
    #ergonomic-assessment-inner .ergo-row-fill {
      height: 100%; border-radius: 2px; transition: width 0.08s linear;
    }

    #ergonomic-assessment-inner .ergo-preview {
      margin-top: 14px;
    }
    #ergonomic-assessment-inner .ergo-preview-btn {
      /* Panel memakai pointer-events:none supaya tidak menghalangi gameplay,
         jadi tombol ini harus mengambil kliknya kembali. */
      pointer-events: auto;
      width: 100%;
      min-height: 48px;
      padding: 11px 12px;
      border-radius: 10px;
      border: 1px solid rgba(233,69,96,0.35);
      background: rgba(233,69,96,0.08);
      color: rgba(224,224,224,0.45);
      font-family: inherit;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      cursor: not-allowed;
      transition: background 0.2s, color 0.2s, border-color 0.2s, box-shadow 0.2s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    #ergonomic-assessment-inner .ergo-preview-btn:disabled {
      opacity: 0.75;
    }
    #ergonomic-assessment-inner .ergo-preview-btn[data-ready="true"] {
      background: #e94560;
      border-color: #e94560;
      color: #fff;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(233,69,96,0.35);
    }
    #ergonomic-assessment-inner .ergo-preview-btn[data-ready="true"]:hover {
      background: #d63851;
      border-color: #d63851;
    }
    #ergonomic-assessment-inner .ergo-preview-btn[data-ready="true"]:active {
      transform: translateY(1px);
    }
    #ergonomic-assessment-inner .ergo-preview-note {
      margin: 6px 0 0;
      font-size: 0.62rem;
      line-height: 1.4;
      opacity: 0.55;
      text-align: center;
    }
    #ergonomic-assessment-inner .ergo-progress {
      margin-top: 12px; padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.05);
      font-size: 0.68rem; opacity: 0.6;
    }

    /* Responsive: tablet */
    @media (max-width: 768px) {
      #ergonomic-assessment-inner .ergo-live { padding: 8px 10px; }
      #ergonomic-assessment-inner .ergo-live-name { font-size: 0.75rem; }
      #ergonomic-assessment-inner .ergo-metric-value { font-size: 1rem; }
      #ergonomic-assessment-inner .ergo-row { padding: 7px 8px; }
      #ergonomic-assessment-inner .ergo-row-name { font-size: 0.7rem; }
      #ergonomic-assessment-inner .ergo-row-score { font-size: 0.85rem; }
      #ergonomic-assessment-inner .ergo-row-state,
      #ergonomic-assessment-inner .ergo-row-distance { font-size: 0.58rem; }
      #ergonomic-assessment-inner .ergo-preview-btn {
        min-height: 44px;
        font-size: 0.75rem;
      }
      #ergonomic-assessment-inner .ergo-preview-note { font-size: 0.58rem; }
      #ergonomic-assessment-inner .ergo-progress { font-size: 0.62rem; }
    }

    /* Responsive: mobile */
    @media (max-width: 520px) {
      #ergonomic-assessment-inner .ergo-live { padding: 8px 8px; }
      #ergonomic-assessment-inner .ergo-live-metrics { gap: 8px; }
      #ergonomic-assessment-inner .ergo-metric-value { font-size: 0.95rem; }
      #ergonomic-assessment-inner .ergo-row { padding: 6px 8px; }
      #ergonomic-assessment-inner .ergo-row-name { font-size: 0.68rem; }
      #ergonomic-assessment-inner .ergo-row-score { font-size: 0.8rem; }
      #ergonomic-assessment-inner .ergo-row-bottom { gap: 6px; }
      #ergonomic-assessment-inner .ergo-row-state,
      #ergonomic-assessment-inner .ergo-row-distance { font-size: 0.55rem; }
      #ergonomic-assessment-inner .ergo-preview-btn {
        min-height: 50px;
        font-size: 0.85rem;
      }
      #ergonomic-assessment-inner .ergo-preview-note { font-size: 0.55rem; }
    }

    /* Very small screens */
    @media (max-width: 360px) {
      #ergonomic-assessment-inner .ergo-live-name { font-size: 0.7rem; }
      #ergonomic-assessment-inner .ergo-metric-value { font-size: 0.85rem; }
      #ergonomic-assessment-inner .ergo-row-name { font-size: 0.62rem; }
      #ergonomic-assessment-inner .ergo-row-score { font-size: 0.75rem; }
      #ergonomic-assessment-inner .ergo-preview-btn { min-height: 46px; font-size: 0.8rem; }
    }
  `;
  document.head.appendChild(style);

  return panel;
}
