import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { GameConfig } from "./Config";
import type { PlayerBall } from "./PlayerBall";
import { ObstacleSystem, type ActiveObstacle } from "./ObstacleSystem";
import type { CollectibleSystem } from "./CollectibleSystem";
import type { TrackManager } from "./TrackManager";

export interface CollisionResult {
  hitObstacle: boolean;
  coinsCollected: number;
  nearMiss: boolean;
  offSafeGround: boolean;
}

/**
 * Simple arcade collision (design doc §15): sphere-vs-AABB for lethal obstacles,
 * sphere distance for collectibles, safe-ground query for falling, and near-miss
 * detection (a close pass that didn't hit, or an edge ride-and-recover).
 */
export class CollisionSystem {
  private readonly obstacles: ObstacleSystem;
  private readonly collectibles: CollectibleSystem;
  private readonly track: TrackManager;

  // Near-miss bookkeeping: each obstacle rewards once via its own `nearMissed`
  // flag, cleared when the obstacle is recycled/spawned.
  private wasNearEdge = false;

  private readonly ballCenter = new Vector3();

  constructor(
    obstacles: ObstacleSystem,
    collectibles: CollectibleSystem,
    track: TrackManager
  ) {
    this.obstacles = obstacles;
    this.collectibles = collectibles;
    this.track = track;
  }

  check(ball: PlayerBall): CollisionResult {
    const result: CollisionResult = {
      hitObstacle: false,
      coinsCollected: 0,
      nearMiss: false,
      offSafeGround: false,
    };

    this.ballCenter.copyFrom(ball.position);
    const r = ball.radius;
    const rSq = r * r;
    const nearBand = GameConfig.gameplay.nearMissRange;
    const nearReach = r + nearBand;
    const nearReachSq = nearReach * nearReach;

    // --- Obstacles: lethal hit + near miss ---
    this.obstacles.forEachActive((o: ActiveObstacle) => {
      const distSq = ObstacleSystem.distanceSqToBox(this.ballCenter, o);
      if (distSq < rSq) {
        result.hitObstacle = true;
      } else if (distSq < nearReachSq && !o.nearMissed) {
        // Only count as a near miss once the ball has passed it (ahead of us).
        if (o.mesh.position.z < ball.position.z + 0.4) {
          o.nearMissed = true;
          result.nearMiss = true;
        }
      }
    });

    // --- Collectibles ---
    result.coinsCollected = this.collectibles.check(ball);

    // --- Edge ride-and-recover near miss ---
    const nearEdge = this.track.isNearEdge(ball.position);
    if (this.wasNearEdge && !nearEdge && !result.hitObstacle) {
      // Recovered from the warning band without falling.
      result.nearMiss = true;
    }
    this.wasNearEdge = nearEdge;

    // --- Falling ---
    result.offSafeGround = !this.track.isBallOnSafeTrack(ball.position);

    return result;
  }

  reset(): void {
    this.wasNearEdge = false;
  }
}
