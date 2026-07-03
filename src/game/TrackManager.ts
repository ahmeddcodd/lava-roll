import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { GameConfig, TRACK_HALF_WIDTH, groundYAt } from "./Config";
import { TrackChunk } from "./TrackChunk";
import { ChunkPatterns, SAFE_PATTERNS } from "./ChunkPatterns";
import { ThemeConfig } from "./ThemeConfig";
import { hexToColor3 } from "./SceneManager";
import type { ChunkPattern } from "./types";
import type { SceneManager } from "./SceneManager";
import type { ObstacleSystem } from "./ObstacleSystem";
import type { CollectibleSystem } from "./CollectibleSystem";
import type { SpringSystem } from "./SpringSystem";

/**
 * Endless recycled track (design doc §6). Keeps a ring of chunks laid end to end;
 * when the near chunk passes behind the ball it is moved to the front with a new,
 * difficulty-appropriate pattern. Also answers safe-ground queries for falling.
 */
export class TrackManager {
  private readonly chunks: TrackChunk[] = [];
  private readonly obstacles: ObstacleSystem;
  private readonly collectibles: CollectibleSystem;
  private readonly springs: SpringSystem;
  private readonly laneLineMat: StandardMaterial;
  private pulseTime = 0;

  // Base + peak emissive colors for the lane-line speed pulse.
  private readonly lineBase: Color3;
  private readonly lineBright: Color3;

  /** Number of chunks laid so far since (re)start — drives tutorial safety. */
  private chunksSpawned = 0;

  /** Last pattern id laid, to avoid two identical chunks back-to-back. */
  private lastPatternId = "";

  constructor(
    scene: Scene,
    sceneMgr: SceneManager,
    obstacles: ObstacleSystem,
    collectibles: CollectibleSystem,
    springs: SpringSystem
  ) {
    this.laneLineMat = sceneMgr.matLaneLine;
    this.lineBase = hexToColor3(ThemeConfig.colors.lava).scale(0.85);
    this.lineBright = hexToColor3(ThemeConfig.colors.lavaBright);
    this.obstacles = obstacles;
    this.collectibles = collectibles;
    this.springs = springs;

    const count = GameConfig.performance.activeTrackChunks;
    for (let i = 0; i < count; i++) {
      this.chunks.push(
        new TrackChunk(
          scene,
          sceneMgr.matStoneTrack,
          sceneMgr.matStoneEdge,
          sceneMgr.matRuneBoost,
          sceneMgr.matLaneLine,
          i
        )
      );
    }
  }

  /** Lay out the initial safe runway. Call on start/reset. */
  reset(): void {
    this.chunksSpawned = 0;
    this.lastPatternId = "";
    let z = -GameConfig.track.chunkLength; // one chunk behind the ball
    for (const chunk of this.chunks) {
      chunk.setEnabled(true);
      chunk.applyPattern(
        this.pickPattern(),
        z,
        this.obstacles,
        this.collectibles,
        this.springs
      );
      z += chunk.length;
    }
  }

  /** Debug: total active gaps (holes) across all laid chunks. Should be 0. */
  debugActiveGapCount(): number {
    let n = 0;
    for (const chunk of this.chunks) n += chunk.gaps.length;
    return n;
  }

  /** Recycle any chunk that has scrolled behind the ball. */
  update(ballZ: number): void {
    for (const chunk of this.chunks) {
      if (chunk.endZ < ballZ - GameConfig.track.chunkLength) {
        const frontZ = this.frontZ();
        chunk.applyPattern(
          this.pickPattern(),
          frontZ,
          this.obstacles,
          this.collectibles,
          this.springs
        );
      }
    }
  }

  private frontZ(): number {
    let max = -Infinity;
    for (const c of this.chunks) if (c.endZ > max) max = c.endZ;
    return max;
  }

  /**
   * Choose a pattern along an escalating difficulty ramp. Progress `p` runs 0→1
   * over `rampChunks`; the unlocked ceiling rises with it, and selection is
   * weighted toward the current target difficulty (with a floor so easier
   * "breather" chunks still appear) rather than flat-random. Avoids repeating
   * the previous pattern for variety.
   */
  private pickPattern(): ChunkPattern {
    this.chunksSpawned++;
    if (this.chunksSpawned <= GameConfig.gameplay.safeStartChunks) {
      const p = pick(SAFE_PATTERNS);
      this.lastPatternId = p.id;
      return p;
    }

    const progress = Math.min(1, this.chunksSpawned / GameConfig.gameplay.rampChunks);
    const maxDifficulty = Math.min(4, 1 + Math.floor(progress * 4));
    const target = progress * 4; // 0 → 4 across the ramp

    let candidates = ChunkPatterns.filter((p) => p.difficulty <= maxDifficulty);
    // Prefer not to repeat the exact previous chunk (keep at least one option).
    const nonRepeat = candidates.filter((p) => p.id !== this.lastPatternId);
    if (nonRepeat.length > 0) candidates = nonRepeat;

    // Weight each candidate by closeness to the target difficulty; the 0.15 floor
    // keeps variety so it never feels like a single difficulty on repeat.
    let total = 0;
    const weights = candidates.map((p) => {
      const w = 0.15 + Math.max(0, 1 - Math.abs(p.difficulty - target) * 0.6);
      total += w;
      return w;
    });
    let r = Math.random() * total;
    let chosen = candidates[candidates.length - 1];
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        chosen = candidates[i];
        break;
      }
    }
    this.lastPatternId = chosen.id;
    return chosen;
  }

  /**
   * Falling logic (design doc §5.4 / §15). The ball is safe while it is within
   * the track's lateral bounds AND over a solid (non-gap) lane. Uses the death
   * bands from config for a small grace zone at the edges.
   */
  isBallOnSafeTrack(pos: Vector3): boolean {
    // Off the sides beyond the fall band.
    if (Math.abs(pos.x) > GameConfig.track.edgeFallAbsX) return false;

    // Over a gap?
    for (const chunk of this.chunks) {
      if (pos.z >= chunk.startZ && pos.z <= chunk.endZ) {
        return chunk.isSolidAt(pos.x, pos.z);
      }
    }
    // Between/beyond chunks (shouldn't happen mid-run) — treat as unsafe.
    return false;
  }

  /**
   * True when the ball is off the track laterally (beyond the side fall band).
   * Used to distinguish a lethal side-fall from a jumpable forward gap.
   */
  isOffSide(pos: Vector3): boolean {
    return Math.abs(pos.x) > GameConfig.track.edgeFallAbsX;
  }

  /**
   * If the ball is currently over a gap, returns the gap's far (zEnd) world edge;
   * otherwise null. Used to size a jump so it clears the remaining gap distance.
   */
  gapEndAt(pos: Vector3): number | null {
    for (const chunk of this.chunks) {
      if (pos.z >= chunk.startZ && pos.z <= chunk.endZ) {
        return chunk.gapEndAt(pos.x, pos.z);
      }
    }
    return null;
  }

  /** Whether the ball is in the edge-warning band (for near-miss/close-call). */
  isNearEdge(pos: Vector3): boolean {
    return (
      Math.abs(pos.x) > GameConfig.track.edgeWarnAbsX &&
      Math.abs(pos.x) <= TRACK_HALF_WIDTH
    );
  }

  /**
   * Set the lane-line pulse endpoints (called by BiomeManager as the biome
   * cross-fades). Copies into the existing cached Color3s so `pulse` blends
   * within the current biome's range instead of the original lava colors.
   */
  setLineColors(base: Color3, bright: Color3): void {
    this.lineBase.copyFrom(base);
    this.lineBright.copyFrom(bright);
  }

  /**
   * Animate the glowing lane lines: a base pulse that beats faster/brighter with
   * speed, for a sense of motion. Recolors one shared material (cheap).
   */
  pulse(dt: number, speedNorm: number): void {
    this.pulseTime += dt * (2.5 + speedNorm * 6);
    // 0..1 oscillation, biased brighter as speed rises.
    const wave = (Math.sin(this.pulseTime) * 0.5 + 0.5) * (0.35 + speedNorm * 0.65);
    this.laneLineMat.emissiveColor.set(
      this.lineBase.r + (this.lineBright.r - this.lineBase.r) * wave,
      this.lineBase.g + (this.lineBright.g - this.lineBase.g) * wave,
      this.lineBase.b + (this.lineBright.b - this.lineBase.b) * wave
    );
  }

  /**
   * Height of the walkable track surface at forward position z. Continuous
   * downhill descent — the slab top follows the slope. Single source of ground
   * height for the ball, camera, obstacles, collectibles, and environment.
   */
  getTrackHeightAt(z: number): number {
    return groundYAt(z) + GameConfig.track.chunkThickness / 2;
  }
}

function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}
