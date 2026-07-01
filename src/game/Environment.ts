import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { GameConfig, groundYAt } from "./Config";
import type { SceneManager } from "./SceneManager";

const PILLAR_SPACING = GameConfig.track.chunkLength; // one pair per chunk length
const PILLAR_COUNT = 14; // pairs, recycled ahead of the ball
const SIDE_X = GameConfig.track.width / 2 + 2.2;

// Vertical offsets of props relative to the local slope surface (groundYAt).
const PILLAR_Y_OFFSET = -3.5; // pillar base sits below the track, rising past it
const LAVA_Y_OFFSET = -12; // lava plane well below the surface
const VOLCANO_Y_OFFSET = 0; // cone base roughly at track level, far ahead
const VOLCANO_AHEAD = 90; // Z distance the volcanoes sit ahead of the ball

/**
 * Decorative volcanic surroundings (design doc §7/§12): flanking temple pillars
 * that recycle forward, a large emissive lava plane far below, and distant
 * volcano cones. Static geometry reused via clones of shared source meshes;
 * only the pillars move (recycled) so there is no per-frame allocation.
 */
export class Environment {
  private readonly root: TransformNode;
  private readonly leftPillars: Mesh[] = [];
  private readonly rightPillars: Mesh[] = [];
  private readonly lavaPlane: Mesh;
  private readonly pillarSrc: Mesh;
  private readonly volcanoes: Mesh[] = [];

  constructor(scene: Scene, sceneMgr: SceneManager) {
    this.root = new TransformNode("environment", scene);

    // Source pillar (tall box), hidden; clones are the visible props.
    this.pillarSrc = MeshBuilder.CreateBox(
      "pillarSrc_env",
      { width: 1.6, height: 9, depth: 1.6 },
      scene
    );
    this.pillarSrc.material = sceneMgr.matBackgroundTemple;
    this.pillarSrc.isVisible = false;
    this.pillarSrc.isPickable = false;

    for (let i = 0; i < PILLAR_COUNT; i++) {
      const z = i * PILLAR_SPACING;
      this.leftPillars.push(this.makePillar(-SIDE_X, z, `L${i}`));
      this.rightPillars.push(this.makePillar(SIDE_X, z, `R${i}`));
    }

    // Large emissive lava plane far below the track.
    this.lavaPlane = MeshBuilder.CreateGround(
      "lavaPlane",
      { width: 140, height: 400, subdivisions: 1 },
      scene
    );
    this.lavaPlane.material = sceneMgr.matLava;
    this.lavaPlane.position.y = groundYAt(0) + LAVA_Y_OFFSET;
    this.lavaPlane.parent = this.root;
    this.lavaPlane.isPickable = false;

    // Distant volcano silhouettes (cones), tracked ahead of the ball.
    for (const side of [-1, 1]) {
      const cone = MeshBuilder.CreateCylinder(
        `volcano${side}`,
        { diameterTop: 2, diameterBottom: 22, height: 26, tessellation: 12 },
        scene
      );
      cone.material = sceneMgr.matBackgroundTemple;
      cone.position.set(
        side * 42,
        groundYAt(VOLCANO_AHEAD) + VOLCANO_Y_OFFSET,
        VOLCANO_AHEAD
      );
      cone.parent = this.root;
      cone.isPickable = false;
      this.volcanoes.push(cone);
    }
  }

  private makePillar(x: number, z: number, tag: string): Mesh {
    const m = this.pillarSrc.clone(`pillar_${tag}`);
    m.isVisible = true;
    m.position.set(x, groundYAt(z) + PILLAR_Y_OFFSET, z);
    m.parent = this.root;
    m.isPickable = false;
    return m;
  }

  /** Recycle pillars and slide the lava plane so scenery persists endlessly. */
  update(ballZ: number): void {
    const span = PILLAR_COUNT * PILLAR_SPACING;
    for (const arr of [this.leftPillars, this.rightPillars]) {
      for (const p of arr) {
        if (p.position.z < ballZ - PILLAR_SPACING) {
          p.position.z += span;
        }
        // Keep each pillar seated on the descending slope at its own Z.
        p.position.y = groundYAt(p.position.z) + PILLAR_Y_OFFSET;
      }
    }
    // Lava plane follows the ball in Z, and descends with the ground.
    this.lavaPlane.position.z = ballZ + 40;
    this.lavaPlane.position.y = groundYAt(ballZ) + LAVA_Y_OFFSET;
    // Volcanoes stay a fixed distance ahead, tracking the slope height there.
    for (const cone of this.volcanoes) {
      cone.position.z = ballZ + VOLCANO_AHEAD;
      cone.position.y = groundYAt(cone.position.z) + VOLCANO_Y_OFFSET;
    }
  }

  reset(ballZ: number): void {
    for (let i = 0; i < PILLAR_COUNT; i++) {
      const z = ballZ + i * PILLAR_SPACING;
      this.leftPillars[i].position.z = z;
      this.leftPillars[i].position.y = groundYAt(z) + PILLAR_Y_OFFSET;
      this.rightPillars[i].position.z = z;
      this.rightPillars[i].position.y = groundYAt(z) + PILLAR_Y_OFFSET;
    }
    this.lavaPlane.position.z = ballZ + 40;
    this.lavaPlane.position.y = groundYAt(ballZ) + LAVA_Y_OFFSET;
    for (const cone of this.volcanoes) {
      cone.position.z = ballZ + VOLCANO_AHEAD;
      cone.position.y = groundYAt(cone.position.z) + VOLCANO_Y_OFFSET;
    }
  }
}
