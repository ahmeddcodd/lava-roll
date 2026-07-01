import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// Side-effect imports required for the features we use.
import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/groundBuilder";
import "@babylonjs/core/Meshes/Builders/polyhedronBuilder";

import { GameConfig } from "./Config";
import { GameState } from "./types";
import { SceneManager } from "./SceneManager";
import { PlayerBall } from "./PlayerBall";
import { InputManager } from "./InputManager";
import { CameraController } from "./CameraController";
import { ObstacleSystem } from "./ObstacleSystem";
import { CollectibleSystem } from "./CollectibleSystem";
import { TrackManager } from "./TrackManager";
import { CollisionSystem } from "./CollisionSystem";
import { EffectsManager } from "./EffectsManager";
import { Environment } from "./Environment";
import { UIManager } from "./UIManager";
import { SaveManager } from "./SaveManager";
import { AudioManager } from "./AudioManager";
import { ThemeConfig } from "./ThemeConfig";

const MAX_DT = 1 / 20; // clamp delta to avoid spiral-of-death on tab return

/**
 * Top-level orchestrator: owns the engine, scene, all systems, and the finite
 * state machine (design doc §10). Drives the per-frame update and dispatches by
 * state. Handles resize (without resetting the run) and focus-loss pausing.
 */
export class Game {
  private readonly engine: Engine;
  private readonly isMobile: boolean;

  private readonly sceneMgr: SceneManager;
  private readonly ball: PlayerBall;
  private readonly input: InputManager;
  private readonly camera: CameraController;
  private readonly obstacles: ObstacleSystem;
  private readonly collectibles: CollectibleSystem;
  private readonly track: TrackManager;
  private readonly collisions: CollisionSystem;
  private readonly effects: EffectsManager;
  private readonly environment: Environment;
  private readonly ui: UIManager;
  private readonly save: SaveManager;
  private readonly audio: AudioManager;

  private state: GameState = GameState.Boot;

  // Juice: hit-stop timer freezes simulation briefly for impact.
  private hitStopTimer = 0;

  // Run state.
  private speed: number = GameConfig.player.startSpeed;
  private distance = 0;
  private coins = 0;
  private score = 0;
  private elapsed = 0;
  private tutorialTimer = 0;
  private offGroundTimer = 0;
  private fallTimer = 0;
  private airTimer = 0;
  private nextSpeedUpDistance: number = GameConfig.scoring.speedUpIntervalDistance;
  private boostTimer = 0;

  private lastTime = 0;

  constructor(canvas: HTMLCanvasElement, hud: HTMLElement) {
    this.isMobile = detectMobile();

    this.engine = new Engine(canvas, GameConfig.performance.antialias, {
      // Resolution is controlled explicitly via setHardwareScalingLevel (below),
      // so we don't let the engine also apply the raw device ratio (double-apply).
      adaptToDeviceRatio: false,
      preserveDrawingBuffer: false,
      stencil: false,
      powerPreference: "high-performance",
    });

    this.sceneMgr = new SceneManager(this.engine);
    this.sceneMgr.applyPerformanceSettings(this.engine, this.isMobile);
    const scene = this.sceneMgr.scene;

    this.ball = new PlayerBall(
      scene,
      this.sceneMgr.matBallStone,
      this.sceneMgr.matBallCrackGlow
    );
    this.camera = new CameraController(scene, this.ball);
    scene.activeCamera = this.camera.camera;

    this.input = new InputManager(canvas);
    this.obstacles = new ObstacleSystem(
      scene,
      this.sceneMgr.matObstacle,
      this.sceneMgr.matLava
    );
    this.collectibles = new CollectibleSystem(scene, this.sceneMgr.matGold);
    this.track = new TrackManager(
      scene,
      this.sceneMgr,
      this.obstacles,
      this.collectibles
    );
    this.collisions = new CollisionSystem(
      this.obstacles,
      this.collectibles,
      this.track
    );
    this.effects = new EffectsManager(scene, this.isMobile);
    this.environment = new Environment(scene, this.sceneMgr);
    this.ui = new UIManager(hud);
    this.save = new SaveManager();
    this.audio = new AudioManager();

    this.wireEvents();
  }

  private wireEvents(): void {
    // Collect burst + ring + SFX on pickup (combo climbs the collect pitch).
    this.collectibles.onCollect = (pos: Vector3) => {
      this.effects.collectBurst(pos);
      this.effects.ring(pos, "gold");
      this.audio.collect(this.coins);
      this.ui.pop("coins");
    };

    // First input starts the run and unlocks audio (needs a user gesture).
    this.input.onFirstInput = () => {
      this.audio.resume();
      this.audio.tap();
      if (this.state === GameState.Ready) this.beginPlaying();
    };

    // Retry from the game-over panel.
    this.ui.onRetry = () => {
      this.audio.resume();
      this.audio.tap();
      this.restart();
    };

    // Mute toggle from the HUD.
    this.ui.onToggleMute = () => {
      this.audio.resume();
      const muted = this.audio.toggleMute();
      this.ui.setMuted(muted);
    };
    this.ui.setMuted(this.audio.isMuted);

    // Resize: keep the run going, just re-fit engine + camera framing.
    window.addEventListener("resize", () => this.onResize());
    this.onResize();

    // Pause on focus/visibility loss (design doc §2 / §10).
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause();
      else this.resume();
    });
    window.addEventListener("blur", () => this.pause());
    window.addEventListener("focus", () => this.resume());
  }

  start(): void {
    this.enterReady();
    this.lastTime = performance.now();
    this.engine.runRenderLoop(() => this.frame());
  }

  private frame(): void {
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > MAX_DT) dt = MAX_DT; // clamp spikes (tab return, GC hitch)

    // Hit-stop: briefly freeze the simulation for impact, but keep rendering.
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      this.sceneMgr.scene.render();
      return;
    }

    switch (this.state) {
      case GameState.Ready:
        this.updateReady(dt);
        break;
      case GameState.Playing:
        this.updatePlaying(dt);
        break;
      case GameState.Falling:
        this.updateFalling(dt);
        break;
      // Paused / GameOver / Boot: render only, no simulation.
    }

    this.sceneMgr.scene.render();
  }

  // --- State transitions ---

  private enterReady(): void {
    this.state = GameState.Ready;
    this.resetRun();
    this.ui.reset();
    this.ui.showTutorial(true);
    this.tutorialTimer = GameConfig.gameplay.tutorialSeconds;
    this.input.armFirstInput();
    this.effects.startAmbient();
  }

  private beginPlaying(): void {
    this.state = GameState.Playing;
    this.audio.startMusic();
    this.audio.liftMusic();
  }

  private restart(): void {
    this.ui.hideGameOver();
    this.enterReady();
  }

  private pause(): void {
    if (this.state === GameState.Playing || this.state === GameState.Falling) {
      this.state = GameState.Paused;
      this.ui.showPaused(true);
      this.audio.duckMusic();
    }
  }

  private resume(): void {
    if (this.state === GameState.Paused) {
      // Avoid a delta spike after being hidden.
      this.lastTime = performance.now();
      this.state = GameState.Playing;
      this.ui.showPaused(false);
      this.audio.liftMusic();
    }
  }

  private resetRun(): void {
    this.speed = GameConfig.player.startSpeed;
    this.distance = 0;
    this.coins = 0;
    this.score = 0;
    this.elapsed = 0;
    this.offGroundTimer = 0;
    this.fallTimer = 0;
    this.airTimer = 0;
    this.boostTimer = 0;
    this.hitStopTimer = 0;
    this.nextSpeedUpDistance = GameConfig.scoring.speedUpIntervalDistance;

    this.ball.reset();
    this.ball.stickToGround(this.track.getTrackHeightAt(0));
    this.input.reset();
    this.obstacles.reset();
    this.collectibles.reset();
    this.collisions.reset();
    this.track.reset();
    this.environment.reset(this.ball.position.z);
    this.effects.stopAmbient();
    this.camera.snapTo(this.ball);
  }

  // --- Per-state updates ---

  private updateReady(dt: number): void {
    // Ball idles gently; scenery + effects animate. Roll slowly for life.
    this.ball.update(dt, 0, 0);
    this.ball.stickToGround(this.track.getTrackHeightAt(this.ball.position.z));
    this.effects.update(this.ball, dt);
    this.camera.update(this.ball, dt, this.speed);

    if (this.tutorialTimer > 0) {
      this.tutorialTimer -= dt;
      if (this.tutorialTimer <= 0) this.ui.showTutorial(false);
    }
  }

  private updatePlaying(dt: number): void {
    this.elapsed += dt;

    // Speed ramp (+ temporary boost from pads).
    let accel = GameConfig.player.acceleration;
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      accel *= 2.5;
    }
    this.speed = Math.min(GameConfig.player.maxSpeed, this.speed + accel * dt);

    // Move + steer (lateral + roll only; vertical handled below).
    this.input.update();
    this.ball.update(dt, this.input.steerX, this.speed);

    // World streaming.
    this.track.update(this.ball.position.z);
    this.obstacles.update(dt, this.ball.position.z);
    this.collectibles.update(dt, this.ball.position.z);
    this.environment.update(this.ball.position.z);
    this.effects.update(this.ball, dt);

    // Collisions / falling / near-miss.
    const res = this.collisions.check(this.ball);
    if (res.coinsCollected > 0) {
      this.coins += res.coinsCollected;
      this.score += res.coinsCollected * GameConfig.scoring.coinValue;
    }
    if (res.nearMiss) {
      this.score += GameConfig.scoring.nearMissValue;
      this.ui.flashMessage(ThemeConfig.labels.closeCall, 0.8);
      this.ui.flash("cyan");
      this.audio.closeCall();
    }
    if (res.hitObstacle) {
      this.camera.shake(0.5, 0.4);
      this.ui.flash("red");
      this.audio.hit();
      this.hitStop(0.09);
      this.startFalling();
      return;
    }

    // --- Vertical: roll down the slope, coast across gaps, land on next slope ---
    const groundSurfaceY = this.track.getTrackHeightAt(this.ball.position.z);
    const onSafe = !res.offSafeGround;
    const offSide = this.track.isOffSide(this.ball.position);
    const jump = GameConfig.player.jump;

    if (offSide) {
      // Off the side of the track is always a lethal fall (short grace).
      this.offGroundTimer += dt;
      if (this.offGroundTimer > GameConfig.gameplay.fallGraceSeconds) {
        this.startFalling();
        return;
      }
    } else {
      this.offGroundTimer = 0;
    }

    if (this.ball.airborne) {
      this.airTimer += dt;
      this.ball.integrateAir(dt);

      const landHeight = groundSurfaceY + this.ball.radius;
      const droppedTooFar =
        this.ball.position.y < groundSurfaceY - GameConfig.track.fallDepth;

      if (onSafe && this.ball.verticalVelocity <= 0 && this.ball.position.y <= landHeight) {
        // Descending onto solid slope — resume rolling, small landing thud.
        this.ball.stickToGround(groundSurfaceY);
        this.airTimer = 0;
        this.camera.shake(0.18, 0.22);
        this.audio.land();
        this.effects.ring(this.ball.position, "trail");
      } else if (droppedTooFar || this.airTimer > jump.maxAirTime) {
        // Missed the landing (real hole / overshoot) — lethal.
        this.startFalling();
        return;
      }
    } else if (onSafe && !offSide) {
      // Grounded on solid track — stick to the descending surface.
      this.ball.stickToGround(groundSurfaceY);
    } else if (!offSide) {
      // Ran off the near edge of a gap while grounded — launch a jump sized to
      // clear the remaining gap distance (plus a small margin) at current speed.
      const gapEnd = this.track.gapEndAt(this.ball.position);
      const remaining =
        gapEnd !== null
          ? gapEnd - this.ball.position.z + 1.2
          : GameConfig.track.chunkLength * 0.5;
      const airTime = remaining / Math.max(1, this.speed);
      // Projectile apex: v0 = g*t/2 returns to launch height after `airTime`.
      // The slope makes the landing lower, so this comfortably clears the gap.
      const v0 = Math.max(jump.launchBoost, (jump.gravity * airTime) / 2);
      this.ball.launch(v0);
      this.airTimer = 0;
      this.audio.jump();
    }

    // Scoring / speed-up milestones.
    this.distance = Math.max(
      0,
      Math.floor(this.ball.position.z * GameConfig.scoring.distanceMultiplier)
    );
    this.score = Math.max(this.score, this.distance);
    if (this.distance >= this.nextSpeedUpDistance) {
      this.nextSpeedUpDistance += GameConfig.scoring.speedUpIntervalDistance;
      this.onSpeedUp();
    }

    // Feed normalized speed to the music so it rises with velocity.
    const speedNorm =
      (this.speed - GameConfig.player.startSpeed) /
      (GameConfig.player.maxSpeed - GameConfig.player.startSpeed);
    this.audio.setIntensity(speedNorm);

    this.camera.update(this.ball, dt, this.speed);
    this.ui.update(this.distance, this.coins, dt);
  }

  /** Freeze the simulation briefly for impact (keeps rendering). */
  private hitStop(seconds: number): void {
    this.hitStopTimer = Math.max(this.hitStopTimer, seconds);
  }

  private updateFalling(dt: number): void {
    this.fallTimer += dt;
    this.ball.applyFall(dt, 9 + this.fallTimer * 8);
    this.camera.update(this.ball, dt, this.speed);
    this.effects.update(this.ball, dt);
    if (this.fallTimer >= GameConfig.gameplay.fallDelaySeconds) {
      this.endGame();
    }
  }

  private startFalling(): void {
    if (this.state !== GameState.Playing) return;
    this.state = GameState.Falling;
    this.fallTimer = 0;
    this.effects.stopAmbient();
    this.audio.fall();
    this.audio.duckMusic();
  }

  private onSpeedUp(): void {
    this.ui.flashMessage(ThemeConfig.labels.speedUp, 1.0);
    this.ui.flash("gold");
    this.ui.pop("distance");
    this.camera.pulseFov();
    this.effects.speedPulse();
    this.audio.speedUp();
  }

  private endGame(): void {
    this.state = GameState.GameOver;
    const finalScore = Math.max(this.score, this.distance);
    const isNewBest = this.save.submit(finalScore);
    this.ui.showGameOver(finalScore, this.coins, this.save.best, isNewBest);
    this.audio.duckMusic();
    if (isNewBest) this.audio.newBest();
    else this.audio.gameOver();
  }

  private onResize(): void {
    // Re-apply DPR-capped resolution first (DPR can change across displays),
    // then resize the engine so the backbuffer matches the new sharp target.
    this.sceneMgr.applyPerformanceSettings(this.engine, this.isMobile);
    this.engine.resize();
    this.input.updateDragRange();
    const aspect = this.engine.getRenderWidth() / this.engine.getRenderHeight();
    this.camera.reframe(aspect);
  }

  dispose(): void {
    this.input.dispose();
    this.effects.dispose();
    this.audio.dispose();
    this.sceneMgr.dispose();
    this.engine.dispose();
  }
}

function detectMobile(): boolean {
  const ua = navigator.userAgent || "";
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || coarse;
}
