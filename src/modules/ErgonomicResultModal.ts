import type { ErgonomicAssessmentResult } from './ErgonomicAssessmentSystem';
import { ACTIVITY_ORDER, scoreColor } from './ErgonomicAssessmentSystem';

export interface ErgonomicResultModalOptions {
  /** Tutup popup dan kembali ke gameplay. Progres & skor tidak di-reset. */
  onContinue?: () => void;
  /** Jalankan mekanisme keluar/selesai yang sudah dipakai project. */
  onExit?: () => void;
}

/** Id elemen <style> modal supaya gaya hanya disisipkan sekali. */
const MODAL_STYLE_ID = 'ergonomic-result-modal-style';

/**
 * Popup hasil penilaian ergonomi. Sengaja terpisah dari panel live: panel hanya
 * menampilkan lima baris status/jarak/skor, sedangkan skor akhir dan rinciannya
 * hanya hidup di modal ini dan hanya muncul setelah tombol LIHAT NILAI AKHIR ditekan.
 *
 * Overlay memakai fixed positioning sehingga tidak pernah menggeser layout
 * gameplay di bawahnya.
 */
export class ErgonomicResultModal {
  private overlay: HTMLElement;
  private panel: HTMLElement;
  private finalScoreEl: HTMLElement;
  private tableBody: HTMLElement;
  private averageEl: HTMLElement;
  private continueBtn: HTMLButtonElement;
  private exitBtn: HTMLButtonElement;
  private options: ErgonomicResultModalOptions;
  private opened = false;

  constructor(options: ErgonomicResultModalOptions = {}) {
    this.options = options;
    this.overlay = this.createOverlay();
    this.panel = this.overlay.querySelector<HTMLElement>('.ergo-result-modal')!;
    this.finalScoreEl = this.panel.querySelector<HTMLElement>('[data-field="final-score"]')!;
    this.tableBody = this.panel.querySelector<HTMLElement>('[data-field="rows"]')!;
    this.averageEl = this.panel.querySelector<HTMLElement>('[data-field="average"]')!;
    this.continueBtn = this.panel.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
    this.exitBtn = this.panel.querySelector<HTMLButtonElement>('[data-action="exit"]')!;

    this.continueBtn.addEventListener('click', () => this.close());
    this.exitBtn.addEventListener('click', () => {
      // Tutup dulu supaya overlay tidak menggantung bila navigasi ditunda browser.
      this.hide();
      this.options.onExit?.();
    });
    this.overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });

    injectModalStyle();
    document.body.appendChild(this.overlay);
  }

  private createOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'ergonomic-result-overlay';
    overlay.className = 'ergo-result-overlay';
    overlay.style.display = 'none';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ergo-result-title');

    overlay.innerHTML = `
      <div class="ergo-result-modal">
        <h3 class="ergo-result-title" id="ergo-result-title">Hasil Penilaian Ergonomi</h3>

        <div class="ergo-result-headline">
          <div class="ergo-result-headline-label">Skor Akhir</div>
          <div class="ergo-result-headline-value" data-field="final-score">0</div>
        </div>

        <div class="ergo-result-table-wrapper">
          <table class="ergo-result-table">
            <thead>
              <tr>
                <th scope="col">Aktivitas</th>
                <th scope="col" class="ergo-result-num">Jarak</th>
                <th scope="col" class="ergo-result-num">Skor</th>
              </tr>
            </thead>
            <tbody data-field="rows"></tbody>
          </table>
        </div>

        <div class="ergo-result-average" data-field="average">Rata-rata: 0</div>

        <div class="ergo-result-actions">
          <button type="button" class="ergo-result-btn primary" data-action="continue">Lanjutkan</button>
          <button type="button" class="ergo-result-btn" data-action="exit">Keluar</button>
        </div>
      </div>
    `;

    return overlay;
  }

  /**
   * Tampilkan hasil dari state penilaian yang sudah ada. Skor akhir diambil dari
   * `result.finalScore`, yaitu rata-rata lima skor yang sudah terkunci di
   * ErgonomicAssessmentSystem — tidak dihitung ulang di sini.
   */
  public open(result: ErgonomicAssessmentResult): void {
    // Penjaga: modal hanya boleh tampil kalau kelima skor sudah terkunci.
    if (result.finalScore === null) return;

    const rows = new Map(result.activities.map(activity => [activity.key, activity]));

    this.finalScoreEl.textContent = String(result.finalScore);
    this.finalScoreEl.style.color = scoreColor(result.finalScore);

    this.tableBody.replaceChildren(...ACTIVITY_ORDER.flatMap((key) => {
      const activity = rows.get(key);
      if (!activity) return [];
      const score = activity.score;
      const scoreText = score === null ? '--' : String(score);
      const color = score === null ? '#888' : scoreColor(score);
      const row = document.createElement('tr');
      row.dataset.activity = activity.key;

      const nameCell = document.createElement('td');
      nameCell.className = 'ergo-result-activity';
      nameCell.textContent = activity.shortLabel;
      row.appendChild(nameCell);

      const distanceCell = document.createElement('td');
      distanceCell.className = 'ergo-result-num';
      distanceCell.textContent = `${activity.distance.toFixed(2)} m`;
      row.appendChild(distanceCell);

      const scoreCell = document.createElement('td');
      scoreCell.className = 'ergo-result-num ergo-result-score';
      scoreCell.style.color = color;
      scoreCell.textContent = scoreText;
      row.appendChild(scoreCell);
      return [row];
    }));

    this.averageEl.textContent = `Rata-rata: ${result.finalScore}`;

    this.show();
    // Fokus ke tombol LANJUTKAN supaya keyboard/mobile langsung bisa lanjut.
    this.continueBtn.focus();
  }

  /** Tutup popup dan kembali ke gameplay. Tidak mereset apa pun. */
  public close(): void {
    if (!this.opened) return;
    this.hide();
    this.options.onContinue?.();
  }

  public isOpened(): boolean {
    return this.opened;
  }

  private show(): void {
    this.overlay.style.display = 'flex';
    this.opened = true;
    document.exitPointerLock?.();
  }

  private hide(): void {
    this.overlay.style.display = 'none';
    this.opened = false;
  }

  public dispose(): void {
    this.hide();
    this.overlay.remove();
  }
}

/**
 * Gaya modal mengikuti bahasa visual Projek 2 (panel #1a1a2e + border biru
 * #38bdf8 seperti popup teleport, aksen merah #e94560 seperti panel penilaian).
 * Responsif untuk desktop, tablet, mobile landscape/portrait, safe-area.
 */
function injectModalStyle(): void {
  if (document.getElementById(MODAL_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = MODAL_STYLE_ID;
  style.textContent = `
    .ergo-result-overlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 10000;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #e2e8f0;
      box-sizing: border-box;
    }

    .ergo-result-modal {
      width: min(92vw, 460px);
      max-height: 88vh;
      overflow-y: auto;
      padding: 24px;
      background: #1a1a2e;
      border: 2px solid #38bdf8;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      box-sizing: border-box;
    }

    .ergo-result-title {
      margin: 0 0 14px;
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      text-align: center;
      color: #38bdf8;
    }

    .ergo-result-headline {
      padding: 14px 12px;
      margin-bottom: 16px;
      border: 1px solid rgba(233, 69, 96, 0.35);
      border-radius: 10px;
      background: rgba(233, 69, 96, 0.08);
      text-align: center;
    }
    .ergo-result-headline-label {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      opacity: 0.75;
    }
    .ergo-result-headline-value {
      font-size: 3rem;
      font-weight: 700;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }

    .ergo-result-table-wrapper {
      width: 100%;
      overflow-x: auto;
      margin-bottom: 12px;
      -webkit-overflow-scrolling: touch;
    }
    .ergo-result-table {
      width: 100%;
      min-width: 280px;
      border-collapse: collapse;
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
    }
    .ergo-result-table th,
    .ergo-result-table td {
      padding: 8px 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      text-align: left;
      white-space: nowrap;
    }
    .ergo-result-table thead th {
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.6;
      border-bottom-color: rgba(255, 255, 255, 0.18);
    }
    .ergo-result-table tbody tr:last-child td { border-bottom: none; }
    .ergo-result-num { text-align: right; }
    .ergo-result-activity { padding-right: 12px !important; }
    .ergo-result-score { font-weight: 700; }

    .ergo-result-average {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 0.95rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }

    .ergo-result-actions {
      display: flex;
      gap: 12px;
      margin-top: 18px;
    }
    .ergo-result-btn {
      flex: 1;
      min-height: 48px;
      padding: 11px 12px;
      border: none;
      border-radius: 8px;
      font-family: inherit;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      cursor: pointer;
      transition: background 0.2s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .ergo-result-btn.primary {
      background: #38bdf8;
      color: #0f172a;
    }
    .ergo-result-btn.primary:hover { background: #0ea5e9; }
    .ergo-result-btn:not(.primary) {
      background: #334155;
      color: #e2e8f0;
    }
    .ergo-result-btn:not(.primary):hover { background: #475569; }

    /* Tablet landscape / small desktop */
    @media (max-width: 768px) {
      .ergo-result-modal {
        padding: 20px;
        width: min(94vw, 460px);
      }
      .ergo-result-headline { padding: 12px 10px; margin-bottom: 12px; }
      .ergo-result-headline-value { font-size: 2.6rem; }
      .ergo-result-table { font-size: 0.78rem; }
      .ergo-result-table th,
      .ergo-result-table td { padding: 7px 5px; }
      .ergo-result-actions { gap: 10px; }
      .ergo-result-btn {
        min-height: 44px;
        font-size: 0.8rem;
      }
    }

    /* Mobile landscape & portrait */
    @media (max-width: 520px) {
      .ergo-result-overlay {
        padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
        align-items: flex-start;
        justify-content: center;
      }
      .ergo-result-modal {
        padding: 16px;
        width: min(96vw, 460px);
        max-height: calc(100vh - max(12px, env(safe-area-inset-top)) - max(12px, env(safe-area-inset-bottom)));
        border-radius: 10px;
      }
      .ergo-result-title { font-size: 0.85rem; margin-bottom: 10px; }
      .ergo-result-headline { padding: 10px 8px; margin-bottom: 10px; }
      .ergo-result-headline-label { font-size: 0.6rem; }
      .ergo-result-headline-value { font-size: 2.2rem; }
      .ergo-result-table { font-size: 0.72rem; min-width: 260px; }
      .ergo-result-table th,
      .ergo-result-table td { padding: 6px 4px; }
      .ergo-result-average { font-size: 0.85rem; margin-top: 10px; padding-top: 10px; }
      .ergo-result-actions {
        flex-direction: column;
        gap: 8px;
        margin-top: 14px;
      }
      .ergo-result-btn {
        width: 100%;
        min-height: 50px;
        font-size: 0.9rem;
      }
    }

    /* Very small screens (e.g., 320px wide) */
    @media (max-width: 360px) {
      .ergo-result-modal { padding: 12px; }
      .ergo-result-headline-value { font-size: 1.8rem; }
      .ergo-result-table { font-size: 0.68rem; min-width: 240px; }
      .ergo-result-table th,
      .ergo-result-table td { padding: 5px 3px; }
      .ergo-result-btn { min-height: 46px; font-size: 0.85rem; }
    }

    /* Landscape phones - ensure modal fits height */
    @media (max-height: 480px) and (orientation: landscape) {
      .ergo-result-overlay {
        align-items: flex-start;
        padding-top: max(8px, env(safe-area-inset-top));
        padding-bottom: max(8px, env(safe-area-inset-bottom));
      }
      .ergo-result-modal {
        max-height: calc(100vh - max(8px, env(safe-area-inset-top)) - max(8px, env(safe-area-inset-bottom)));
        padding: 14px;
      }
      .ergo-result-headline { padding: 8px 6px; margin-bottom: 8px; }
      .ergo-result-headline-value { font-size: 1.8rem; }
      .ergo-result-average { margin-top: 8px; padding-top: 8px; }
      .ergo-result-actions { margin-top: 10px; }
    }
  `;
  document.head.appendChild(style);
}