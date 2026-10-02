import * as THREE from 'three';
import type { SceneContext, InteractiveObject, PlayerState, ControlInput } from './types';
import { FridgeInteractionSystem, FridgeState } from './FridgeInteractionSystem';
import { CarrotCleaner } from './CarrotCleaner';
import { StoveFireMinigame } from './StoveFireMinigame';
import { WindowSystem } from './WindowSystem';

export type ErgonomicStep = 
  | 'FRIDGE' 
  | 'TAKE_CARROT' 
  | 'CLEAN_CARROT' 
  | 'WINDOW' 
  | 'STOVE' 
  | 'FINISHED';

export interface ErgonomicAssessmentConfig {
  minDistance: number;
  maxDistance: number;
  penalty: {
    tooClose: number;
    tooFar: number;
    fridgeDoorCollision: number;
    failedMinigame: number;
    extraAttempt: number;
  };
  perfectRunThreshold: number;
}

const DEFAULT_CONFIG: ErgonomicAssessmentConfig = {
  minDistance: 0.7,
  maxDistance: 1.0,
  penalty: {
    tooClose: 5,
    tooFar: 5,
    fridgeDoorCollision: 10,
    failedMinigame: 10,
    extraAttempt: 5,
  },
  perfectRunThreshold: 100,
};

interface StepState {
  completed: boolean;
  perfect: boolean;
  attempts: number;
  penaltyApplied: {
    tooClose: boolean;
    tooFar: boolean;
    fridgeDoorCollision: boolean;
  };
}

export interface ErgonomicAssessmentResult {
  currentStep: ErgonomicStep;
  score: number;
  lives: number;
  maxLives: number;
  stepProgress: { step: ErgonomicStep; completed: boolean; perfect: boolean }[];
  distance: number;
  distanceStatus: 'tooClose' | 'ergonomic' | 'tooFar';
  activity: string;
  objectStatus: string;
  perfectRun: boolean;
  finished: boolean;
}

export class ErgonomicAssessmentSystem {
  private ctx: SceneContext;
  private config: ErgonomicAssessmentConfig;
  private fridgeInteraction: FridgeInteractionSystem | null = null;
  private carrotCleaner: CarrotCleaner | null = null;
  private stoveFireMinigame: StoveFireMinigame | null = null;
  private windowSystem: WindowSystem | null = null;

  private currentStep: ErgonomicStep = 'FRIDGE';
  private score = 100;
  private lives = 3;
  private maxLives = 3;
  private perfectRun = true;
  private finished = false;

  private stepStates: Map<ErgonomicStep, StepState> = new Map();
  private stepOrder: ErgonomicStep[] = ['FRIDGE', 'TAKE_CARROT', 'CLEAN_CARROT', 'WINDOW', 'STOVE'];
  
  private lastDistance = 0;
  private lastDistanceStatus: 'tooClose' | 'ergonomic' | 'tooFar' = 'ergonomic';
  private lastActivity = '';
  private lastObjectStatus = '';
  
  private currentTargetObject: InteractiveObject | null = null;
  private penaltyFlags: Set<string> = new Set();

  private panel: HTMLElement | null = null;
  private onResultChange: ((result: ErgonomicAssessmentResult) => void) | null = null;

  constructor(ctx: SceneContext, config?: Partial<ErgonomicAssessmentConfig>) {
    this.ctx = ctx;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.stepOrder.forEach(step => {
      this.stepStates.set(step, {
        completed: false,
        perfect: true,
        attempts: 0,
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

    if (distance < this.config.minDistance) {
      this.lastDistanceStatus = 'tooClose';
      this.applyPenalty('tooClose');
    } else if (distance > this.config.maxDistance) {
      this.lastDistanceStatus = 'tooFar';
      this.applyPenalty('tooFar');
    } else {
      this.lastDistanceStatus = 'ergonomic';
      this.clearPenalty('tooClose');
      this.clearPenalty('tooFar');
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
    }
  }

  private updateFridgeStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
    if (!this.fridgeInteraction) return;

    const isOpen = this.fridgeInteraction.getState() === FridgeState.IDLE && this.isFridgeDoorOpen();
    
    this.lastActivity = 'Membuka kulkas';
    this.lastObjectStatus = isOpen ? 'Terbuka' : 'Tertutup';

    if (isOpen && !stepState.completed) {
      this.completeStep('FRIDGE');
    }
  }

  private isFridgeDoorOpen(): boolean {
    if (!this.fridgeInteraction || !this.fridgeInteraction.getFridgeModel()) return false;
    return this.fridgeInteraction.isFridgeOpen();
  }

  private updateTakeCarrotStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
    if (!this.fridgeInteraction) return;

    const isOpen = this.fridgeInteraction.getState() === FridgeState.IDLE && this.isFridgeDoorOpen();
    
    this.lastActivity = 'Mengambil wortel';
    this.lastObjectStatus = isOpen ? 'Kulkas terbuka' : 'Kulkas tertutup';

    if (isOpen && input.interact && !input.interactKey) {
      this.completeStep('TAKE_CARROT');
    }
  }

  private updateCleanCarrotStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
    if (!this.carrotCleaner) return;

    const isFaucetOn = this.carrotCleaner.isOpened();
    
    this.lastActivity = 'Mencuci wortel';
    this.lastObjectStatus = isFaucetOn ? 'Kran menyala' : 'Kran mati';

    if (isFaucetOn && !this.carrotCleaner.isOpened()) {
      this.completeStep('CLEAN_CARROT');
    }
  }

  private updateWindowStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
    if (!this.windowSystem) return;

    const windowName = 'jendela_g1';
    const isOpen = this.windowSystem.isWindowOpen(windowName);
    
    this.lastActivity = 'Membuka jendela';
    this.lastObjectStatus = isOpen ? 'Terbuka' : 'Tertutup';

    if (isOpen && !stepState.completed) {
      this.completeStep('WINDOW');
    }
  }

  private updateStoveStep(playerState: PlayerState, input: ControlInput, stepState: StepState): void {
    if (!this.stoveFireMinigame) return;

    const isMinigameOpen = this.stoveFireMinigame.isOpened();
    
    this.lastActivity = 'Memasak wortel';
    this.lastObjectStatus = isMinigameOpen ? 'Minigame berjalan' : 'Siap memasak';

    if (isMinigameOpen) {
      stepState.attempts++;
    }

    if (this.stoveFireMinigame.isOpened() === false && stepState.attempts > 0) {
      this.completeStep('STOVE');
    }
  }

  private completeStep(step: ErgonomicStep): void {
    const stepState = this.stepStates.get(step)!;
    stepState.completed = true;

    const currentIndex = this.stepOrder.indexOf(step);
    if (currentIndex + 1 < this.stepOrder.length) {
      this.currentStep = this.stepOrder[currentIndex + 1];
    } else {
      this.currentStep = 'FINISHED';
      this.finished = true;
    }

    this.penaltyFlags.clear();
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

  public canInteract(objectType: 'fridge' | 'faucet' | 'window' | 'stove'): boolean {
    if (this.finished) return false;

    const requiredStepMap: Record<string, ErgonomicStep> = {
      fridge: 'FRIDGE',
      faucet: 'CLEAN_CARROT',
      window: 'WINDOW',
      stove: 'STOVE',
    };

    return this.currentStep === requiredStepMap[objectType];
  }

  public getResult(): ErgonomicAssessmentResult {
    return {
      currentStep: this.currentStep,
      score: Math.max(0, this.score),
      lives: this.lives,
      maxLives: this.maxLives,
      stepProgress: this.stepOrder.map(step => ({
        step,
        completed: this.stepStates.get(step)?.completed ?? false,
        perfect: this.stepStates.get(step)?.perfect ?? true,
      })),
      distance: this.lastDistance,
      distanceStatus: this.lastDistanceStatus,
      activity: this.lastActivity,
      objectStatus: this.lastObjectStatus,
      perfectRun: this.perfectRun,
      finished: this.finished,
    };
  }

  public reset(): void {
    this.currentStep = 'FRIDGE';
    this.score = 100;
    this.lives = this.maxLives;
    this.perfectRun = true;
    this.finished = false;
    this.penaltyFlags.clear();
    this.lastDistance = 0;
    this.lastDistanceStatus = 'ergonomic';
    this.lastActivity = '';
    this.lastObjectStatus = '';

    this.stepOrder.forEach(step => {
      this.stepStates.set(step, {
        completed: false,
        perfect: true,
        attempts: 0,
        penaltyApplied: { tooClose: false, tooFar: false, fridgeDoorCollision: false },
      });
    });
  }

  public loseLife(): void {
    this.lives = Math.max(0, this.lives - 1);
    this.perfectRun = false;
    if (this.lives <= 0) {
      this.finished = true;
    }
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
      <h3 style="font-size: 0.85rem; font-weight: 700; letter-spacing: 0.06em; color: #e94560; text-transform: uppercase; margin: 0;">ERGONOMIC ASSESSMENT</h3>
      <span id="ergo-lives" style="font-size: 0.75rem; font-weight: 600; color: #f44336; background: rgba(244, 67, 54, 0.1); padding: 2px 8px; border-radius: 12px;">Kesempatan: 3/3</span>
    </div>
    
    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Nilai</div>
      <div id="ergo-score" style="font-size: 2rem; font-weight: 700; color: #4caf50;">100 / 100</div>
    </div>

    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Tahap</div>
      <div id="ergo-step" style="font-size: 1rem; font-weight: 600; color: #e94560;">Buka Kulkas</div>
    </div>

    <div style="margin-bottom: 16px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Jarak</div>
      <div id="ergo-distance" style="font-size: 1.5rem; font-weight: 700; color: #4caf50;">0.00 m</div>
      <div id="ergo-distance-status" style="font-size: 0.75rem; margin-top: 4px; font-weight: 600;">✓ Ergonomis</div>
    </div>

    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Aktivitas</div>
      <div id="ergo-activity" style="font-size: 0.85rem; font-weight: 500; color: #aaa;">Membuka kulkas</div>
    </div>

    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Status Objek</div>
      <div id="ergo-object-status" style="font-size: 0.85rem; font-weight: 500; color: #aaa;">Tertutup</div>
    </div>

    <div style="margin-bottom: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.05);">
      <div style="font-size: 0.7rem; opacity: 0.5; margin-bottom: 4px; text-transform: uppercase;">Progress</div>
      <div id="ergo-progress" style="font-size: 0.85rem; font-weight: 600; color: #e94560;">1 / 5</div>
    </div>
  `;

  return panel;
}