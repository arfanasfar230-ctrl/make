import type { SceneContext } from './types';

interface StoveFireMinigameOptions {
  onSuccess?: () => void;
  onClose?: () => void;
  onComplete?: (success: boolean, mistakes: number) => void;
}

export class StoveFireMinigame {
  private ctx: SceneContext;
  private options: StoveFireMinigameOptions;
  private container!: HTMLDivElement;
  private isOpen = false;
  private targetTime: number = 0;
  private targetLevel: number = 0;
  private currentLevel: number = 0.5;
  private slider!: HTMLInputElement;
  private timeDisplay!: HTMLElement;
  private levelDisplay!: HTMLElement;
  private messageDisplay!: HTMLElement;
  private attemptsDisplay!: HTMLElement;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private animationId: number | null = null;
  private startTime: number = 0;
  private timeLimit = 5000;
  private hasCompleted = false;
  private attempts = 0;
  private maxAttempts = 3;
  private mistakes = 0;

  constructor(ctx: SceneContext, options: StoveFireMinigameOptions = {}) {
    this.ctx = ctx;
    this.options = options;
    this.createModal();
    this.setupEventListeners();
  }

  private createModal(): void {
    this.container = document.createElement('div');
    this.container.id = 'stove-fire-minigame-modal';
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
    overlay.id = 'stove-fire-minigame-overlay';
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
    modal.id = 'stove-fire-minigame-popup';
    modal.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 33vw;
      max-width: 400px;
      height: 40vh;
      max-height: 400px;
      min-width: 280px;
      min-height: 300px;
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
    title.textContent = 'Atur Level Api';
    title.style.cssText = `
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: #333;
    `;

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    closeButton.style.cssText = `
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
    closeButton.onmouseenter = () => {
      closeButton.style.color = '#000';
      closeButton.style.background = 'rgba(0, 0, 0, 0.1)';
    };
    closeButton.onmouseleave = () => {
      closeButton.style.color = '#666';
      closeButton.style.background = 'none';
    };
    closeButton.addEventListener('click', () => this.close());

    header.appendChild(title);
    header.appendChild(closeButton);

    const content = document.createElement('div');
    content.style.cssText = `
      flex: 1;
      padding: 24px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 20px;
    `;

    this.attemptsDisplay = document.createElement('div');
    this.attemptsDisplay.id = 'stove-fire-attempts';
    this.attemptsDisplay.style.cssText = `
      font-size: 0.85rem;
      font-weight: 600;
      color: #666;
      text-align: center;
    `;
    this.attemptsDisplay.textContent = `Kesempatan: ${this.maxAttempts}/${this.maxAttempts}`;

    this.timeDisplay = document.createElement('div');
    this.timeDisplay.id = 'stove-fire-time';
    this.timeDisplay.style.cssText = `
      font-size: 1.5rem;
      font-weight: 600;
      color: #333;
      text-align: center;
    `;
    this.timeDisplay.textContent = 'Memuat...';

    this.levelDisplay = document.createElement('div');
    this.levelDisplay.id = 'stove-fire-level';
    this.levelDisplay.style.cssText = `
      font-size: 1.2rem;
      color: #666;
      text-align: center;
      font-weight: 500;
    `;
    this.levelDisplay.textContent = 'Level Api: 0.5';

    const sliderContainer = document.createElement('div');
    sliderContainer.style.cssText = `
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    `;

    const sliderTrack = document.createElement('div');
    sliderTrack.style.cssText = `
      width: 100%;
      height: 8px;
      background: linear-gradient(90deg, #ff6b35, #ffd700, #fff3e0);
      border-radius: 4px;
      position: relative;
    `;

    const levelMarks = document.createElement('div');
    levelMarks.style.cssText = `
      width: 100%;
      display: flex;
      justify-content: space-between;
      padding: 0 4px;
      font-size: 0.7rem;
      color: #999;
    `;
    for (let i = 0; i <= 9; i++) {
      const mark = document.createElement('span');
      mark.textContent = (0.5 + i * 0.5).toFixed(1);
      levelMarks.appendChild(mark);
    }

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0.5';
    this.slider.max = '5';
    this.slider.step = '0.5';
    this.slider.value = '0.5';
    this.slider.style.cssText = `
      width: 100%;
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
      cursor: pointer;
      height: 24px;
      position: relative;
      z-index: 1;
    `;

    this.messageDisplay = document.createElement('div');
    this.messageDisplay.id = 'stove-fire-message';
    this.messageDisplay.style.cssText = `
      font-size: 0.9rem;
      color: #f44336;
      text-align: center;
      min-height: 24px;
      font-weight: 500;
    `;
    this.messageDisplay.textContent = '';

    sliderTrack.appendChild(this.slider);
    sliderContainer.appendChild(sliderTrack);
    sliderContainer.appendChild(levelMarks);

    content.appendChild(this.attemptsDisplay);
    content.appendChild(this.timeDisplay);
    content.appendChild(this.levelDisplay);
    content.appendChild(sliderContainer);
    content.appendChild(this.messageDisplay);

    modal.appendChild(header);
    modal.appendChild(content);
    this.container.appendChild(overlay);
    this.container.appendChild(modal);

    document.body.appendChild(this.container);
  }

  private setupEventListeners(): void {
    this.slider.addEventListener('input', () => {
      this.currentLevel = parseFloat(this.slider.value);
      this.levelDisplay.textContent = `Level Api: ${this.currentLevel.toFixed(1)}`;
      this.checkLevelMatch();
    });

    this.slider.addEventListener('change', () => {
      this.checkLevelMatch();
    });
  }

  private generateRandomTime(): number {
    return Math.floor(Math.random() * 10) + 1;
  }

  private calculateTargetLevel(time: number): number {
    return (11 - time) / 2;
  }

  private checkLevelMatch(): void {
    const diff = Math.abs(this.currentLevel - this.targetLevel);
    if (diff <= 0.25) {
      this.messageDisplay.textContent = 'Level api pas!';
      this.messageDisplay.style.color = '#4caf50';
      this.completeMinigame(true);
    } else {
      this.messageDisplay.textContent = '';
      this.messageDisplay.style.color = '#f44336';
    }
  }

  private startTimer(): void {
    this.startTime = performance.now();
    this.animateTimer();
  }

  private animateTimer = (): void => {
    const elapsed = performance.now() - this.startTime;
    const remaining = Math.max(0, this.timeLimit - elapsed);

    if (remaining <= 0) {
      this.failMinigame();
      return;
    }

    if (!this.hasCompleted) {
      this.animationId = requestAnimationFrame(this.animateTimer);
    }
  };

  private completeMinigame(success: boolean): void {
    if (this.hasCompleted) return;
    this.hasCompleted = true;

    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (success) {
      this.options.onSuccess?.();
      this.options.onComplete?.(true, this.mistakes);
      setTimeout(() => this.close(), 500);
    }
  }

  private failMinigame(): void {
    if (this.hasCompleted) return;
    this.hasCompleted = true;
    this.attempts++;
    this.mistakes++;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    this.attemptsDisplay.textContent = `Kesempatan: ${this.maxAttempts - this.attempts}/${this.maxAttempts}`;

    if (this.attempts >= this.maxAttempts) {
      this.messageDisplay.textContent = 'Game Over - Wortel gosong!';
      this.messageDisplay.style.color = '#f44336';
      this.slider.disabled = true;
      this.options.onComplete?.(false, this.mistakes);
      this.timerId = setTimeout(() => {
        this.close();
      }, 2000);
    } else {
      this.messageDisplay.textContent = 'wortel kamu gosong silahkan coba lagi';
      this.messageDisplay.style.color = '#f44336';
      this.slider.disabled = true;

      this.timerId = setTimeout(() => {
        this.resetMinigame();
      }, 2000);
    }
  }

  private resetMinigame(): void {
    this.hasCompleted = false;
    this.slider.disabled = false;
    this.messageDisplay.textContent = '';
    this.generateNewChallenge();
    this.startTimer();
  }

  private generateNewChallenge(): void {
    this.targetTime = this.generateRandomTime();
    this.targetLevel = this.calculateTargetLevel(this.targetTime);
    this.currentLevel = 0.5;
    this.slider.value = '0.5';
    this.timeDisplay.textContent = `Kamu punya waktu ${this.targetTime} menit`;
    this.levelDisplay.textContent = `Level Api: ${this.currentLevel.toFixed(1)}`;
    this.messageDisplay.textContent = '';
  }

  public open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    document.exitPointerLock?.();
    this.container.style.display = 'block';
    this.disableMainSceneInteraction();
    this.attempts = 0;
    this.mistakes = 0;
    this.attemptsDisplay.textContent = `Kesempatan: ${this.maxAttempts}/${this.maxAttempts}`;
    this.generateNewChallenge();
    this.startTimer();
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.container.style.display = 'none';
    this.enableMainSceneInteraction();
    this.options.onClose?.();

    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.hasCompleted = false;
    this.slider.disabled = false;
  }

  public isOpened(): boolean {
    return this.isOpen;
  }

  public getAttempts(): number {
    return this.attempts;
  }

  public getMaxAttempts(): number {
    return this.maxAttempts;
  }

  private disableMainSceneInteraction(): void {
    this.ctx.renderer.domElement.style.pointerEvents = 'none';
  }

  private enableMainSceneInteraction(): void {
    this.ctx.renderer.domElement.style.pointerEvents = 'auto';
  }

  public dispose(): void {
    if (this.timerId) clearTimeout(this.timerId);
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.container.remove();
    this.enableMainSceneInteraction();
  }
}
