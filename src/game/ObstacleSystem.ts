import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { GameConfig } from "./Config";
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
  // Moving-hazard state (movers only; static types leave amp = 0).
  isMover: boolean;
  baseX: number;
  phase: number;
  amp: number;
  // The bright warning-rim child mesh (for the approach telegraph pulse).
  rim: Mesh | null;
}

/**
 * Pooled hazards: stone blocks, fire pillars, low barriers, and side-to-side
 * movers. One source mesh per type; instances are cloned, recycled, and exposed
 * with half-extents for sphere-vs-AABB collision (design doc §15). Movers
 * oscillate in X each frame; collision reads the live mesh position so no special
 * handling is needed.
 */
export class ObstacleSystem {
  private readonly blocks: ActiveObstacle[] = [];
  private readonly pillars: ActiveObstacle[] = [];
  private readonly barriers: ActiveObstacle[] = [];
  private readonly movers: ActiveObstacle[] = [];

  private readonly blockSrc: Mesh;
  private readonly pillarSrc: Mesh;
  private readonly barrierSrc: Mesh;
  private readonly moverSrc: Mesh;

  // Shared clock driving mover oscillation.
  private time = 0;

  // Bright warning-rim material, wrapped around every hazard for readability.
  private readonly rimMat: StandardMaterial;

  constructor(
    scene: Scene,
    obstacleMat: StandardMaterial,
    hazardRimMat: StandardMaterial,
    poolPerType = 20
  ) {
    this.rimMat = hazardRimMat;

    // --- Source meshes (all share the high-contrast obstacle body material, and
    // each gets a bright rim band/shell child so pooled clones inherit it) ---
    this.blockSrc = MeshBuilder.CreateBox(
      "blockSrc",
      { width: 1.4, height: 1.2, depth: 1.4 },
      scene
    );
    this.blockSrc.material = obstacleMat;
    this.addBandRim(this.blockSrc, scene, 1.4, 1.4, 0.16);
    this.hideSource(this.blockSrc);

    // Pillar now uses the obstacle body material (was matLava, which the biome
    // system tinted to the liquid color — making pillars match the lava plane).
    this.pillarSrc = MeshBuilder.CreateCylinder(
      "pillarSrc",
      { diameter: 0.9, height: 3.2, tessellation: 12 },
      scene
    );
    this.pillarSrc.material = obstacleMat;
    this.addRingRim(this.pillarSrc, scene, 0.9, 3.2);
    this.hideSource(this.pillarSrc);

    // Low wide wall — swerve around it; leaves the other two lanes open.
    this.barrierSrc = MeshBuilder.CreateBox(
      "barrierSrc",
      { width: 1.8, height: 0.7, depth: 0.5 },
      scene
    );
    this.barrierSrc.material = obstacleMat;
    this.addBandRim(this.barrierSrc, scene, 1.8, 0.5, 0.12);
    this.hideSource(this.barrierSrc);

    // Side-to-side blocker (a chunky cube that sweeps across lanes).
    this.moverSrc = MeshBuilder.CreateBox(
      "moverSrc",
      { width: 1.3, height: 1.1, depth: 1.3 },
      scene
    );
    this.moverSrc.material = obstacleMat;
    this.addBandRim(this.moverSrc, scene, 1.3, 1.3, 0.16);
    this.hideSource(this.moverSrc);

    this.fillPool(this.blocks, this.blockSrc, "block", poolPerType, 0.7, 0.6, 0.7);
    this.fillPool(this.pillars, this.pillarSrc, "pillar", poolPerType, 0.45, 1.6, 0.45);
    this.fillPool(this.barriers, this.barrierSrc, "barrier", 16, 0.9, 0.35, 0.25);
    this.fillPool(this.movers, this.moverSrc, "mover", 8, 0.65, 0.55, 0.65);
  }

  private hideSource(m: Mesh): void {
    m.isVisible = false;
    m.isPickable = false;
  }

  /**
   * Wrap a box-bodied hazard in a bright horizontal warning stripe at mid-height
   * (slightly larger than the body so it reads as a glowing rim/outline). Named
   * "rim" so `fillPool` can grab the cloned child for the approach telegraph.
   */
  private addBandRim(
    src: Mesh,
    scene: Scene,
    width: number,
    depth: number,
    thick: number
  ): void {
    const band = MeshBuilder.CreateBox(
      `${src.name}_rim`,
      { width: width + 0.08, height: thick, depth: depth + 0.08 },
      scene
    );
    band.material = this.rimMat;
    band.parent = src;
    band.position.set(0, 0, 0); // mid-height of the body
    band.isPickable = false;
  }

  /** Bright ring rims around a pillar (top + upper-mid) for a tall danger read. */
  private addRingRim(src: Mesh, scene: Scene, diameter: number, height: number): void {
    for (const yFrac of [0.32, -0.05]) {
      const ring = MeshBuilder.CreateCylinder(
        `${src.name}_rim`,
        { diameter: diameter + 0.1, height: 0.14, tessellation: 12 },
        scene
      );
      ring.material = this.rimMat;
      ring.parent = src;
      ring.position.set(0, height * yFrac, 0);
      ring.isPickable = false;
    }
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
      // The cloned bright-rim child (first child named "*_rim"), kept for the
      // approach telegraph pulse. Its base scale is captured as (1,1,1).
      const rim =
        (mesh.getChildMeshes(false).find((c) => c.name.includes("_rim")) as
          | Mesh
          | undefined) ?? null;
      arr.push({
        mesh,
        type,
        active: false,
        nearMissed: false,
        hx,
        hy,
        hz,
        isMover: false,
        baseX: 0,
        phase: 0,
        amp: 0,
        rim,
      });
    }
  }

  private poolFor(type: ObstacleType): ActiveObstacle[] {
    switch (type) {
      case "block":
        return this.blocks;
      case "pillar":
        return this.pillars;
      case "barrier":
        return this.barriers;
      default:
        return this.movers;
    }
  }

  spawn(type: ObstacleType, x: number, z: number, groundY = 0): void {
    const pool = this.poolFor(type);
    const o = pool.find((p) => !p.active);
    if (!o) return;

    // Rest the obstacle on top of the track surface (groundY follows the slope).
    const yBase = groundY;
    let y = yBase;
    switch (type) {
      case "block":
        y = yBase + 0.6;
        break;
      case "pillar":
        y = yBase + 1.6;
        break;
      case "barrier":
        y = yBase + 0.35;
        break;
      case "mover":
        y = yBase + 0.55;
        break;
    }

    o.mesh.position.set(x, y, z);
    o.mesh.setEnabled(true);
    o.mesh.isVisible = true;
    o.active = true;
    o.nearMissed = false;
    if (o.rim) o.rim.scaling.set(1, 1, 1); // neutral until the approach telegraph

    // Movers sweep side-to-side around their spawn X with a random phase so
    // neighbours don't move in lockstep.
    o.isMover = type === "mover";
    o.baseX = x;
    o.phase = Math.random() * Math.PI * 2;
    o.amp = type === "mover" ? GameConfig.hazards.moverAmplitude : 0;
  }

  update(dt: number, ballZ: number): void {
    this.time += dt;
    this.oscillate(this.movers);
    this.telegraph(this.blocks, ballZ);
    this.telegraph(this.pillars, ballZ);
    this.telegraph(this.barriers, ballZ);
    this.telegraph(this.movers, ballZ);
    this.recycle(this.blocks, ballZ);
    this.recycle(this.pillars, ballZ);
    this.recycle(this.barriers, ballZ);
    this.recycle(this.movers, ballZ);
  }

  /**
   * Approach telegraph: swell + pulse each hazard's bright rim as it nears the
   * ball, so it "pops forward" and is spotted earlier at high speed. Pure per-mesh
   * scale on the rim child (no shared-material writes, no allocation).
   */
  private telegraph(arr: ActiveObstacle[], ballZ: number): void {
    const range = GameConfig.hazards.telegraphRange;
    for (const o of arr) {
      if (!o.active || !o.rim) continue;
      const dz = o.mesh.position.z - ballZ;
      // Only telegraph ahead of the ball, within range.
      const near = dz > 0 && dz < range ? 1 - dz / range : 0;
      // Base swell (up to +35%) plus a fast shimmer so it reads as "alive/danger".
      const pulse = near > 0 ? 1 + near * (0.35 + 0.12 * Math.sin(this.time * 9)) : 1;
      o.rim.scaling.set(pulse, pulse, pulse);
    }
  }

  /** Slide movers side-to-side; collision picks up the live position for free. */
  private oscillate(arr: ActiveObstacle[]): void {
    const w = GameConfig.hazards.moverSpeed;
    for (const o of arr) {
      if (!o.active || !o.isMover) continue;
      o.mesh.position.x = o.baseX + Math.sin(this.time * w + o.phase) * o.amp;
    }
  }

  private recycle(arr: ActiveObstacle[], ballZ: number): void {
    for (const o of arr) {
      if (o.active && o.mesh.position.z < ballZ - 12) this.release(o);
    }
  }

  private release(o: ActiveObstacle): void {
    o.active = false;
    o.isMover = false;
    o.mesh.isVisible = false;
    o.mesh.setEnabled(false);
  }

  /** Iterate all active obstacles (for the collision system). */
  forEachActive(fn: (o: ActiveObstacle) => void): void {
    for (const o of this.blocks) if (o.active) fn(o);
    for (const o of this.pillars) if (o.active) fn(o);
    for (const o of this.barriers) if (o.active) fn(o);
    for (const o of this.movers) if (o.active) fn(o);
  }

  /** Debug: world Z of every active obstacle (for behind-the-ball checks). */
  debugActiveZs(): number[] {
    const zs: number[] = [];
    this.forEachActive((o) => zs.push(Number(o.mesh.position.z.toFixed(2))));
    return zs;
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
    this.time = 0;
    this.forEachActive((o) => this.release(o));
  }
}
