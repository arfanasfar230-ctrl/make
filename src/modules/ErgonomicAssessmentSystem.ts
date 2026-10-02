import * as THREE from 'three';
import type { SceneContext, InteractiveObject, PlayerState, ControlInput } from './types';
import { FridgeInteractionSystem, FridgeState, FridgeDoorState } from './FridgeInteractionSystem';
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

export interface ErgonomicAssessmentConfig {
  penalty: {
    tooClose: number;
    tooFar: number;
    fridgeDoorCollision: number;
    failedMinigame: number;
  };
  perfectRunThreshold: number;
}

const DEFAULT_CONFIG: ErgonomicAssessmentConfig = {
  penalty: {
    tooClose: 5,
    tooFar: 5,
    fridgeDoorCollision: 10,
    failedMinigame: 10,
  },
  perfectRunThreshold: 100,
};

interface StepState {
  completed: boolean;
  perfect: boolean;
  penaltyApplied: {
    tooClose: boolean;
    tooFar: boolean;
    fridgeDoorCollision: boolean;
  };
}

export interface ErgonomicAssessmentResult {
  currentStep: ErgonomicStep;
  score: number;
  stepProgress: { step: ErgonomicStep; completed: boolean; perfect: boolean }[];
  distance: number;
  distanceStatus: 'tooClose' | 'ergonomic' | 'tooFar';
  activity: string;
  objectStatus: string;
  activityStatus: 'Selesai' | 'Berlangsung';
  perfectRun: boolean;
  finished: boolean;
}

interface StepDistanceRange {
  min: number;
  max: number;
}

const STEP_DISTANCE_RANGES: Record<string, StepDistanceRange> = {
  FRIDGE: { min: 0.7, max: 1.0 },
  TAKE_CARROT: { min: 0.7, max: 1.0 },
  CLEAN_CARROT: { min: 0.5, max: 0.7 },
  WINDOW: { min: 0.6, max: 0.8 },
  STOVE: { min: 0.5, max: 0.7 },
  SERVE: { min: 0.5, max: 0.7 },
};

export class ErgonomicAssessmentSystem {
  private ctx: SceneContext;
  private config: ErgonomicAssessmentConfig;
  private fridgeInteraction: FridgeInteractionSystem | null = null;
  private carrotCleaner: CarrotCleaner | null = null;
  private stoveFireMinigame: StoveFireMinigame | null = null;
  private windowSystem: WindowSystem | null = null;
  private servingSystem: ServingSystem | null = null;

  private currentStep: ErgonomicStep = 'FRIDGE';
  private score = 100;
  private perfectRun = true;
  private finished = false;

  private stepStates: Map<ErgonomicStep, StepState> = new Map();
  private stepOrder: ErgonomicStep[] = ['FRIDGE', 'TAKE_CARROT', 'CLEAN_CARROT', 'WINDOW', 'STOVE', 'SERVE'];

  private lastDistance = 0;
  private lastDistanceStatus: 'tooClose' | 'ergonomic' | 'tooFar' = 'ergonomic';
  private lastActivity = '';
  private lastObjectStatus = '';
  private lastActivityStatus: 'Selesai' | 'Berlangsung' = 'Berlangsung';

  private currentTargetObject: InteractiveObject | null = null;
  private penaltyFlags: Set<string> = new Set();

  private panel: HTMLElement | null = null;
  private onResultChange: ((result: ErgonomicAssessmentResult) => void) | null = null;

  private fridgeDoorOpened = false;
  private fridgeDoorClosed = false;
  private carrotCleanCompleted = false;
  private windowOpened = false;
  private stoveMinigameCompleted = false;
  private foodServed = false;
  private faucetOn = false;

  constructor(ctx: SceneContext, config?: Partial<ErgonomicAssessmentConfig>) {
    this.ctx = ctx;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.stepOrder.forEach(step => {
      this.stepStates.set(step, {
        completed: false,
        perfect: true,
        penaltyApplied: { tooClose: false, tooFar: false, fridgeDoorCollision: false },
      });
    });
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

  public update(delta: number, playerState: PlayerState, input: ControlInput): void {
    if (this.finished) return;

    this.updateTargetObject();
    this.updateDistance(playerState);
    this.updateStepProgress(playerState, input);
    this.updatePanel();
  }

  private updateTargetObject(): void {
    switch (this.currentStep) {
      case 'FRIDGE':
      case 'TAKE_CARROT':
        this.currentTargetObject = this.findObjectByName('kulkas');
        break;
      case 'CLEAN_CARROT':
        this.currentTargetObject = this.findObjectByInteraction('faucet');
        break;
      case 'WINDOW':
        this.currentTargetObject = this.findObjectByInteraction('window');
        break;
      case 'STOVE':
        this.currentTargetObject = this.findObjectByName('kompor');
        break;
      case 'SERVE':
        this.currentTargetObject = this.findObjectByName('meja_saji');
        break;
      default:
        this.currentTargetObject = null;
    }
  }

  private updateDistance(playerState: PlayerState): void {
    if (!this.currentTargetObject) {
      this.lastDistance = 0;
      this.lastDistanceStatus = 'ergonomic';
      return;
    }

    const distance = this.calculateDistance(playerState, this.currentTargetObject);
    this.lastDistance = distance;

    const range = STEP_DISTANCE_RANGES[this.currentStep];
    if (range) {
      if (distance < range.min) {
        this.lastDistanceStatus = 'tooClose';
        this.applyPenalty('tooClose');
      } else if (distance > range.max) {
        this.lastDistanceStatus = 'tooFar';
        this.applyPenalty('tooFar');
      } else {
        this.lastDistanceStatus = 'ergonomic';
        this.clearPenalty('tooClose');
        this.clearPenalty('tooFar');
      }
    }
  }

  private applyPenalty(type: string): void {
    if (this.penaltyFlags.has(type)) return;
    this.penaltyFlags.add(type);

    const penalty = this.config.penalty[type as keyof typeof this.config.penalty];
    if (penalty) {
      this.score = Math.max(0, this.score - penalty);
      this.getCurrentStepState().perfect = false;
      this.perfectRun = false;
    }
  }

  private clearPenalty(type: string): void {
    this.penaltyFlags.delete(type);
  }

  private getCurrentStepState(): StepState {
    return this.stepStates.get(this.currentStep)!;
  }

  private updateStepProgress(playerState: PlayerState, input: ControlInput): void {
    const stepState = this.getCurrentStepState();

    switch (this.currentStep) {
      case 'FRIDGE':
        this.updateFridgeStep(playerState, input, stepState);
        break;
      case 'TAKE_CARROT':
        this.updateTakeCarrotStep(playerState, input, stepState);
        break;
      case 'CLEAN_CARROT':
        this.updateCleanCarrotStep(playerState, input, stepState);
        break;
      case 'WINDOW':
        this.updateWindowStep(playerState, input, stepState);
        break;
      case 'STOVE':
        this.updateStoveStep(playerState, input, stepState);
        break;
      case 'SERVE':
        this.updateServeStep(playerState, input, stepState);
        break;
    }
  }

  private updateFridgeStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
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
      this.completeFridgeAssessment();
    }
  }

  private updateTakeCarrotStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
    this.lastActivity = 'Mengambil wortel';
    this.lastObjectStatus = 'Kulkas terbuka';
    this.lastActivityStatus = 'Selesai';
    this.completeStep('TAKE_CARROT');
  }

  private updateCleanCarrotStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
    if (!this.carrotCleaner) return;

    this.lastActivity = 'Mencuci wortel';
    this.lastObjectStatus = this.faucetOn ? 'Kran menyala' : 'Kran mati';
    this.lastActivityStatus = (this.carrotCleanCompleted && !this.faucetOn) ? 'Selesai' : 'Berlangsung';

    if (this.carrotCleanCompleted && this.faucetOn) {
      this.lastObjectStatus = 'Wortel bersih - matikan kran';
    }

    if (this.carrotCleanCompleted && !this.faucetOn) {
      this.completeCarrotCleaningAssessment();
    }
  }

  public setFaucetState(on: boolean): void {
    this.faucetOn = on;
  }

  private updateWindowStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
    if (!this.windowSystem) return;

    const windowName = 'jendela_g1';
    const isOpen = this.windowSystem.isWindowOpen(windowName);

    this.lastActivity = 'Membuka jendela';
    this.lastObjectStatus = isOpen ? 'Terbuka' : 'Tertutup';
    this.lastActivityStatus = isOpen ? 'Selesai' : 'Berlangsung';

    if (isOpen && !this.windowOpened) {
      this.windowOpened = true;
      this.completeWindowAssessment();
    }
  }

  private updateStoveStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
    if (!this.stoveFireMinigame) return;

    const isMinigameOpen = this.stoveFireMinigame.isOpened();

    this.lastActivity = 'Memasak wortel';
    this.lastObjectStatus = isMinigameOpen ? 'Minigame berjalan' : 'Siap memasak';
    this.lastActivityStatus = this.stoveMinigameCompleted ? 'Selesai' : 'Berlangsung';

    if (this.stoveMinigameCompleted) {
      this.completeStoveAssessment();
    }
  }

  private updateServeStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
    const isReady = this.servingSystem?.isReadyToServe() ?? false;

    this.lastActivity = 'Menghidangkan wortel rebus';
    this.lastObjectStatus = this.foodServed
      ? 'Terhidang di meja saji'
      : isReady
        ? 'Siap dihidahkan'
        : 'Belum matang';
    this.lastActivityStatus = this.foodServed ? 'Selesai' : 'Berlangsung';

    if (this.foodServed) {
      this.completeServeAssessment();
    }
  }

  public completeFridgeAssessment(): void {
    if (this.currentStep !== 'FRIDGE') return;
    this.completeStep('FRIDGE');
    this.completeStep('TAKE_CARROT');
  }

  public completeCarrotCleaningAssessment(): void {
    if (this.currentStep !== 'CLEAN_CARROT') return;
    this.completeStep('CLEAN_CARROT');
  }

  public completeWindowAssessment(): void {
    if (this.currentStep !== 'WINDOW') return;
    this.completeStep('WINDOW');
  }

  public completeStoveAssessment(): void {
    if (this.currentStep !== 'STOVE') return;
    this.completeStep('STOVE');
  }

  public completeServeAssessment(): void {
    if (this.currentStep !== 'SERVE') return;
    this.completeStep('SERVE');
  }

  public onCarrotCleanComplete(): void {
    this.carrotCleanCompleted = true;
  }

  public onStoveMinigameComplete(): void {
    this.stoveMinigameCompleted = true;
  }

  /** Dipanggil ServingSystem saat wortel rebus diletakkan di meja saji. */
  public onFoodServed(): void {
    this.foodServed = true;
  }

  public onFridgeDoorCollision(): void {
    this.applyPenalty('fridgeDoorCollision');
  }

  private completeStep(step: ErgonomicStep): void {
    const stepState = this.stepStates.get(step)!;
    if (stepState.completed) return;
    stepState.completed = true;

    const currentIndex = this.stepOrder.indexOf(step);
    if (currentIndex + 1 < this.stepOrder.length) {
      this.currentStep = this.stepOrder[currentIndex + 1];
    } else {
      this.currentStep = 'FINISHED';
      this.finished = true;
    }

    this.penaltyFlags.clear();
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

  private findObjectByName(name: string): InteractiveObject | null {
    return this.ctx.interactiveObjects.find(o => o.name === name) || null;
  }

  private findObjectByInteraction(interaction: string): InteractiveObject | null {
    return this.ctx.interactiveObjects.find(o => o.object3D.userData?.interaction === interaction) || null;
  }

  private calculateDistance(playerState: PlayerState, obj: InteractiveObject): number {
    const b = obj.boundingBox;
    const cx = THREE.MathUtils.clamp(playerState.position.x, b.min.x, b.max.x);
    const cz = THREE.MathUtils.clamp(playerState.position.z, b.min.z, b.max.z);
    const dx = playerState.position.x - cx;
    const dz = playerState.position.z - cz;
    return Math.sqrt(dx * dx + dz * dz) / this.ctx.sceneScale;
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
    return {
      currentStep: this.currentStep,
      score: Math.max(0, this.score),
      stepProgress: this.stepOrder.map(step => ({
        step,
        completed: this.stepStates.get(step)?.completed ?? false,
        perfect: this.stepStates.get(step)?.perfect ?? true,
      })),
      distance: this.lastDistance,
      distanceStatus: this.lastDistanceStatus,
      activity: this.lastActivity,
      objectStatus: this.lastObjectStatus,
      activityStatus: this.lastActivityStatus,
      perfectRun: this.perfectRun,
      finished: this.finished,
    };
  }

  public reset(): void {
    this.currentStep = 'FRIDGE';
    this.score = 100;
    this.perfectRun = true;
    this.finished = false;
    this.penaltyFlags.clear();
    this.lastDistance = 0;
    this.lastDistanceStatus = 'ergonomic';
    this.lastActivity = '';
    this.lastObjectStatus = '';
    this.lastActivityStatus = 'Berlangsung';
    this.resetStepFlags();

    this.stepOrder.forEach(step => {
      this.stepStates.set(step, {
        completed: false,
        perfect: true,
        penaltyApplied: { tooClose: false, tooFar: false, fridgeDoorCollision: false },
      });
    });
  }

  private updatePanel(): void {
    if (!this.panel || !this.onResultChange) return;
    this.onResultChange(this.getResult());
  }
}

export function createErgonomicAssessmentPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'ergonomic-assessment-panel';
  panel.style.cssText = `
    position: fixed;
    right: 16px;
    top: 80px;
    width: 280px;
    background: rgba(15, 20, 40, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 20px;
    z-index: 50;
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: #e0e0e0;
    pointer-events: none;
  `;

  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1);">
      <h3 style="font-size: 0.85rem; font-weight: 700; letter-spacing: 0.06em; color: #e94560; text-transform: uppercase; margin: 0;">PENILAIAN ERGONOMI</h3>
    </div>

    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Skor</div>
      <div id="ergo-score" style="font-size: 2rem; font-weight: 700; color: #4caf50;">100 / 100</div>
    </div>

    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Tahap</div>
      <div id="ergo-step" style="font-size: 1rem; font-weight: 600; color: #e94560;">Mengambil bahan</div>
    </div>

    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Aktivitas</div>
      <div id="ergo-activity" style="font-size: 0.85rem; font-weight: 500; color: #aaa;">Kulkas</div>
    </div>

    <div style="margin-bottom: 16px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Jarak</div>
      <div id="ergo-distance" style="font-size: 1.5rem; font-weight: 700; color: #4caf50;">0.00 m</div>
      <div id="ergo-distance-status" style="font-size: 0.75rem; margin-top: 4px; font-weight: 600;">✓ Ergonomis</div>
    </div>

    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Status Aktivitas</div>
      <div id="ergo-activity-status" style="font-size: 0.85rem; font-weight: 600; color: #ff9800;">Berlangsung</div>
    </div>

    <div style="margin-bottom: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.05);">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Progress</div>
      <div id="ergo-progress" style="font-size: 0.85rem; font-weight: 600; color: #e94560;">1 / 6</div>
    </div>
  `;

  return panel;
}
