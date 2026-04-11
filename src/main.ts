import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Ball } from './Ball';
import { Course } from './Course';
import { InputManager } from './InputManager';
import { ShotArrow } from './ShotArrow';
import { ScoreCard } from './ScoreCard';
import { MainMenu } from './MainMenu';

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

world.addContactMaterial(new CANNON.ContactMaterial(ballMat, groundMat, { friction: 0.55, restitution: 0.25 }));
world.addContactMaterial(new CANNON.ContactMaterial(ballMat, wallMat,   { friction: 0.2,  restitution: 0.60 }));
world.addContactMaterial(new CANNON.ContactMaterial(ballMat, bouncyMat, { friction: 0.08, restitution: 0.88 }));

// ─────────────────────────────────────────────────────────────────────────────
// Game objects
// ─────────────────────────────────────────────────────────────────────────────
const course    = new Course(scene, world, groundMat, wallMat, bouncyMat);
const scoreCard = new ScoreCard();
const shotArrow = new ShotArrow(scene);
const mainMenu  = new MainMenu(course.holes.map(h => ({
  number: h.number, par: h.par, description: h.description,
})));

let currentHoleIndex = 0;
let startHoleIndex   = 0;   // where this round started (for "restart")
let ball: Ball;
let inputManager: InputManager;
let gameState = GameState.MENU;

// Camera orbit state
let camTheta  = 0;
let camPhi    = 0.7;
let camRadius = 12;
const camTarget     = new THREE.Vector3();
const camTargetGoal = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────
// Main menu wiring
// ─────────────────────────────────────────────────────────────────────────────
mainMenu.show();

mainMenu.onSoloStart = (idx) => {
  startHoleIndex   = idx;
  currentHoleIndex = idx;
  scoreCard.reset();
  initHole(idx);
  gameState = GameState.WAITING;
};

scoreCard.onRestart = () => {
  currentHoleIndex = startHoleIndex;
  scoreCard.reset();
  initHole(startHoleIndex);
  gameState = GameState.WAITING;
};

scoreCard.onReturnMenu = () => {
  scoreCard.reset();
  gameState = GameState.MENU;
  mainMenu.show();
};

// In-game menu button (top-left corner during play)
document.getElementById('ingame-menu-btn')!.addEventListener('click', () => {
  if (gameState === GameState.MENU || gameState === GameState.GAME_OVER) return;
  shotArrow.hide();
  hidePowerMeter();
  if (inputManager) inputManager.canShoot = false;
  scoreCard.reset();
  gameState = GameState.MENU;
  mainMenu.show();
});

// ─────────────────────────────────────────────────────────────────────────────
// Init hole
// ─────────────────────────────────────────────────────────────────────────────
function initHole(index: number): void {
  const holeData = course.holes[index];
  course.buildHole(index);

  if (ball) ball.dispose();
  ball = new Ball(scene, world, holeData.startPosition, ballMat);

  if (inputManager) inputManager.destroy();
  inputManager = new InputManager(renderer.domElement, camera);

  inputManager.onShot = (input) => {
    if (gameState !== GameState.WAITING) return;
    ball.shoot(input.direction, input.power);
    scoreCard.addStroke();
    shotArrow.hide();
    inputManager.canShoot = false;
    gameState = GameState.SHOOTING;
    hidePowerMeter();
  };

  inputManager.onCameraRotate = (dTheta, dPhi) => {
    camTheta += dTheta;
    camPhi = Math.max(0.15, Math.min(Math.PI / 2 - 0.05, camPhi + dPhi));
  };

  inputManager.onCameraZoom = (delta) => {
    camRadius = Math.max(4, Math.min(22, camRadius + delta));
  };

  scoreCard.startHole(holeData.number, holeData.par);
  inputManager.canShoot = true;

  camTheta = Math.PI;
  camTargetGoal.copy(holeData.startPosition);
  camTarget.copy(holeData.startPosition);
  updateCamera();
}

// Initialise hole 0 in background so the game loop has a valid ball from the start.
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
      inputManager.canShoot = true;
      updateShotArrow();
      break;
    }

    case GameState.SHOOTING: {
      shotArrow.hide();

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
        gameState = GameState.WAITING;
        inputManager.canShoot = true;
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
