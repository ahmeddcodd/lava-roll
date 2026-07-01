import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import type { PlayerBall } from "./PlayerBall";

const COLLECT_RADIUS = 0.85;

interface Collectible {
  mesh: Mesh;
  active: boolean;
}

/**
 * Pooled golden idols (octahedron gems). One source mesh, cloned instances that
 * spin and are recycled. Distance-based collection (design doc §15).
 */
export class CollectibleSystem {
  private readonly pool: Collectible[] = [];
  private readonly source: Mesh;

  onCollect: ((worldPos: Vector3) => void) | null = null;

  constructor(scene: Scene, goldMat: StandardMaterial, poolSize = 80) {
    // Octahedron-style diamond via a low-tessellation "polyhedron" (type 1 = octahedron).
    this.source = MeshBuilder.CreatePolyhedron(
      "idolSource",
      { type: 1, size: 0.34 },
      scene
    );
    this.source.material = goldMat;
    this.source.isVisible = false;
    this.source.isPickable = false;

    for (let i = 0; i < poolSize; i++) {
      const mesh = this.source.clone(`idol${i}`);
      mesh.isVisible = false;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.pool.push({ mesh, active: false });
    }
  }

  /** Take an idle collectible from the pool and place it in the world. */
  spawn(x: number, y: number, z: number): void {
    const c = this.acquire();
    if (!c) return;
    c.mesh.position.set(x, y, z);
    c.mesh.rotation.set(0, Math.random() * Math.PI, 0);
    c.mesh.setEnabled(true);
    c.mesh.isVisible = true;
    c.active = true;
  }

  private acquire(): Collectible | null {
    for (const c of this.pool) {
      if (!c.active) return c;
    }
    return null;
  }

  private release(c: Collectible): void {
    c.active = false;
    c.mesh.isVisible = false;
    c.mesh.setEnabled(false);
  }

  /** Spin animation + recycle anything far behind the ball. */
  update(dt: number, ballZ: number): void {
    const spin = dt * 2.2;
    for (const c of this.pool) {
      if (!c.active) continue;
      c.mesh.rotation.y += spin;
      if (c.mesh.position.z < ballZ - 12) this.release(c);
    }
  }

  /** Distance check against the ball; collects and reports position. */
  check(ball: PlayerBall): number {
    let collected = 0;
    const p = ball.position;
    const reach = ball.radius + COLLECT_RADIUS;
    const reachSq = reach * reach;
    for (const c of this.pool) {
      if (!c.active) continue;
      const dx = c.mesh.position.x - p.x;
      const dy = c.mesh.position.y - p.y;
      const dz = c.mesh.position.z - p.z;
      if (dx * dx + dy * dy + dz * dz < reachSq) {
        this.onCollect?.(c.mesh.position);
        this.release(c);
        collected++;
      }
    }
    return collected;
  }

  /** Return all active collectibles to the pool (used on reset). */
  reset(): void {
    for (const c of this.pool) {
      if (c.active) this.release(c);
    }
  }
}
