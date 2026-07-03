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
import { SpringSystem } from "./SpringSystem";
import { TrackManager } from "./TrackManager";
import { CollisionSystem } from "./CollisionSystem";
import { EffectsManager } from "./EffectsManager";
import { Environment } from "./Environment";
import { Sky } from "./Sky";
import { UIManager } from "./UIManager";
import { SaveManager } from "./SaveManager";
import { AudioManager } from "./AudioManager";
import { BallSkins, skinById } from "./Skins";
import { BiomeManager } from "./BiomeManager";
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
  private readonly springs: SpringSystem;
  private readonly track: TrackManager;
  private readonly collisions: CollisionSystem;
  private readonly effects: EffectsManager;
  private readonly environment: Environment;
  private readonly sky: Sky;
  private readonly biome: BiomeManager;
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

  // Combo reward loop: chained pickups + near-misses raise the multiplier.
  private combo = 0;
  private comboMult = 1;
  private comboTimer = 0;
  private nextComboMilestone: number = GameConfig.combo.milestone;

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

    this.ball = new PlayerBall(scene);
    this.camera = new CameraController(scene, this.ball);
    scene.activeCamera = this.camera.camera;

    this.input = new InputManager(canvas);
    this.obstacles = new ObstacleSystem(
      scene,
      this.sceneMgr.matObstacle,
      this.sceneMgr.matHazardRim
    );
    this.collectibles = new CollectibleSystem(scene, this.sceneMgr.matGold);
    this.springs = new SpringSystem(scene, this.sceneMgr.matRuneBoost);
    this.track = new TrackManager(
      scene,
      this.sceneMgr,
      this.obstacles,
      this.collectibles,
      this.springs
    );
    this.collisions = new CollisionSystem(
      this.obstacles,
      this.collectibles,
      this.track
    );
    this.effects = new EffectsManager(scene, this.isMobile);
    this.environment = new Environment(scene, this.sceneMgr);
    this.sky = new Sky(scene, this.camera.camera);
    this.biome = new BiomeManager(
      scene,
      this.sceneMgr,
      this.track,
      this.sky,
      this.effects
    );
    this.ui = new UIManager(hud);
    this.save = new SaveManager();
    this.audio = new AudioManager();

    // Equip the player's saved skin.
    this.ball.applySkin(skinById(this.save.equipped));

    this.wireEvents();
    this.refreshSkinUI();
  }

  private wireEvents(): void {
    // Collect burst + ring + SFX on pickup (combo climbs the collect pitch).
    this.collectibles.onCollect = (pos: Vector3) => {
      this.effects.collectBurst(pos);
      this.effects.ring(pos, "gold");
      this.audio.collect(this.combo); // pitch rises with the streak
      this.ui.pop("coins");
    };

    // Spring bounce: pop ring + jump SFX + a bit of camera kick and screen flash,
    // plus the translucent forward-launch "JUMP!" text over the ball.
    this.springs.onBounce = (pos: Vector3) => {
      this.effects.ring(pos, "trail");
      this.audio.jump();
      this.camera.shake(0.25, 0.3);
      this.ui.flash("cyan");
      this.ui.jump();
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

    // Announce each biome transition with a toast + a beat of color flash.
    this.biome.onBiomeChange = (name: string) => {
      this.ui.flashMessage(name, 1.4);
      this.ui.flash("cyan");
    };

    // Skin tapped in the picker: buy if needed+affordable, then equip.
    this.ui.onSkinTap = (id: string) => {
      // The picker only lives in the game-over panel. Ignore any tap that reaches
      // it in another state (defensive: a stray tap must never change the ball or
      // wallet on the Ready/Playing screen — the tap should start the run instead).
      if (this.state !== GameState.GameOver) return;
      this.audio.resume();
      const skin = skinById(id);
      if (!this.save.owns(id)) {
        if (this.save.buy(id, skin.cost)) {
          this.audio.newBest(); // celebratory unlock sting
        } else {
          this.audio.hit(); // can't afford — dull thud
          this.refreshSkinUI();
          return;
        }
      }
      this.save.equip(id);
      this.ball.applySkin(skin);
      this.audio.tap();
      this.refreshSkinUI();
    };

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

  /**
   * Debug snapshot of biome-driven state (colors + distance). Exposed only under
   * the ?debug URL flag (see main.ts) for automated verification; not used in
   * normal play. `advanceDistance` optionally forces a biome recolor at a target
   * distance without waiting for real travel.
   */
  debugBiomeState(advanceDistance?: number): Record<string, unknown> {
    if (advanceDistance !== undefined) this.biome.update(advanceDistance);
    const m = this.sceneMgr;
    const s = this.sceneMgr.scene;
    const hex = (c: { r: number; g: number; b: number }) =>
      "#" +
      [c.r, c.g, c.b]
        .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0"))
        .join("");
    return {
      distance: this.distance,
      track: hex(m.matStoneTrack.diffuseColor),
      edgeDiffuse: hex(m.matStoneEdge.diffuseColor),
      lava: hex(m.matLava.diffuseColor),
      pillar: hex(m.matBackgroundTemple.diffuseColor),
      laneLineDiffuse: hex(m.matLaneLine.diffuseColor),
      fog: hex(s.fogColor),
      clear: hex(s.clearColor),
      skyTop: hex(this.sky.debugColors().top),
      skyHorizon: hex(this.sky.debugColors().horizon),
    };
  }

  /**
   * Debug snapshot of live play/physics state. Exposed only under ?debug for
   * automated verification (spring bounces, no false game-over); not used in play.
   */
  debugPlayState(): Record<string, unknown> {
    const groundY = this.track.getTrackHeightAt(this.ball.position.z);
    return {
      state: this.state,
      distance: this.distance,
      ballY: this.ball.position.y,
      ballX: this.ball.position.x,
      groundY,
      heightAboveGround: this.ball.position.y - (groundY + this.ball.radius),
      airborne: this.ball.airborne,
      verticalVelocity: this.ball.verticalVelocity,
      gameOver: this.state === GameState.GameOver,
    };
  }

  /** Debug: drop a spring just ahead of the ball for deterministic testing. */
  debugSpawnSpringAhead(dz = 3): void {
    const z = this.ball.position.z + dz;
    // getTrackHeightAt returns the slab-top center; +0.14 rests the pad flush,
    // matching TrackChunk's spring spawn offset.
    this.springs.spawn(this.ball.position.x, this.track.getTrackHeightAt(z) + 0.14, z);
  }

  /** Debug: total active gaps (holes) across the track — should be 0. */
  debugGapCount(): number {
    return this.track.debugActiveGapCount();
  }

  /** Debug: drop a mover just ahead of the ball for deterministic testing. */
  debugSpawnMoverAhead(dz = 4): void {
    const z = this.ball.position.z + dz;
    this.obstacles.spawn("mover", 0, z, this.track.getTrackHeightAt(z));
  }

  /** Debug: line up one of each hazard type ahead of the ball (readability shot). */
  debugSpawnHazardShowcase(): void {
    const z0 = this.ball.position.z + 10;
    const specs: Array<["block" | "pillar" | "barrier" | "mover", number, number]> = [
      ["block", -2, z0],
      ["pillar", 0, z0 + 4],
      ["barrier", 2, z0 + 8],
      ["mover", -2, z0 + 12],
    ];
    for (const [type, x, z] of specs) {
      this.obstacles.spawn(type, x, z, this.track.getTrackHeightAt(z));
    }
  }

  /** Debug: current combo state (for automated verification). */
  debugComboState(): Record<string, unknown> {
    return {
      combo: this.combo,
      comboMult: this.comboMult,
      comboTimer: Number(this.comboTimer.toFixed(2)),
      score: this.score,
    };
  }

  /** Debug: snapshot of active obstacles (type + live position). */
  debugObstacleSnapshot(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    this.obstacles.forEachActive((o) => {
      out.push({
        type: o.type,
        x: Number(o.mesh.position.x.toFixed(2)),
        y: Number(o.mesh.position.y.toFixed(2)),
        z: Number(o.mesh.position.z.toFixed(2)),
        isMover: o.isMover,
      });
    });
    return out;
  }

  /** Debug: snapshot of active springs' lanes (x positions). */
  debugSpringXs(): number[] {
    return this.springs.debugActiveXs();
  }

  /** Debug: heights of active coins above their local ground (arc verification). */
  debugCollectibleHeights(): number[] {
    return this.collectibles
      .debugActiveHeights((z) => this.track.getTrackHeightAt(z))
      .map((h) => Number(h.toFixed(2)));
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
    // The player has started steering — the hint has served its purpose.
    this.ui.showTutorial(false);
    this.tutorialTimer = 0;
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
    this.resetCombo();

    this.ball.reset();
    this.ball.stickToGround(this.track.getTrackHeightAt(0));
    this.input.reset();
    this.obstacles.reset();
    this.collectibles.reset();
    this.springs.reset();
    this.collisions.reset();
    this.track.reset();
    this.biome.reset();
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
    this.biome.update(0);
    this.track.pulse(dt, 0);
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
    this.input.update(dt);
    this.ball.update(dt, this.input.steerX, this.speed);

    // World streaming.
    this.track.update(this.ball.position.z);
    this.obstacles.update(dt, this.ball.position.z);
    this.collectibles.update(dt, this.ball.position.z);
    this.springs.update(dt, this.ball.position.z);
    this.environment.update(this.ball.position.z);
    this.effects.update(this.ball, dt);

    // Combo decays if the chain stalls (no pickup/near-miss within the window).
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.resetCombo();
    }

    // Collisions / falling / near-miss. Rewards scale with the combo multiplier.
    const res = this.collisions.check(this.ball);
    if (res.coinsCollected > 0) {
      this.coins += res.coinsCollected;
      this.bumpCombo(res.coinsCollected);
      this.score +=
        res.coinsCollected * GameConfig.scoring.coinValue * this.comboMult;
    }
    if (res.nearMiss) {
      this.bumpCombo(1);
      this.score += GameConfig.scoring.nearMissValue * this.comboMult;
      this.ui.flashMessage(ThemeConfig.labels.closeCall, 0.8);
      this.ui.flash("cyan");
      this.audio.closeCall();
    }
    if (res.hitObstacle) {
      this.resetCombo();
      this.camera.shake(0.5, 0.4);
      this.ui.flash("red");
      this.audio.hit();
      this.hitStop(0.09);
      this.startFalling();
      return;
    }

    // Bounce springs: launch far forward while still grounded (check() gates on
    // !airborne, so this fires once per contact). airTimer resets like a gap-jump
    // so the air-time cap is measured from the bounce, not before it.
    if (this.springs.check(this.ball)) {
      this.ball.launch(GameConfig.player.spring.launchVelocity);
      this.airTimer = 0;
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

    // Cross-fade the world biome (lava → candy → sand → water, cycling).
    this.biome.update(this.distance);

    // Feed normalized speed to the music + lane-line pulse so both rise with speed.
    const speedNorm =
      (this.speed - GameConfig.player.startSpeed) /
      (GameConfig.player.maxSpeed - GameConfig.player.startSpeed);
    this.audio.setIntensity(speedNorm);
    this.track.pulse(dt, speedNorm);

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
    this.resetCombo();
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

  /** Extend the combo chain and recompute the multiplier. */
  private bumpCombo(n: number): void {
    const cfg = GameConfig.combo;
    this.combo += n;
    this.comboTimer = cfg.timeout;
    this.comboMult = Math.min(cfg.maxMult, 1 + Math.floor(this.combo / cfg.step));
    if (this.combo >= this.nextComboMilestone) {
      this.nextComboMilestone += cfg.milestone;
      this.onComboMilestone();
    }
    this.ui.setCombo(this.combo, this.comboMult);
  }

  /** Celebratory beat when the chain crosses a milestone. */
  private onComboMilestone(): void {
    this.effects.ring(this.ball.position, "gold");
    this.camera.pulseFov();
    this.camera.shake(0.12, 0.15);
    this.ui.flash("gold");
    this.ui.flashMessage(`x${this.comboMult} COMBO!`, 0.8);
    this.effects.speedPulse();
    this.audio.combo(this.combo);
  }

  /** Break the chain (miss timeout, hit, or run end). */
  private resetCombo(): void {
    this.combo = 0;
    this.comboMult = 1;
    this.comboTimer = 0;
    this.nextComboMilestone = GameConfig.combo.milestone;
    this.ui.setCombo(0, 1);
  }

  private endGame(): void {
    this.state = GameState.GameOver;
    const finalScore = Math.max(this.score, this.distance);
    const isNewBest = this.save.submit(finalScore);
    // Bank this run's idols into the persistent wallet (spendable on skins).
    this.save.addIdols(this.coins);
    this.ui.showGameOver(finalScore, this.coins, this.save.best, isNewBest);
    this.refreshSkinUI();
    this.audio.duckMusic();
    if (isNewBest) this.audio.newBest();
    else this.audio.gameOver();
  }

  /** Push current wallet + skin ownership/equip state into the UI picker. */
  private refreshSkinUI(): void {
    this.ui.renderSkins(
      BallSkins.map((s) => ({
        id: s.id,
        name: s.name,
        cost: s.cost,
        glow: s.glow,
        base: s.base,
        owned: this.save.owns(s.id),
        equipped: this.save.equipped === s.id,
      })),
      this.save.idols
    );
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
