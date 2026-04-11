# CLAUDE.md

## Commands

```bash
npm run dev      # dev server at localhost:5173
npm run build    # production build → dist/
npm run preview  # serve dist/
```

## Stack

Three.js · Cannon-es · TypeScript · Vite

## Files

| File | Role |
|------|------|
| `src/main.ts` | Scene, physics world, game loop, state machine (MENU/WAITING/SHOOTING/HOLE_IN/GAME_OVER) |
| `src/MainMenu.ts` | Main menu overlay: Solo/Multi mode select + 9-hole stage select grid |
| `src/Course.ts` | 9 holes: split-ground physical cups, walls, slopes, rotating bars, bouncy bumpers |
| `src/Ball.ts` | Physics body + mesh; shoot(), sinking animation, OB reset |
| `src/InputManager.ts` | Touch (drag=aim, 2-finger=camera) and desktop (mouse/keyboard) input |
| `src/ShotArrow.ts` | Aiming arrow + trajectory dots (depthTest=false, green→red with power) |
| `src/ScoreCard.ts` | HUD, hole-complete messages, final scorecard modal |

## Key Mechanics

- **Physical cup**: ground split into 4 CANNON.Box pieces leaving a gap; hole-in = ball y < −0.12 AND horiz < 0.50
- **Slopes**: per-frame `applyForce` when ball inside rectangular SlopeZone
- **Rotating obstacles**: CANNON.Body.KINEMATIC with angularVelocity; mesh synced from body quaternion
- **Bouncy bumpers**: separate `bouncyMat` (restitution 0.88)
- **OB**: horizontal bounds check; y < −3 skipped while ball sinks into cup
