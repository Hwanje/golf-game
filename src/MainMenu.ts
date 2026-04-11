export interface HoleInfo {
  number: number;
  par: number;
  description: string;
}

export class MainMenu {
  private el: HTMLElement;
  private panels: Record<string, HTMLElement>;

  /** Called with the 0-based hole index the user selected. */
  public onSoloStart: ((startIndex: number) => void) | null = null;

  constructor(holes: HoleInfo[]) {
    this.el = document.getElementById('main-menu')!;
    this.panels = {
      'menu-main':    document.getElementById('menu-main')!,
      'stage-select': document.getElementById('stage-select')!,
      'multi-panel':  document.getElementById('multi-panel')!,
    };

    document.getElementById('btn-solo')!.addEventListener('click',       () => this._show('stage-select'));
    document.getElementById('btn-multi')!.addEventListener('click',      () => this._show('multi-panel'));
    document.getElementById('btn-back-solo')!.addEventListener('click',  () => this._show('menu-main'));
    document.getElementById('btn-back-multi')!.addEventListener('click', () => this._show('menu-main'));

    this._buildStageGrid(holes);
  }

  show(): void {
    this.el.style.display = 'flex';
    this._show('menu-main');
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  private _show(panelId: string): void {
    for (const [id, el] of Object.entries(this.panels)) {
      el.style.display = id === panelId ? 'flex' : 'none';
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
      card.addEventListener('click', () => {
        this.hide();
        this.onSoloStart?.(idx);
      });
      grid.appendChild(card);
    });
  }
}
