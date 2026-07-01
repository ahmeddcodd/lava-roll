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
    steerSpeed: 16,
    // Steering responsiveness (per-second exponential smoothing rate). Higher =
    // snappier/less lag. ~18 reaches the target lateral speed in ~150ms.
    steerResponse: 18,
    rollVisualMultiplier: 0.55,
    // Jump/air physics for coasting across gaps (values in world units).
    jump: {
      gravity: 34, // downward accel while airborne
      launchBoost: 6.5, // small upward pop when leaving a ramp edge
      maxAirTime: 2.2, // safety cap; exceeding it forces a lethal fall
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

  camera: {
    portraitFov: 0.95,
    landscapeFov: 1.15,
    followHeight: 5.5,
    followDistance: -8.5, // behind the ball (ball moves +Z, camera trails at -Z offset)
    lookAhead: 9,
    followLerp: 0.08,
  },

  gameplay: {
    // First N chunks after (re)start contain no lethal hazards (tutorial safety).
    safeStartChunks: 2,
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
