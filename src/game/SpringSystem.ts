import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { GameConfig } from "./Config";
import type { PlayerBall } from "./PlayerBall";

interface Spring {
  mesh: Mesh;
  active: boolean;
  /** Countdown of the compress-then-release animation after a bounce (seconds). */
  squashTimer: number;
}

/**
 * Pooled bounce pads (design doc §17). A wide, low "trampoline" disc that the
 * ball rolls onto; touching it (while grounded) launches the ball high and far.
 *
 * Modeled on CollectibleSystem, with two key differences: a spring is NOT
 * consumed on contact (it stays in the world), and its `check` only fires when
 * the ball is grounded, so it can't re-trigger every frame while airborne.
 */
export class SpringSystem {
  private readonly pool: Spring[] = [];
  private readonly source: Mesh;

  onBounce: ((worldPos: Vector3) => void) | null = null;

  constructor(scene: Scene, springMat: StandardMaterial, poolSize = 16) {
    // Low, wide disc — clearly a bouncer, and visually distinct from the removed
    // flat lava strip (which spanned a lane at ground level).
    this.source = MeshBuilder.CreateCylinder(
      "springSource",
      { diameter: 1.7, height: 0.28, tessellation: 20 },
      scene
    );
    this.source.material = springMat;
    this.source.isVisible = false;
    this.source.isPickable = false;

    for (let i = 0; i < poolSize; i++) {
      const mesh = this.source.clone(`spring${i}`);
      mesh.isVisible = false;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.pool.push({ mesh, active: false, squashTimer: 0 });
    }
  }

  /** Take an idle spring from the pool and place it flush on the track surface. */
  spawn(x: number, y: number, z: number): void {
    const s = this.acquire();
    if (!s) return;
    s.mesh.position.set(x, y, z);
    s.mesh.scaling.set(1, 1, 1);
    s.mesh.setEnabled(true);
    s.mesh.isVisible = true;
    s.active = true;
    s.squashTimer = 0;
  }

  private acquire(): Spring | null {
    for (const s of this.pool) {
      if (!s.active) return s;
    }
    return null;
  }

  private release(s: Spring): void {
    s.active = false;
    s.mesh.isVisible = false;
    s.mesh.setEnabled(false);
    s.squashTimer = 0;
    s.mesh.scaling.set(1, 1, 1);
  }

  /** Animate the compress-and-release squash and recycle pads behind the ball. */
  update(dt: number, ballZ: number): void {
    for (const s of this.pool) {
      if (!s.active) continue;
      if (s.squashTimer > 0) {
        s.squashTimer = Math.max(0, s.squashTimer - dt);
        // 0..1 progress; compress flat then spring back tall for a bouncy read.
        const p = 1 - s.squashTimer / SQUASH_TIME;
        const sy = p < 0.4 ? 0.5 : 1 + (1 - p) * 0.6;
        s.mesh.scaling.set(1, sy, 1);
      }
      if (s.mesh.position.z < ballZ - 12) this.release(s);
    }
  }

  /**
   * Distance test against the ball. If the ball touches a pad WHILE GROUNDED,
   * fire `onBounce` and report true (the caller launches the ball). Pads persist.
   */
  check(ball: PlayerBall): boolean {
    if (ball.airborne) return false; // already in the air — don't re-trigger
    const p = ball.position;
    const reach = ball.radius + GameConfig.player.spring.radius;
    const reachSq = reach * reach;
    for (const s of this.pool) {
      if (!s.active) continue;
      const dx = s.mesh.position.x - p.x;
      const dy = s.mesh.position.y - p.y;
      const dz = s.mesh.position.z - p.z;
      if (dx * dx + dy * dy + dz * dz < reachSq) {
        s.squashTimer = SQUASH_TIME;
        this.onBounce?.(s.mesh.position);
        return true;
      }
    }
    return false;
  }

  /** Return all active springs to the pool (used on reset). */
  reset(): void {
    for (const s of this.pool) {
      if (s.active) this.release(s);
    }
  }

  /** Debug: X positions of active springs (for lane-variety verification). */
  debugActiveXs(): number[] {
    const xs: number[] = [];
    for (const s of this.pool) {
      if (s.active) xs.push(Number(s.mesh.position.x.toFixed(2)));
    }
    return xs;
  }
}

const SQUASH_TIME = 0.28;
