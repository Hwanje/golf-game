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

  private hudHoleInfo   = document.getElementById('hole-info')!;
  private hudStrokeInfo = document.getElementById('stroke-info')!;
  private scorecardModal = document.getElementById('scorecard-modal')!;
  private scorecardBody  = document.getElementById('scorecard-body')!;
  private restartBtn     = document.getElementById('restart-btn')!;

  // Live score tab
  private scoreTabPanel  = document.getElementById('score-tab-panel')!;
  private scoreTabBtn    = document.getElementById('score-tab-btn')!;
  private scoreTabHead   = document.getElementById('score-tab-head')!;
  private scoreTabBody   = document.getElementById('score-tab-body')!;
  private scoreTabOpen   = false;

  public onRestart: (() => void) | null = null;
  public onReturnMenu: (() => void) | null = null;
  /** Optional: provide this to include opponent data in the live tab. */
  public getMpOpponentData: (() => { strokes: number; results: { hole: number; par: number; strokes: number }[] } | null) | null = null;

  constructor() {
    this.restartBtn.addEventListener('click', () => {
      this.scorecardModal.style.display = 'none';
      this.onRestart?.();
    });
    document.getElementById('menu-btn')!.addEventListener('click', () => {
      this.scorecardModal.style.display = 'none';
      this.onReturnMenu?.();
    });
    this.scoreTabBtn.addEventListener('click', () => this.toggleScoreTab());
  }

  toggleScoreTab(): void {
    if (this.scoreTabOpen) {
      this.scoreTabPanel.style.display = 'none';
      this.scoreTabBtn.classList.remove('active');
      this.scoreTabOpen = false;
    } else {
      this._refreshScoreTab();
      this.scoreTabPanel.style.display = 'block';
      this.scoreTabBtn.classList.add('active');
      this.scoreTabOpen = true;
    }
  }

  closeScoreTab(): void {
    this.scoreTabPanel.style.display = 'none';
    this.scoreTabBtn.classList.remove('active');
    this.scoreTabOpen = false;
  }

  private _refreshScoreTab(): void {
    const oppData = this.getMpOpponentData?.();
    const isMP = !!oppData;

    // Header
    if (isMP) {
      this.scoreTabHead.innerHTML = '<th>홀</th><th>파</th><th>나</th><th>상대</th><th>결과</th>';
    } else {
      this.scoreTabHead.innerHTML = '<th>홀</th><th>파</th><th>타수</th><th>결과</th>';
    }

    this.scoreTabBody.innerHTML = '';
    let totalPar = 0, totalStrokes = 0, oppTotal = 0;

    // Completed holes
    for (const r of this.results) {
      const diff = r.strokes - r.par;
      totalPar     += r.par;
      totalStrokes += r.strokes;
      const cls   = relativeClass(diff);
      const label = relativeLabel(diff);
      const sign  = diff > 0 ? `+${diff}` : diff === 0 ? 'E' : `${diff}`;

      if (isMP) {
        const opp = oppData!.results.find(o => o.hole === r.hole);
        const oppStr = opp ? opp.strokes : '-';
        oppTotal += opp?.strokes ?? 0;
        this.scoreTabBody.innerHTML += `<tr>
          <td>${r.hole}</td><td>${r.par}</td><td>${r.strokes}</td>
          <td>${oppStr}</td><td class="${cls}">${sign}</td></tr>`;
      } else {
        this.scoreTabBody.innerHTML += `<tr>
          <td>${r.hole}</td><td>${r.par}</td><td>${r.strokes}</td>
          <td class="${cls}">${label} (${sign})</td></tr>`;
      }
    }

    // Current hole in progress (if any strokes taken)
    if (this.currentStrokes > 0) {
      if (isMP) {
        this.scoreTabBody.innerHTML += `<tr class="current-hole">
          <td>${this.currentHole}</td><td>${this.currentPar}</td>
          <td>${this.currentStrokes}</td><td>${oppData!.strokes || '-'}</td><td>진행 중</td></tr>`;
      } else {
        this.scoreTabBody.innerHTML += `<tr class="current-hole">
          <td>${this.currentHole}</td><td>${this.currentPar}</td>
          <td>${this.currentStrokes}</td><td>진행 중</td></tr>`;
      }
      totalStrokes += this.currentStrokes;
      totalPar     += this.currentPar;
    }

    // Totals row
    if (totalPar > 0) {
      const totalDiff = totalStrokes - totalPar;
      const sign = totalDiff > 0 ? `+${totalDiff}` : totalDiff === 0 ? 'E' : `${totalDiff}`;
      if (isMP) {
        oppTotal += oppData!.strokes || 0;
        this.scoreTabBody.innerHTML += `<tr class="total-row">
          <td>합계</td><td>${totalPar}</td><td>${totalStrokes}</td>
          <td>${oppTotal || '-'}</td><td>${sign}</td></tr>`;
      } else {
        this.scoreTabBody.innerHTML += `<tr class="total-row">
          <td>합계</td><td>${totalPar}</td><td>${totalStrokes}</td>
          <td>${sign}</td></tr>`;
      }
    }
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
    if (this.scoreTabOpen) this._refreshScoreTab();
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

  showFinalCard(opponentResults?: { hole: number; par: number; strokes: number }[]): void {
    this.scorecardBody.innerHTML = '';
    const isMP = !!opponentResults && opponentResults.length > 0;

    // Update thead
    const thead = this.scorecardModal.querySelector('thead tr')!;
    if (isMP) {
      thead.innerHTML = '<th>홀</th><th>파</th><th>나</th><th>상대</th><th>결과</th>';
    } else {
      thead.innerHTML = '<th>홀</th><th>파</th><th>타수</th><th>결과</th>';
    }

    let totalPar = 0;
    let totalStrokes = 0;
    let oppTotal = 0;

    for (const r of this.results) {
      const diff = r.strokes - r.par;
      totalPar += r.par;
      totalStrokes += r.strokes;
      const cls = relativeClass(diff);
      const label = relativeLabel(diff);
      const sign = diff > 0 ? `+${diff}` : `${diff}`;

      if (isMP) {
        const opp = opponentResults!.find(o => o.hole === r.hole);
        const oppStr = opp ? opp.strokes : '-';
        oppTotal += opp?.strokes ?? 0;
        this.scorecardBody.innerHTML += `
          <tr>
            <td>${r.hole}</td>
            <td>${r.par}</td>
            <td>${r.strokes}</td>
            <td>${oppStr}</td>
            <td class="${cls}">${label} (${diff === 0 ? 'E' : sign})</td>
          </tr>
        `;
      } else {
        this.scorecardBody.innerHTML += `
          <tr>
            <td>${r.hole}</td>
            <td>${r.par}</td>
            <td>${r.strokes}</td>
            <td class="${cls}">${label} (${diff === 0 ? 'E' : sign})</td>
          </tr>
        `;
      }
    }

    const totalDiff = totalStrokes - totalPar;
    const sign = totalDiff > 0 ? `+${totalDiff}` : totalDiff === 0 ? 'E' : `${totalDiff}`;

    if (isMP) {
      const verdict = totalStrokes < oppTotal ? '🏆 승리!'
                    : totalStrokes > oppTotal ? '패배'
                    : '무승부';
      this.scorecardBody.innerHTML += `
        <tr>
          <td>합계</td>
          <td>${totalPar}</td>
          <td>${totalStrokes}</td>
          <td>${oppTotal}</td>
          <td>${sign} · ${verdict}</td>
        </tr>
      `;
    } else {
      this.scorecardBody.innerHTML += `
        <tr>
          <td>합계</td>
          <td>${totalPar}</td>
          <td>${totalStrokes}</td>
          <td>${sign}</td>
        </tr>
      `;
    }

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
