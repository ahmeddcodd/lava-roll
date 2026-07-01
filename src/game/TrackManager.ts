import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { GameConfig, TRACK_HALF_WIDTH, groundYAt } from "./Config";
import { TrackChunk } from "./TrackChunk";
import { ChunkPatterns, SAFE_PATTERNS } from "./ChunkPatterns";
import type { ChunkPattern } from "./types";
import type { SceneManager } from "./SceneManager";
import type { ObstacleSystem } from "./ObstacleSystem";
import type { CollectibleSystem } from "./CollectibleSystem";

/**
 * Endless recycled track (design doc §6). Keeps a ring of chunks laid end to end;
 * when the near chunk passes behind the ball it is moved to the front with a new,
 * difficulty-appropriate pattern. Also answers safe-ground queries for falling.
 */
export class TrackManager {
  private readonly chunks: TrackChunk[] = [];
  private readonly obstacles: ObstacleSystem;
  private readonly collectibles: CollectibleSystem;

  /** Number of chunks laid so far since (re)start — drives tutorial safety. */
  private chunksSpawned = 0;

  constructor(
    scene: Scene,
    sceneMgr: SceneManager,
    obstacles: ObstacleSystem,
    collectibles: CollectibleSystem
  ) {
    this.obstacles = obstacles;
    this.collectibles = collectibles;

    const count = GameConfig.performance.activeTrackChunks;
    for (let i = 0; i < count; i++) {
      this.chunks.push(
        new TrackChunk(
          scene,
          sceneMgr.matStoneTrack,
          sceneMgr.matStoneEdge,
          sceneMgr.matRuneBoost,
          i
        )
      );
    }
  }

  /** Lay out the initial safe runway. Call on start/reset. */
  reset(): void {
    this.chunksSpawned = 0;
    let z = -GameConfig.track.chunkLength; // one chunk behind the ball
    for (const chunk of this.chunks) {
      chunk.setEnabled(true);
      chunk.applyPattern(
        this.pickPattern(),
        z,
        this.obstacles,
        this.collectibles
      );
      z += chunk.length;
    }
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
          this.collectibles
        );
      }
    }
  }

  private frontZ(): number {
    let max = -Infinity;
    for (const c of this.chunks) if (c.endZ > max) max = c.endZ;
    return max;
  }

  /** Choose a pattern by difficulty ramp, honoring the safe-start runway. */
  private pickPattern(): ChunkPattern {
    this.chunksSpawned++;
    if (this.chunksSpawned <= GameConfig.gameplay.safeStartChunks) {
      return pick(SAFE_PATTERNS);
    }

    // Difficulty grows with distance travelled (chunks laid).
    const maxDifficulty = Math.min(3, Math.floor(this.chunksSpawned / 6));
    const candidates = ChunkPatterns.filter(
      (p) => p.difficulty <= maxDifficulty
    );

    // Bias slightly toward higher difficulty at range so it doesn't feel flat,
    // but always keep the pool fair (every pattern leaves a safe lane).
    return pick(candidates);
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
