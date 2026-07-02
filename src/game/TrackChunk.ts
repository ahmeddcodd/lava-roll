import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { GameConfig, LANE_WIDTH, laneToX, groundYAt, SLOPE_ANGLE_RAD } from "./Config";
import type { ChunkPattern, GapSpec } from "./types";
import type { ObstacleSystem } from "./ObstacleSystem";
import type { CollectibleSystem } from "./CollectibleSystem";
import type { SpringSystem } from "./SpringSystem";

const { chunkLength, chunkThickness, width } = GameConfig.track;

/**
 * A recyclable track segment. Built from three lane strips so individual lanes
 * can be hidden to form gaps (design doc §14 split_gap). Owns nothing pooled —
 * it delegates obstacle/collectible spawning to the shared systems, then records
 * its own gaps so TrackManager can answer "is the ball on safe ground?".
 */
export class TrackChunk {
  readonly root: TransformNode;
  /** World-space Z of the chunk's near (start) edge. */
  startZ = 0;
  readonly length = chunkLength;

  /** Active gaps in world space, computed on applyPattern. */
  readonly gaps: { lane: number; zStart: number; zEnd: number }[] = [];

  // Each lane has two resizable segments (before/after a gap). Unit depth boxes
  // are stretched via scaling.z so a lane can leave a precise hole for a gap.
  // laneSegments[laneIdx] = [segmentA, segmentB]; laneIdx 0 = lane -1 .. 2 = lane 1.
  private readonly laneSegments: [Mesh, Mesh][] = [];
  private readonly boostPads: Mesh[] = [];

  constructor(
    scene: Scene,
    trackMat: StandardMaterial,
    edgeMat: StandardMaterial,
    boostMat: StandardMaterial,
    laneLineMat: StandardMaterial,
    index: number
  ) {
    this.root = new TransformNode(`chunk${index}`, scene);

    // Three lanes, each with two stretchable unit-depth segments.
    const laneW = LANE_WIDTH;
    for (let li = -1; li <= 1; li++) {
      const segs: Mesh[] = [];
      for (let s = 0; s < 2; s++) {
        const seg = MeshBuilder.CreateBox(
          `chunk${index}_lane${li}_s${s}`,
          { width: laneW, height: chunkThickness, depth: 1 },
          scene
        );
        seg.material = trackMat;
        seg.position.x = laneToX(li);
        seg.parent = this.root;
        seg.isPickable = false;
        segs.push(seg);
      }
      this.laneSegments.push(segs as [Mesh, Mesh]);
    }

    // Glowing lane divider lines (between lane -1/0 and 0/1), sitting just above
    // the surface so they read as bright seams down the track.
    const lineTopY = chunkThickness / 2 + 0.015;
    for (const dx of [-0.5, 0.5]) {
      const line = MeshBuilder.CreateBox(
        `chunk${index}_line${dx}`,
        { width: 0.1, height: 0.05, depth: chunkLength },
        scene
      );
      line.material = laneLineMat;
      line.position.set(dx * laneW, lineTopY, chunkLength / 2);
      line.parent = this.root;
      line.isPickable = false;
    }

    // Center divider dashes are covered by lane lines; add a bright chunk seam
    // strip across the near edge for endless-track rhythm / speed feel.
    const seam = MeshBuilder.CreateBox(
      `chunk${index}_seam`,
      { width: width, height: 0.06, depth: 0.35 },
      scene
    );
    seam.material = laneLineMat;
    seam.position.set(0, lineTopY, 0.2);
    seam.parent = this.root;
    seam.isPickable = false;

    // Side edge rails — brighter emissive so the track boundary pops.
    const edgeH = 0.4;
    for (const side of [-1, 1]) {
      const rail = MeshBuilder.CreateBox(
        `chunk${index}_edge${side}`,
        { width: 0.3, height: edgeH, depth: chunkLength },
        scene
      );
      rail.material = edgeMat;
      rail.position.set(side * (width / 2 + 0.05), edgeH / 2 - 0.05, chunkLength / 2);
      rail.parent = this.root;
      rail.isPickable = false;
    }

    // Pre-create a couple of boost pad meshes to reuse.
    for (let i = 0; i < 2; i++) {
      const pad = MeshBuilder.CreatePlane(
        `chunk${index}_pad${i}`,
        { width: laneW * 0.9, height: 2.4 },
        scene
      );
      pad.material = boostMat;
      pad.rotation.x = Math.PI / 2; // lie flat
      pad.position.y = chunkThickness / 2 + 0.02;
      pad.parent = this.root;
      pad.isPickable = false;
      pad.setEnabled(false);
      this.boostPads.push(pad);
    }
  }

  private laneSegs(lane: number): [Mesh, Mesh] | undefined {
    return this.laneSegments[lane + 1];
  }

  /** Stretch a segment to cover local z-range [a, b]; disable if empty. */
  private setSegment(seg: Mesh, a: number, b: number): void {
    if (b - a <= 0.001) {
      seg.setEnabled(false);
      return;
    }
    seg.setEnabled(true);
    seg.scaling.z = b - a;
    seg.position.z = (a + b) / 2;
  }

  /** Lay a lane as a single full-length solid segment (no gap). */
  private setLaneFull(lane: number): void {
    const segs = this.laneSegs(lane);
    if (!segs) return;
    this.setSegment(segs[0], 0, chunkLength);
    segs[1].setEnabled(false);
  }

  /** Place this chunk at a world Z and populate it from a pattern. */
  applyPattern(
    pattern: ChunkPattern,
    startZ: number,
    obstacles: ObstacleSystem,
    collectibles: CollectibleSystem,
    springs: SpringSystem
  ): void {
    this.startZ = startZ;
    this.root.position.z = startZ;
    // Tilt the whole chunk onto the downhill slope. Position the root's local
    // origin (z=0 edge) at the slope height for startZ, then rotate about X so
    // the flat slab lies along the incline; its far (+Z) end drops correctly.
    this.root.position.y = groundYAt(startZ);
    this.root.rotation.x = SLOPE_ANGLE_RAD;

    // Reset all lanes to full-length solid, clear recorded gaps.
    this.gaps.length = 0;
    for (let li = -1; li <= 1; li++) this.setLaneFull(li);
    for (const p of this.boostPads) p.setEnabled(false);

    // Carve precise gaps: each leaves solid track before zStart and after zEnd
    // in that lane, so the hole is exactly the pattern's z-range (jumpable).
    if (pattern.gaps) {
      for (const g of pattern.gaps) {
        this.applyGap(g, startZ);
      }
    }

    if (pattern.obstacles) {
      for (const o of pattern.obstacles) {
        const wz = startZ + o.z;
        obstacles.spawn(o.type, laneToX(o.lane), wz, groundYAt(wz));
      }
    }

    if (pattern.collectibles) {
      for (const c of pattern.collectibles) {
        const wz = startZ + c.z;
        collectibles.spawn(
          laneToX(c.lane),
          groundYAt(wz) + chunkThickness / 2 + 0.6,
          wz
        );
      }
    }

    if (pattern.boostPads) {
      pattern.boostPads.forEach((b, i) => {
        const pad = this.boostPads[i];
        if (!pad) return;
        pad.position.x = laneToX(b.lane);
        pad.position.z = b.z;
        pad.setEnabled(true);
      });
    }

    if (pattern.springs) {
      for (const s of pattern.springs) {
        const wz = startZ + s.z;
        // Rest the pad flush on the slope surface (half its 0.28 height above).
        springs.spawn(laneToX(s.lane), groundYAt(wz) + chunkThickness / 2 + 0.14, wz);
      }
    }
  }

  private applyGap(g: GapSpec, startZ: number): void {
    const segs = this.laneSegs(g.lane);
    if (segs) {
      // Solid up to zStart, hole to zEnd, solid again to chunk end.
      this.setSegment(segs[0], 0, g.zStart);
      this.setSegment(segs[1], g.zEnd, chunkLength);
    }
    this.gaps.push({
      lane: g.lane,
      zStart: startZ + g.zStart,
      zEnd: startZ + g.zEnd,
    });
  }

  /** True if world position (x,z) sits over solid track in this chunk. */
  isSolidAt(x: number, z: number): boolean {
    if (z < this.startZ || z > this.startZ + this.length) return false;
    const lane = xToLane(x);
    // A gap is solid outside its precise [zStart, zEnd] world range.
    for (const g of this.gaps) {
      if (g.lane === lane && z >= g.zStart && z <= g.zEnd) return false;
    }
    return true;
  }

  /** Far (zEnd) world edge of the gap under (x,z), or null if not over a gap. */
  gapEndAt(x: number, z: number): number | null {
    if (z < this.startZ || z > this.startZ + this.length) return null;
    const lane = xToLane(x);
    for (const g of this.gaps) {
      if (g.lane === lane && z >= g.zStart && z <= g.zEnd) return g.zEnd;
    }
    return null;
  }

  get endZ(): number {
    return this.startZ + this.length;
  }

  setEnabled(on: boolean): void {
    this.root.setEnabled(on);
  }
}

/** Map a world X to the nearest lane index (-1, 0, 1). */
export function xToLane(x: number): number {
  const lane = Math.round(x / LANE_WIDTH);
  return Math.max(-1, Math.min(1, lane));
}
