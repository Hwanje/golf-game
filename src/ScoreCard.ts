interface HoleResult {
  hole: number;
  par: number;
  strokes: number;
}

// Score relative to par labels
function relativeLabel(diff: number): string {
  if (diff <= -2) return 'Eagle';
  if (diff === -1) return 'Birdie';
  if (diff === 0) return 'Par';
  if (diff === 1) return 'Bogey';
  if (diff === 2) return 'Double Bogey';
  return `+${diff}`;
}

function relativeClass(diff: number): string {
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0) return '';
  if (diff === 1) return 'bogey';
  return 'double-bogey';
}

export class ScoreCard {
  private results: HoleResult[] = [];
  private currentHole = 1;
  private currentPar = 3;
  private currentStrokes = 0;

  private hudHoleInfo = document.getElementById('hole-info')!;
  private hudStrokeInfo = document.getElementById('stroke-info')!;
  private scorecardModal = document.getElementById('scorecard-modal')!;
  private scorecardBody = document.getElementById('scorecard-body')!;
  private restartBtn = document.getElementById('restart-btn')!;

  public onRestart: (() => void) | null = null;
  public onReturnMenu: (() => void) | null = null;

  constructor() {
    this.restartBtn.addEventListener('click', () => {
      this.scorecardModal.style.display = 'none';
      this.onRestart?.();
    });
    document.getElementById('menu-btn')!.addEventListener('click', () => {
      this.scorecardModal.style.display = 'none';
      this.onReturnMenu?.();
    });
  }

  startHole(holeNumber: number, par: number): void {
    this.currentHole = holeNumber;
    this.currentPar = par;
    this.currentStrokes = 0;
    this.updateHUD();
  }

  addStroke(): void {
    this.currentStrokes++;
    this.updateHUD();
  }

  // Call when ball enters hole
  recordHoleComplete(): HoleResult {
    const result: HoleResult = {
      hole: this.currentHole,
      par: this.currentPar,
      strokes: this.currentStrokes,
    };
    this.results.push(result);
    return result;
  }

  showFinalCard(): void {
    this.scorecardBody.innerHTML = '';

    let totalPar = 0;
    let totalStrokes = 0;

    for (const r of this.results) {
      const diff = r.strokes - r.par;
      totalPar += r.par;
      totalStrokes += r.strokes;
      const cls = relativeClass(diff);
      const label = relativeLabel(diff);
      const sign = diff > 0 ? `+${diff}` : `${diff}`;

      this.scorecardBody.innerHTML += `
        <tr>
          <td>${r.hole}</td>
          <td>${r.par}</td>
          <td>${r.strokes}</td>
          <td class="${cls}">${label} (${diff === 0 ? 'E' : sign})</td>
        </tr>
      `;
    }

    const totalDiff = totalStrokes - totalPar;
    const sign = totalDiff > 0 ? `+${totalDiff}` : totalDiff === 0 ? 'E' : `${totalDiff}`;
    this.scorecardBody.innerHTML += `
      <tr>
        <td>합계</td>
        <td>${totalPar}</td>
        <td>${totalStrokes}</td>
        <td>${sign}</td>
      </tr>
    `;

    this.scorecardModal.style.display = 'block';
  }

  reset(): void {
    this.results = [];
    this.currentHole = 1;
    this.currentPar = 3;
    this.currentStrokes = 0;
    this.updateHUD();
  }

  private updateHUD(): void {
    this.hudHoleInfo.textContent = `${this.currentHole} / 9  |  Par ${this.currentPar}`;
    this.hudStrokeInfo.textContent = `타수: ${this.currentStrokes}`;
  }

  getCurrentStrokes(): number { return this.currentStrokes; }
}
