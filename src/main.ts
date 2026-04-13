import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Ball } from './Ball';
import { Course } from './Course';
import { InputManager } from './InputManager';
import { ShotArrow } from './ShotArrow';
import { ScoreCard } from './ScoreCard';
import { MainMenu } from './MainMenu';
import { MultiplayerManager, MultiMsg } from './MultiplayerManager';

// ─────────────────────────────────────────────────────────────────────────────
// Game state
// ─────────────────────────────────────────────────────────────────────────────
const enum GameState {
  MENU,     // Main menu visible
  WAITING,  // Ball at rest, player aiming
  SHOOTING, // Ball rolling
  HOLE_IN,  // Celebrating
  GAME_OVER,// Scorecard shown
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene setup
// ─────────────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 80);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff5e0, 1.4);
sun.position.set(15, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 100;
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
sun.shadow.bias = -0.001;
scene.add(sun);

const fill = new THREE.DirectionalLight(0xb0d8ff, 0.4);
fill.position.set(-10, 10, -10);
scene.add(fill);

addSkyElements();

// ─────────────────────────────────────────────────────────────────────────────
// Physics world
// ─────────────────────────────────────────────────────────────────────────────
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;

const ballMat   = new CANNON.Material('ball');
const groundMat = new CANNON.Material('ground');
const wallMat   = new CANNON.Material('wall');
const bouncyMat = new CANNON.Material('bouncy');

let ballGroundCM = new CANNON.ContactMaterial(ballMat, groundMat, { friction: 0.55, restitution: 0.25 });
world.addContactMaterial(ballGroundCM);
world.addContactMaterial(new CANNON.ContactMaterial(ballMat, wallMat,   { friction: 0.2,  restitution: 0.60 }));
world.addContactMaterial(new CANNON.ContactMaterial(ballMat, bouncyMat, { friction: 0.08, restitution: 1.45 }));

function applyThemePhysics(theme: string): void {
  const idx = (world.contactmaterials as CANNON.ContactMaterial[]).indexOf(ballGroundCM);
  if (idx > -1) (world.contactmaterials as CANNON.ContactMaterial[]).splice(idx, 1);
  const p: Record<string, [number, number]> = { forest:[0.55,0.25], winter:[0.12,0.35], summer:[0.70,0.12] };
  const [fr, re] = p[theme] ?? p.forest;
  ballGroundCM = new CANNON.ContactMaterial(ballMat, groundMat, { friction: fr, restitution: re });
  world.addContactMaterial(ballGroundCM);
}

function applyThemeScene(theme: string): void {
  const cols: Record<string, { sky: number; fog: number; sun: number }> = {
    forest: { sky: 0x87ceeb, fog: 0x87ceeb, sun: 0xfff5e0 },
    winter: { sky: 0xbbd4e8, fog: 0xcce0f0, sun: 0xddeeff },
    summer: { sky: 0x4ab4ff, fog: 0x7ac8ff, sun: 0xfff0aa },
  };
  const c = cols[theme] ?? cols.forest;
  scene.background = new THREE.Color(c.sky);
  if (scene.fog) (scene.fog as THREE.Fog).color.setHex(c.fog);
  sun.color.setHex(c.sun);
}

// ─────────────────────────────────────────────────────────────────────────────
// Game objects
// ─────────────────────────────────────────────────────────────────────────────
const course    = new Course(scene, world, groundMat, wallMat, bouncyMat);
const scoreCard = new ScoreCard();
const shotArrow = new ShotArrow(scene);

let selectedTheme = 'forest';
const mainMenu  = new MainMenu(course.getHoles('forest').map(h => ({
  number: h.number, par: h.par, description: h.description,
})));

let currentHoleIndex = 0;
let startHoleIndex   = 0;
let ball: Ball;
let inputManager: InputManager;
let gameState = GameState.MENU;

// ── Multiplayer state ──────────────────────────────────────────────────────
let mpManager: MultiplayerManager | null = null;
let mpMode = false;
let mpMyTurn = false;
let mpMyDone = false;
let mpOpponentDone = false;
let mpOpponentStrokes = 0;
let mpOpponentHoleResults: { hole: number; par: number; strokes: number }[] = [];
let mpFrameCount = 0;
let ghostBallMesh: THREE.Mesh | null = null;

// Camera orbit state
let camTheta  = 0;
let camPhi    = 0.7;
let camRadius = 12;
const camTarget     = new THREE.Vector3();
const camTargetGoal = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────
// MP HUD elements
// ─────────────────────────────────────────────────────────────────────────────
const mpHudEl      = document.getElementById('mp-hud')!;
const mpTurnBadge  = document.getElementById('mp-turn-badge')!;
const mpOppInfoEl  = document.getElementById('mp-opp-info')!;

function updateMpHud(): void {
  if (!mpMode) { mpHudEl.style.display = 'none'; return; }
  mpHudEl.style.display = 'flex';
  if (mpMyDone && !mpOpponentDone) {
    mpTurnBadge.textContent = '⏳ 상대방 대기 중';
    mpTurnBadge.className = 'mp-turn-waiting';
  } else if (mpMyTurn && !mpMyDone) {
    mpTurnBadge.textContent = '🏌️ 내 차례';
    mpTurnBadge.className = 'mp-turn-mine';
  } else {
    mpTurnBadge.textContent = '👀 상대방 차례';
    mpTurnBadge.className = 'mp-turn-opp';
  }
  mpOppInfoEl.textContent = `상대: ${mpOpponentStrokes}타`;
}

function cleanupMp(): void {
  mpManager?.destroy();
  mpManager = null;
  mpMode = false;
  mpMyTurn = false;
  mpMyDone = false;
  mpOpponentDone = false;
  mpOpponentStrokes = 0;
  mpOpponentHoleResults = [];
  if (ghostBallMesh) { scene.remove(ghostBallMesh); ghostBallMesh = null; }
  updateMpHud();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main menu wiring
// ─────────────────────────────────────────────────────────────────────────────
mainMenu.show();

mainMenu.onThemeSelected = (theme) => {
  selectedTheme = theme;
  applyThemePhysics(theme);
  applyThemeScene(theme);
  mainMenu.rebuildStageGrid(course.getHoles(theme).map(h => ({
    number: h.number, par: h.par, description: h.description,
  })));
};

mainMenu.onSoloStart = (idx) => {
  startHoleIndex   = idx;
  currentHoleIndex = idx;
  scoreCard.reset();
  initHole(idx);
  gameState = GameState.WAITING;
};

// ── Multiplayer: host creates room ─────────────────────────────────────────
mainMenu.onMultiHost = async () => {
  if (mpManager) { mpManager.destroy(); mpManager = null; }
  mpManager = new MultiplayerManager();

  mpManager.onConnected = () => {
    mainMenu.showMultiHostStatus('연결됨! 맵 추첨 중...');
    mainMenu.hide();
    showRoulette((theme, holeIndex) => {
      selectedTheme = theme;
      applyThemePhysics(theme);
      applyThemeScene(theme);
      mpStartGame(holeIndex, theme);
    });
  };
  mpManager.onMessage = handleMpMsg;
  mpManager.onDisconnected = () => {
    if (mpMode) showMessage('⚠️ 상대방 연결이 끊겼습니다.', 4000);
  };
  mpManager.onError = (err) => {
    mainMenu.showMultiJoinError('오류: ' + err);
  };

  try {
    const code = await mpManager.createRoom();
    mainMenu.showMultiRoomCode(code);
  } catch {
    mainMenu.showMultiJoinError('방 생성에 실패했습니다. 다시 시도하세요.');
  }
};

// ── Multiplayer: guest joins room ──────────────────────────────────────────
mainMenu.onMultiJoin = async (code: string) => {
  if (mpManager) { mpManager.destroy(); mpManager = null; }
  mpManager = new MultiplayerManager();

  mpManager.onConnected = () => {
    mainMenu.showMultiJoinStatus('연결됨! 호스트 대기 중...');
  };
  mpManager.onMessage = handleMpMsg;
  mpManager.onDisconnected = () => {
    if (mpMode) showMessage('⚠️ 상대방 연결이 끊겼습니다.', 4000);
  };
  mpManager.onError = (err) => {
    mainMenu.showMultiJoinError('연결 오류: ' + err);
  };

  mainMenu.showMultiJoinStatus('연결 중...');
  try {
    await mpManager.joinRoom(code);
  } catch {
    mainMenu.showMultiJoinError('연결 실패. 코드를 확인하세요.');
  }
};

mainMenu.onMultiCancel = () => {
  mpManager?.destroy();
  mpManager = null;
};

scoreCard.onRestart = () => {
  if (mpMode) {
    // Can't restart a live MP game unilaterally — go to menu
    cleanupMp();
    scoreCard.reset();
    gameState = GameState.MENU;
    mainMenu.show();
  } else {
    currentHoleIndex = startHoleIndex;
    scoreCard.reset();
    initHole(startHoleIndex);
    gameState = GameState.WAITING;
  }
};

scoreCard.onReturnMenu = () => {
  cleanupMp();
  scoreCard.reset();
  scoreCard.closeScoreTab();
  gameState = GameState.MENU;
  mainMenu.show();
};

// In-game menu button (top-left corner during play)
document.getElementById('ingame-menu-btn')!.addEventListener('click', () => {
  if (gameState === GameState.MENU || gameState === GameState.GAME_OVER) return;
  shotArrow.hide();
  hidePowerMeter();
  if (inputManager) inputManager.canShoot = false;
  cleanupMp();
  scoreCard.reset();
  scoreCard.closeScoreTab();
  gameState = GameState.MENU;
  mainMenu.show();
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiplayer roulette
// ─────────────────────────────────────────────────────────────────────────────
const THEMES      = ['forest', 'winter', 'summer'] as const;
const THEME_ICONS: Record<string, string> = { forest: '🌲 숲', winter: '❄️ 겨울', summer: '☀️ 여름' };

function _rouletteSettle(theme: string, holeIndex: number, cb: () => void): void {
  const titleEl  = document.getElementById('rl-title')!;
  const themeVal = document.getElementById('rl-theme-val')!;
  const holeVal  = document.getElementById('rl-hole-val')!;
  const resultEl = document.getElementById('rl-result')!;
  const slotT    = document.getElementById('rl-slot-theme')!;
  const slotH    = document.getElementById('rl-slot-hole')!;

  themeVal.textContent = THEME_ICONS[theme];
  holeVal.textContent  = String(holeIndex + 1);
  titleEl.textContent  = '결정!';
  slotT.classList.add('settled');
  slotH.classList.add('settled');
  setTimeout(() => { resultEl.classList.add('show'); }, 200);

  setTimeout(() => {
    const overlay = document.getElementById('mp-roulette')!;
    overlay.style.display = 'none';
    resultEl.classList.remove('show');
    slotT.classList.remove('settled');
    slotH.classList.remove('settled');
    cb();
  }, 1800);
}

/** Host: spin roulette, pick random theme+hole, then call cb */
function showRoulette(cb: (theme: string, holeIndex: number) => void): void {
  const overlay  = document.getElementById('mp-roulette')!;
  const titleEl  = document.getElementById('rl-title')!;
  const themeVal = document.getElementById('rl-theme-val')!;
  const holeVal  = document.getElementById('rl-hole-val')!;

  const finalTheme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const finalHole  = Math.floor(Math.random() * 9);   // 0-indexed

  overlay.style.display = 'flex';
  titleEl.textContent = '맵 추첨 중...';

  let tick = 0;
  const TOTAL = 28;

  function spin(): void {
    tick++;
    themeVal.textContent = THEME_ICONS[THEMES[Math.floor(Math.random() * THEMES.length)]];
    holeVal.textContent  = String(Math.floor(Math.random() * 9) + 1);

    if (tick < TOTAL) {
      const delay = 60 + (tick > 18 ? (tick - 18) * 35 : 0);
      setTimeout(spin, delay);
    } else {
      _rouletteSettle(finalTheme, finalHole, () => cb(finalTheme, finalHole));
    }
  }
  spin();
}

/** Guest: skip spin, just show the result the host picked */
function showRouletteResult(theme: string, holeIndex: number, cb: () => void): void {
  const overlay  = document.getElementById('mp-roulette')!;
  const titleEl  = document.getElementById('rl-title')!;
  const themeVal = document.getElementById('rl-theme-val')!;
  const holeVal  = document.getElementById('rl-hole-val')!;

  overlay.style.display = 'flex';
  titleEl.textContent = '맵 결정됨!';
  themeVal.textContent = THEME_ICONS[theme] ?? theme;
  holeVal.textContent  = String(holeIndex + 1);

  _rouletteSettle(theme, holeIndex, cb);
}

// ─────────────────────────────────────────────────────────────────────────────
// Multiplayer game start / message handler
// ─────────────────────────────────────────────────────────────────────────────
function mpStartGame(holeIndex: number, theme: string): void {
  mpMode = true;
  mpMyTurn = mpManager!.isHost;   // host always shoots first
  mpMyDone = false;
  mpOpponentDone = false;
  mpOpponentStrokes = 0;
  mpOpponentHoleResults = [];
  mpFrameCount = 0;

  // Create ghost ball (opponent's visual)
  if (!ghostBallMesh) {
    const geo = new THREE.SphereGeometry(0.18, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff6600, transparent: true, opacity: 0.75, roughness: 0.3,
    });
    ghostBallMesh = new THREE.Mesh(geo, mat);
    ghostBallMesh.castShadow = false;
    scene.add(ghostBallMesh);
  }

  startHoleIndex = holeIndex;
  currentHoleIndex = holeIndex;
  scoreCard.reset();
  initHole(holeIndex);
  gameState = GameState.WAITING;

  // Host tells guest to start (includes theme so guest uses same map)
  if (mpManager!.isHost) {
    mpManager!.send({ type: 'game_start', holeIndex, theme });
  }
  updateMpHud();
}

function handleMpMsg(msg: MultiMsg): void {
  switch (msg.type) {
    case 'game_start':
      mainMenu.hide();
      selectedTheme = msg.theme;
      applyThemePhysics(msg.theme);
      applyThemeScene(msg.theme);
      showRouletteResult(msg.theme, msg.holeIndex, () => {
        mpStartGame(msg.holeIndex, msg.theme);
        mpMyTurn = false;   // guest: wait for host to shoot first
        updateMpHud();
      });
      break;

    case 'shot':
      // Opponent shot — ghost ball will follow via ball_pos updates
      break;

    case 'ball_pos':
      if (ghostBallMesh) {
        ghostBallMesh.position.set(msg.x, msg.y, msg.z);
        ghostBallMesh.visible = true;
      }
      break;

    case 'turn_end':
      mpOpponentStrokes = msg.strokes;
      mpMyTurn = true;
      if (inputManager) inputManager.canShoot = true;
      updateMpHud();
      break;

    case 'hole_done':
      mpOpponentDone = true;
      mpOpponentStrokes = msg.strokes;
      mpOpponentHoleResults.push({
        hole: course.holes[currentHoleIndex].number,
        par:  course.holes[currentHoleIndex].par,
        strokes: msg.strokes,
      });
      if (ghostBallMesh) ghostBallMesh.visible = false;
      if (mpMyDone) {
        // Both players done — host advances
        if (mpManager!.isHost) {
          setTimeout(() => mpAdvanceHole(), 1500);
        }
      } else {
        // Opponent holed in before us — grant our turn so we can finish
        mpMyTurn = true;
        if (inputManager) inputManager.canShoot = true;
        if (gameState !== GameState.SHOOTING) gameState = GameState.WAITING;
      }
      updateMpHud();
      break;

    case 'next_hole':
      // Guest syncs to next hole
      if (!mpManager!.isHost) {
        setTimeout(() => {
          messageEl.classList.remove('show');
          mpMyDone = false;
          mpOpponentDone = false;
          mpOpponentStrokes = 0;
          currentHoleIndex = msg.holeIndex;
          mpMyTurn = false;  // host always first
          if (currentHoleIndex < course.holes.length) {
            initHole(currentHoleIndex);
            gameState = GameState.WAITING;
          } else {
            gameState = GameState.GAME_OVER;
            scoreCard.showFinalCard(mpOpponentHoleResults);
          }
          updateMpHud();
        }, 500);
      }
      break;
  }
}

function mpAdvanceHole(): void {
  messageEl.classList.remove('show');
  const nextIndex = currentHoleIndex + 1;

  if (mpManager?.isHost) {
    mpManager.send({ type: 'next_hole', holeIndex: nextIndex });
  }

  mpMyDone = false;
  mpOpponentDone = false;
  mpOpponentStrokes = 0;
  currentHoleIndex = nextIndex;
  mpMyTurn = !!mpManager?.isHost;  // host always shoots first

  if (ghostBallMesh && currentHoleIndex < course.holes.length) {
    const sp = course.holes[currentHoleIndex].startPosition;
    ghostBallMesh.position.set(sp.x, sp.y, sp.z);
    ghostBallMesh.visible = true;
  }

  if (currentHoleIndex < course.holes.length) {
    initHole(currentHoleIndex);
    gameState = GameState.WAITING;
  } else {
    gameState = GameState.GAME_OVER;
    scoreCard.showFinalCard(mpOpponentHoleResults);
  }
  updateMpHud();
}

// ─────────────────────────────────────────────────────────────────────────────
// Init hole
// ─────────────────────────────────────────────────────────────────────────────
function initHole(index: number): void {
  course.buildHole(index, selectedTheme);
  const holeData = course.holes[index];

  if (ball) ball.dispose();
  ball = new Ball(scene, world, holeData.startPosition, ballMat);
  course.registerBallCollision(ball.body);

  if (inputManager) inputManager.destroy();
  inputManager = new InputManager(renderer.domElement, camera);

  inputManager.onShot = (input) => {
    if (gameState !== GameState.WAITING) return;
    if (mpMode && !mpMyTurn) return;  // not my turn
    ball.shoot(input.direction, input.power);
    scoreCard.addStroke();
    shotArrow.hide();
    inputManager.canShoot = false;
    gameState = GameState.SHOOTING;
    hidePowerMeter();
    if (mpMode) {
      mpManager!.send({ type: 'shot', dx: input.direction.x, dz: input.direction.z, power: input.power });
    }
  };

  inputManager.onCameraRotate = (dTheta, dPhi) => {
    camTheta += dTheta;
    camPhi = Math.max(0.15, Math.min(Math.PI / 2 - 0.05, camPhi + dPhi));
  };

  inputManager.onCameraZoom = (delta) => {
    camRadius = Math.max(4, Math.min(22, camRadius + delta));
  };

  scoreCard.startHole(holeData.number, holeData.par);
  inputManager.canShoot = !mpMode || mpMyTurn;

  // Position ghost ball at hole start for MP
  if (mpMode && ghostBallMesh) {
    ghostBallMesh.position.set(
      holeData.startPosition.x,
      holeData.startPosition.y,
      holeData.startPosition.z,
    );
    ghostBallMesh.visible = true;
  }

  camTheta = Math.PI;
  camTargetGoal.copy(holeData.startPosition);
  camTarget.copy(holeData.startPosition);
  updateCamera();
}

// Wire MP opponent data for live score tab
scoreCard.getMpOpponentData = () => {
  if (!mpMode) return null;
  return { strokes: mpOpponentStrokes, results: mpOpponentHoleResults };
};

// Initialise hole 0 in background so the game loop has a valid ball from the start.
applyThemePhysics('forest');
initHole(0);
gameState = GameState.MENU;

// ─────────────────────────────────────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────────────────────────────────────
function updateCamera(): void {
  const x = camTarget.x + camRadius * Math.sin(camTheta) * Math.cos(camPhi);
  const y = camRadius * Math.sin(camPhi);
  const z = camTarget.z + camRadius * Math.cos(camTheta) * Math.cos(camPhi);
  camera.position.set(x, Math.max(1.5, y), z);
  camera.lookAt(camTarget);
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────
const messageEl  = document.getElementById('message')!;
const powerMeter = document.getElementById('power-meter')!;
const powerBar   = document.getElementById('power-bar')!;

function showMessage(html: string, duration = 2800): void {
  messageEl.innerHTML = html;
  messageEl.classList.add('show');
  setTimeout(() => messageEl.classList.remove('show'), duration);
}

function showPowerMeter(power: number): void {
  powerMeter.style.display = 'block';
  powerBar.style.width = `${power * 100}%`;
}

function hidePowerMeter(): void {
  powerMeter.style.display = 'none';
  powerBar.style.width = '0%';
}

function scoreResultText(strokes: number, par: number): string {
  const diff = strokes - par;
  if (diff <= -2) return '🦅 Eagle!';
  if (diff === -1) return '🐦 Birdie!';
  if (diff === 0)  return '✅ Par!';
  if (diff === 1)  return '😅 Bogey';
  if (diff === 2)  return '😬 Double Bogey';
  return `😤 +${diff}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shot arrow update
// ─────────────────────────────────────────────────────────────────────────────
function updateShotArrow(): void {
  const ballPos   = ball.getPosition();
  const arrowOrigin = ballPos.clone().add(new THREE.Vector3(0, 0.25, 0));

  const drag = inputManager.getDrag();
  if (drag) {
    const dx   = drag.current.x - drag.start.x;
    const dy   = drag.current.y - drag.start.y;
    const dist  = Math.sqrt(dx * dx + dy * dy);
    const power = Math.min(dist / 160, 1);

    const camFwd = new THREE.Vector3();
    camera.getWorldDirection(camFwd);
    camFwd.y = 0; camFwd.normalize();
    const camRight = new THREE.Vector3().crossVectors(camFwd, new THREE.Vector3(0, 1, 0)).normalize();

    const dir = new THREE.Vector3()
      .addScaledVector(camRight, -dx)
      .addScaledVector(camFwd, dy);
    dir.y = 0;
    if (dir.lengthSq() > 0.001) dir.normalize();
    else dir.copy(camFwd);

    shotArrow.update(arrowOrigin, dir, power);
  } else if (inputManager.mode === 'desktop') {
    const power = inputManager.isChargingPower() ? inputManager.getChargePower() : 0.15;
    shotArrow.update(arrowOrigin, inputManager.getKeyboardShotDir(), power);
    if (inputManager.isChargingPower()) {
      showPowerMeter(inputManager.getChargePower());
    } else {
      hidePowerMeter();
    }
  } else {
    shotArrow.hide();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hole complete
// ─────────────────────────────────────────────────────────────────────────────
function onHoleComplete(): void {
  gameState = GameState.HOLE_IN;
  inputManager.canShoot = false;
  shotArrow.hide();

  const result     = scoreCard.recordHoleComplete();
  const resultText = scoreResultText(result.strokes, result.par);

  showMessage(`⛳ 홀인!<div class="sub">${result.strokes}타 (${resultText})</div>`, 2800);

  if (mpMode) {
    mpMyDone = true;
    mpManager!.send({ type: 'hole_done', strokes: result.strokes });
    updateMpHud();

    if (mpOpponentDone) {
      // Both done — host drives advancement
      if (mpManager!.isHost) setTimeout(() => mpAdvanceHole(), 3000);
      // Guest waits for next_hole message
    } else {
      setTimeout(() => {
        showMessage('⏳ 상대방 대기 중...', 60000);
      }, 3000);
    }
    return;
  }

  setTimeout(() => {
    currentHoleIndex++;
    if (currentHoleIndex < course.holes.length) {
      initHole(currentHoleIndex);
      gameState = GameState.WAITING;
    } else {
      gameState = GameState.GAME_OVER;
      scoreCard.showFinalCard();
    }
  }, 3000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Out of bounds
// ─────────────────────────────────────────────────────────────────────────────
let obProcessing = false;

function onOutOfBounds(): void {
  if (obProcessing) return;
  obProcessing = true;
  gameState = GameState.HOLE_IN;

  showMessage('⚠️ OB! +1 벌타', 1400);
  ball.resetToLastPosition(true);
  scoreCard.addStroke();

  setTimeout(() => {
    obProcessing = false;
    gameState = GameState.WAITING;
    inputManager.canShoot = true;
  }, 1500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Game loop
// ─────────────────────────────────────────────────────────────────────────────
let prevTime = performance.now();

function gameLoop(): void {
  requestAnimationFrame(gameLoop);

  const now   = performance.now();
  const delta = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;

  world.step(1 / 60, delta, 3);

  ball.update(delta);
  course.update(delta);
  if (inputManager) inputManager.update(delta);

  // Camera smoothly follows ball
  const bp = ball.getPosition();
  camTargetGoal.set(bp.x, 0, bp.z);
  camTarget.lerp(camTargetGoal, 0.08);
  updateCamera();

  // ── State machine ──────────────────────────────────────────────────────────
  switch (gameState) {
    case GameState.MENU:
      // Game runs in background during menu; no input processed
      break;

    case GameState.WAITING: {
      if (mpMode && (!mpMyTurn || mpMyDone)) {
        shotArrow.hide();
        inputManager.canShoot = false;
        break;
      }
      inputManager.canShoot = true;
      updateShotArrow();
      break;
    }

    case GameState.SHOOTING: {
      shotArrow.hide();

      // Broadcast ball position to opponent
      if (mpMode) {
        mpFrameCount++;
        if (mpFrameCount % 3 === 0) {
          mpManager!.send({ type: 'ball_pos', x: bp.x, y: bp.y, z: bp.z });
        }
      }

      if (!ball.isSinking) course.applySlopes(ball.body);

      if (ball.isSinking) {
        if (ball.sinkComplete) onHoleComplete();
        break;
      }

      if (course.isOutOfBounds(bp)) {
        onOutOfBounds();
        break;
      }

      if (course.checkHoleIn(bp, currentHoleIndex)) {
        ball.startSinking(course.holes[currentHoleIndex].holePosition);
        inputManager.canShoot = false;
        break;
      }

      if (ball.isAtRest()) {
        ball.saveRestPosition();
        if (mpMode) {
          if (mpOpponentDone) {
            // Opponent already holed — keep our turn, no swap needed
            inputManager.canShoot = true;
          } else {
            mpMyTurn = false;
            mpManager!.send({ type: 'turn_end', strokes: scoreCard.getCurrentStrokes() });
            inputManager.canShoot = false;
          }
          updateMpHud();
        } else {
          inputManager.canShoot = true;
        }
        gameState = GameState.WAITING;
      }
      break;
    }

    case GameState.HOLE_IN:
    case GameState.GAME_OVER:
      break;
  }

  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────────────────────
// Skybox decorations
// ─────────────────────────────────────────────────────────────────────────────
function addSkyElements(): void {
  const hillGeo = new THREE.SphereGeometry(120, 16, 8, 0, Math.PI * 2, 0, 0.3);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x5c8a5c, side: THREE.BackSide, fog: false });
  const hills   = new THREE.Mesh(hillGeo, hillMat);
  hills.position.y = -10;
  scene.add(hills);

  const treePositions = [
    [-15, 0, -5], [-18, 0, 3], [-14, 0, 10], [-20, 0, -12],
    [15, 0, -5],  [18, 0, 3],  [14, 0, 10],  [20, 0, -12],
    [-12, 0, -18],[12, 0, -18],[-8, 0, 20],  [8, 0, 20],
  ];
  const treeMat  = new THREE.MeshStandardMaterial({ color: 0x2d6a4f });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4226 });
  for (const [x, , z] of treePositions) {
    const tree = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4, 7), treeMat);
    tree.position.set(x as number, 2, z as number);
    tree.castShadow = true;
    scene.add(tree);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.2, 6), trunkMat);
    trunk.position.set(x as number, 0.6, z as number);
    scene.add(trunk);
  }

  const cloudMat       = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const cloudPositions = [[-20, 25, -30], [10, 28, -25], [30, 24, 0], [-5, 26, 40]];
  for (const [cx, cy, cz] of cloudPositions) {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const r = 2 + Math.random() * 2;
      const cloud = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), cloudMat);
      cloud.position.set((Math.random()-0.5)*6, (Math.random()-0.5)*1.5, (Math.random()-0.5)*4);
      g.add(cloud);
    }
    g.position.set(cx as number, cy as number, cz as number);
    scene.add(g);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resize handler
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
gameLoop();
