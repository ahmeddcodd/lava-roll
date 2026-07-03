/**
 * GameConfig — single source of tuning truth for Lava Temple Roll.
 * Values follow the design doc §11 with a few derived helpers added.
 * Systems must read from here rather than hard-coding numbers.
 */
export const GameConfig = {
  aspect: {
    primary: "9:16",
    designWidth: 1080,
    designHeight: 1920,
  },

  performance: {
    // Crispness cap: render at the device pixel ratio, but never above this
    // multiple of CSS pixels. Keeps phones sharp while avoiding a 3x render on
    // ultra-HD screens (which would tank FPS). 1 = CSS-resolution only.
    maxMobilePixelRatio: 2,
    maxDesktopPixelRatio: 2,
    // Antialiasing smooths edges — enabled on all devices now (big clarity win).
    antialias: true,
    shadowsEnabled: false,
    bloomEnabled: false,
    maxParticlesMobile: 80,
    maxParticlesDesktop: 200,
    activeTrackChunks: 10,
  },

  player: {
    radius: 0.55,
    startSpeed: 16,
    acceleration: 0.35, // per second
    maxSpeed: 42,
    // Max lateral world-units/sec the ball may travel while steering. High enough
    // that a fast cursor flick isn't throttled — the ball keeps up with the mouse.
    steerSpeed: 40,
    // Steering responsiveness (per-second exponential smoothing rate). Higher =
    // snappier/less lag. High value tracks the pointer target almost immediately
    // while still removing raw-input jitter.
    steerResponse: 45,
    rollVisualMultiplier: 0.55,
    // Jump/air physics for coasting across gaps (values in world units).
    jump: {
      gravity: 34, // downward accel while airborne
      launchBoost: 6.5, // small upward pop when leaving a ramp edge
      maxAirTime: 2.2, // safety cap; exceeding it forces a lethal fall
    },
    // Bounce springs: touching a pad launches the ball far forward. The velocity
    // is kept under jump.maxAirTime's implied ceiling (2*v/gravity < 2.2s) so a
    // bounce never trips the lethal air-time cap.
    spring: {
      launchVelocity: 20, // ~3x the gap launchBoost — a big, safe hop
      radius: 0.9, // touch reach added to the ball radius
    },
  },

  track: {
    width: 6,
    chunkLength: 15,
    chunkThickness: 0.25,
    safeHalfWidthPadding: 0.55,
    // Continuous downhill descent (mobile-safe, ~10°). groundY(z) = -z * slopeGrade.
    slopeAngleDeg: 10,
    // How far below the local slope surface counts as "fallen" (relative death depth).
    fallDepth: 8,
    // Lateral steering bands (design doc §5.4), derived from track half width (3.0).
    edgeWarnAbsX: 2.55,
    edgeFallAbsX: 3.15,
  },

  scoring: {
    distanceMultiplier: 1,
    coinValue: 10,
    nearMissValue: 25,
    speedUpIntervalDistance: 250,
  },

  // Combo / multiplier reward loop: chaining coin pickups + near-misses raises a
  // multiplier that boosts score and escalates feedback. Decays if the chain
  // stalls, and resets on any hit.
  combo: {
    timeout: 2.4, // seconds a chain survives without a new pickup/near-miss
    maxMult: 5, // multiplier ceiling
    step: 4, // combo hits per +1 multiplier (comboMult = 1 + floor(combo/step))
    milestone: 5, // fire a celebratory beat every N combo hits
  },

  // Hazard tuning. The moving blocker oscillates side-to-side for tension; its
  // amplitude stays under LATERAL_LIMIT so a fair lane is always reachable.
  hazards: {
    moverSpeed: 1.5, // rad/s of the side-to-side sweep
    // World-x sweep. Capped at 1.7 (< one full lane) so a mover NEVER seals both
    // far edges — a full-lane-wide escape always exists on at least one side.
    moverAmplitude: 1.7,
    // Distance (world units ahead of the ball) at which a hazard's warning rim
    // begins to swell/pulse — the approach telegraph for high-speed readability.
    telegraphRange: 15,
  },

  camera: {
    portraitFov: 0.95,
    landscapeFov: 1.15,
    followHeight: 5.5,
    followDistance: -8.5, // behind the ball (ball moves +Z, camera trails at -Z offset)
    lookAhead: 9,
    followLerp: 0.08,
  },

  gameplay: {
    // Objects (idols/springs/hazards) at a world Z below this are suppressed on
    // the initial layout, so nothing sits behind or right under the stationary
    // ball (which starts at z=0) on the start screen. The track surface still
    // lays fully; only pickups/hazards in this zone are skipped.
    startClearZ: 2,
    // First N chunks after (re)start contain no lethal hazards (tutorial safety).
    safeStartChunks: 2,
    // Chunks over which difficulty ramps from easy to max (drives pickPattern).
    rampChunks: 60,
    // Seconds the "DRAG TO STEER" hint stays up on first run.
    tutorialSeconds: 3,
    // Grace period (seconds) after leaving safe ground before falling triggers.
    fallGraceSeconds: 0.12,
    // Duration of the falling state before the game-over panel shows.
    fallDelaySeconds: 1.1,
    // Near-miss detection band (world units beyond collision radius).
    nearMissRange: 1.1,
  },
} as const;

export type GameConfigType = typeof GameConfig;

/** Half the track width — the maximum |x| the surface covers. */
export const TRACK_HALF_WIDTH = GameConfig.track.width / 2;

/** Maximum |x| the ball may steer to and still be safely on the slab. */
export const LATERAL_LIMIT =
  TRACK_HALF_WIDTH - GameConfig.player.radius - 0.05;

/** World X offset for a given lane index (-1 left, 0 center, 1 right). */
export const LANE_WIDTH = GameConfig.track.width / 3;
export function laneToX(lane: number): number {
  return lane * LANE_WIDTH;
}

// --- Slope math (single source; every system reads these, never re-derives) ---

/** Downhill angle in radians. Chunk meshes rotate by this to lie on the incline. */
export const SLOPE_ANGLE_RAD = (GameConfig.track.slopeAngleDeg * Math.PI) / 180;

/** Grade = tan(angle): world units of drop per unit of forward (Z) travel. */
export const SLOPE_GRADE = Math.tan(SLOPE_ANGLE_RAD);

/**
 * Ground surface height at a given forward Z. The whole world tilts by tweaking
 * this one function. Base is 0 at z=0 and descends as z grows.
 */
export function groundYAt(z: number): number {
  return -z * SLOPE_GRADE;
}
