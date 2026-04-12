export interface HoleInfo {
  number: number;
  par: number;
  description: string;
}

export class MainMenu {
  private el: HTMLElement;
  private panels: Record<string, HTMLElement>;
  private mpSubs: Record<string, HTMLElement>;
  private selectedTheme = 'forest';

  public onSoloStart: ((startIndex: number) => void) | null = null;
  public onThemeSelected: ((theme: string) => void) | null = null;
  public onMultiHost: (() => void) | null = null;
  public onMultiJoin: ((code: string) => void) | null = null;
  public onMultiCancel: (() => void) | null = null;

  constructor(holes: HoleInfo[]) {
    this.el = document.getElementById('main-menu')!;
    this.panels = {
      'menu-main':    document.getElementById('menu-main')!,
      'theme-panel':  document.getElementById('theme-panel')!,
      'stage-select': document.getElementById('stage-select')!,
      'multi-panel':  document.getElementById('multi-panel')!,
    };
    this.mpSubs = {
      choice: document.getElementById('mp-sub-choice')!,
      host:   document.getElementById('mp-sub-host')!,
      join:   document.getElementById('mp-sub-join')!,
    };

    // Top-level navigation
    document.getElementById('btn-solo')!.addEventListener('click', () => this._show('theme-panel'));
    document.getElementById('btn-multi')!.addEventListener('click', () => this._show('multi-panel'));
    document.getElementById('btn-back-theme')!.addEventListener('click', () => this._show('menu-main'));
    document.getElementById('btn-back-solo')!.addEventListener('click',  () => this._show('theme-panel'));
    document.getElementById('btn-back-multi')!.addEventListener('click', () => this._show('menu-main'));

    // Theme cards
    document.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        const theme = (card as HTMLElement).dataset.theme ?? 'forest';
        this.selectedTheme = theme;
        this.onThemeSelected?.(theme);
        this._show('stage-select');
      });
    });

    // Multi sub-panels
    document.getElementById('btn-create-room')!.addEventListener('click', () => {
      this._showMpSub('host');
      document.getElementById('mp-room-code')!.textContent = '···';
      document.getElementById('mp-host-status')!.textContent = '방 생성 중...';
      this.onMultiHost?.();
    });
    document.getElementById('btn-show-join')!.addEventListener('click', () => this._showMpSub('join'));
    document.getElementById('btn-copy-code')!.addEventListener('click', () => {
      const code = document.getElementById('mp-room-code')!.textContent ?? '';
      if (code && code !== '···') navigator.clipboard.writeText(code).catch(() => {});
    });
    document.getElementById('btn-cancel-host')!.addEventListener('click', () => {
      this.onMultiCancel?.();
      this._showMpSub('choice');
      this._show('multi-panel');
    });
    document.getElementById('btn-back-join')!.addEventListener('click', () => this._showMpSub('choice'));
    document.getElementById('btn-do-join')!.addEventListener('click', () => {
      const code = (document.getElementById('mp-join-code') as HTMLInputElement).value.trim();
      if (code) this.onMultiJoin?.(code);
    });
    document.getElementById('mp-join-code')!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        const code = (document.getElementById('mp-join-code') as HTMLInputElement).value.trim();
        if (code) this.onMultiJoin?.(code);
      }
    });

    this._buildStageGrid(holes);
  }

  // ── Public interface ───────────────────────────────────────────────────────

  show(): void { this.el.style.display = 'flex'; this._show('menu-main'); }
  hide(): void { this.el.style.display = 'none'; }

  rebuildStageGrid(holes: HoleInfo[]): void { this._buildStageGrid(holes); }

  showMultiRoomCode(code: string): void {
    document.getElementById('mp-room-code')!.textContent = code;
    document.getElementById('mp-host-status')!.textContent = '상대방 대기 중...';
  }
  showMultiHostStatus(text: string): void {
    document.getElementById('mp-host-status')!.textContent = text;
  }
  showMultiJoinStatus(text: string): void {
    const s = document.getElementById('mp-join-status')!;
    s.style.display = 'block'; s.textContent = text;
    document.getElementById('mp-join-error')!.style.display = 'none';
  }
  showMultiJoinError(text: string): void {
    const e = document.getElementById('mp-join-error')!;
    e.style.display = 'block'; e.textContent = text;
    document.getElementById('mp-join-status')!.style.display = 'none';
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _show(panelId: string): void {
    for (const [id, el] of Object.entries(this.panels)) {
      el.style.display = id === panelId ? 'flex' : 'none';
    }
    if (panelId === 'multi-panel') {
      this._showMpSub('choice');
      (document.getElementById('mp-join-code') as HTMLInputElement).value = '';
      document.getElementById('mp-join-status')!.style.display = 'none';
      document.getElementById('mp-join-error')!.style.display  = 'none';
    }
  }

  private _showMpSub(id: string): void {
    for (const [k, el] of Object.entries(this.mpSubs)) {
      el.classList.toggle('active', k === id);
    }
  }

  private _buildStageGrid(holes: HoleInfo[]): void {
    const grid = document.getElementById('stage-grid')!;
    grid.innerHTML = '';
    holes.forEach((hole, idx) => {
      const card = document.createElement('div');
      card.className = 'stage-card';
      card.innerHTML = `
        <div class="sc-hole">HOLE</div>
        <div class="sc-num">${hole.number}</div>
        <div class="sc-par">Par ${hole.par}</div>
        <div class="sc-desc">${hole.description}</div>
      `;
      card.addEventListener('click', () => { this.hide(); this.onSoloStart?.(idx); });
      grid.appendChild(card);
    });
  }
}
