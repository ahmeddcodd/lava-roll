import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import type { ObstacleType } from "./types";

export interface ActiveObstacle {
  mesh: Mesh;
  type: ObstacleType;
  active: boolean;
  // Set once the ball has scored a near miss on this obstacle (reset on spawn).
  nearMissed: boolean;
  // Half-extents for AABB collision.
  hx: number;
  hy: number;
  hz: number;
}

/**
 * Pooled hazards: stone blocks, fire pillars, and lava crack strips.
 * One source mesh per type; instances are cloned, recycled, and exposed with
 * half-extents for sphere-vs-AABB collision (design doc §15).
 */
export class ObstacleSystem {
  private readonly blocks: ActiveObstacle[] = [];
  private readonly pillars: ActiveObstacle[] = [];
  private readonly cracks: ActiveObstacle[] = [];

  private readonly blockSrc: Mesh;
  private readonly pillarSrc: Mesh;
  private readonly crackSrc: Mesh;

  constructor(
    scene: Scene,
    obstacleMat: StandardMaterial,
    lavaMat: StandardMaterial,
    poolPerType = 20
  ) {
    // --- Source meshes ---
    this.blockSrc = MeshBuilder.CreateBox(
      "blockSrc",
      { width: 1.4, height: 1.2, depth: 1.4 },
      scene
    );
    this.blockSrc.material = obstacleMat;
    this.hideSource(this.blockSrc);

    this.pillarSrc = MeshBuilder.CreateCylinder(
      "pillarSrc",
      { diameter: 0.9, height: 3.2, tessellation: 12 },
      scene
    );
    this.pillarSrc.material = lavaMat;
    this.hideSource(this.pillarSrc);

    this.crackSrc = MeshBuilder.CreateBox(
      "crackSrc",
      { width: 2.2, height: 0.12, depth: 0.7 },
      scene
    );
    this.crackSrc.material = lavaMat;
    this.hideSource(this.crackSrc);

    this.fillPool(this.blocks, this.blockSrc, "block", poolPerType, 0.7, 0.6, 0.7);
    this.fillPool(this.pillars, this.pillarSrc, "pillar", poolPerType, 0.45, 1.6, 0.45);
    this.fillPool(this.cracks, this.crackSrc, "crack", poolPerType, 1.1, 0.06, 0.35);
  }

  private hideSource(m: Mesh): void {
    m.isVisible = false;
    m.isPickable = false;
  }

  private fillPool(
    arr: ActiveObstacle[],
    src: Mesh,
    type: ObstacleType,
    n: number,
    hx: number,
    hy: number,
    hz: number
  ): void {
    for (let i = 0; i < n; i++) {
      const mesh = src.clone(`${type}${i}`);
      mesh.isVisible = false;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      arr.push({ mesh, type, active: false, nearMissed: false, hx, hy, hz });
    }
  }

  private poolFor(type: ObstacleType): ActiveObstacle[] {
    return type === "block"
      ? this.blocks
      : type === "pillar"
        ? this.pillars
        : this.cracks;
  }

  spawn(type: ObstacleType, x: number, z: number, groundY = 0): void {
    const pool = this.poolFor(type);
    const o = pool.find((p) => !p.active);
    if (!o) return;

    // Rest the obstacle on top of the track surface (groundY follows the slope).
    const yBase = groundY;
    let y = yBase;
    if (type === "block") y = yBase + 0.6;
    else if (type === "pillar") y = yBase + 1.6;
    else y = yBase + 0.07; // crack sits flush on the slab

    o.mesh.position.set(x, y, z);
    o.mesh.setEnabled(true);
    o.mesh.isVisible = true;
    o.active = true;
    o.nearMissed = false;
  }

  update(_dt: number, ballZ: number): void {
    this.recycle(this.blocks, ballZ);
    this.recycle(this.pillars, ballZ);
    this.recycle(this.cracks, ballZ);
  }

  private recycle(arr: ActiveObstacle[], ballZ: number): void {
    for (const o of arr) {
      if (o.active && o.mesh.position.z < ballZ - 12) this.release(o);
    }
  }

  private release(o: ActiveObstacle): void {
    o.active = false;
    o.mesh.isVisible = false;
    o.mesh.setEnabled(false);
  }

  /** Iterate all active obstacles (for the collision system). */
  forEachActive(fn: (o: ActiveObstacle) => void): void {
    for (const o of this.blocks) if (o.active) fn(o);
    for (const o of this.pillars) if (o.active) fn(o);
    for (const o of this.cracks) if (o.active) fn(o);
  }

  /** Sphere-vs-AABB: returns squared distance from sphere center to the box. */
  static distanceSqToBox(center: Vector3, o: ActiveObstacle): number {
    const bx = o.mesh.position.x;
    const by = o.mesh.position.y;
    const bz = o.mesh.position.z;
    const dx = Math.max(Math.abs(center.x - bx) - o.hx, 0);
    const dy = Math.max(Math.abs(center.y - by) - o.hy, 0);
    const dz = Math.max(Math.abs(center.z - bz) - o.hz, 0);
    return dx * dx + dy * dy + dz * dz;
  }

  reset(): void {
    this.forEachActive((o) => this.release(o));
  }
}
