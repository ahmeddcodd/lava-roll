import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import type { Scene } from "@babylonjs/core/scene";

import { GameConfig, LATERAL_LIMIT } from "./Config";
import { hexToColor3 } from "./SceneManager";
import { ThemeConfig } from "./ThemeConfig";

/**
 * The cursed relic ball. Dark stone sphere + emissive lava-crack rings
 * (design doc §8.4 Option A) + a soft transparent glow shell. Uses custom
 * arcade movement — no physics.
 */
export class PlayerBall {
  /** Positioned/scaled root (world-axis). Movement + squash live here. */
  readonly pivot: TransformNode;
  /** Rolling sphere mesh (child of pivot); only its rotation changes. */
  readonly mesh: Mesh;
  readonly radius = GameConfig.player.radius;

  private velocityX = 0;
  private velocityY = 0;
  private _airborne = false;
  private readonly rings: Mesh[] = [];
  private readonly glow: Mesh;

  // Squash & stretch: 0 = neutral. Positive = stretch (tall), negative = squash
  // (flat). Eases back to 0 each frame for springy game feel.
  private squash = 0;

  constructor(
    scene: Scene,
    stoneMat: StandardMaterial,
    crackMat: StandardMaterial
  ) {
    this.pivot = new TransformNode("ballPivot", scene);
    this.pivot.position.set(0, this.radius, 0);

    this.mesh = MeshBuilder.CreateSphere(
      "ball",
      { diameter: this.radius * 2, segments: 16 },
      scene
    );
    this.mesh.material = stoneMat;
    this.mesh.parent = this.pivot;
    this.mesh.position.set(0, 0, 0);

    // Emissive crack rings at varied orientations, parented to the ball.
    const ringDiameter = this.radius * 2.02;
    const ringThickness = this.radius * 0.12;
    const angles: [number, number, number][] = [
      [0, 0, 0],
      [Math.PI / 2, 0.3, 0],
      [0.4, 0, Math.PI / 2],
      [1.0, 0.8, 0.2],
    ];
    for (let i = 0; i < angles.length; i++) {
      const ring = MeshBuilder.CreateTorus(
        `ballRing${i}`,
        { diameter: ringDiameter, thickness: ringThickness, tessellation: 24 },
        scene
      );
      ring.material = crackMat;
      ring.rotation.set(angles[i][0], angles[i][1], angles[i][2]);
      ring.parent = this.mesh;
      ring.isPickable = false;
      this.rings.push(ring);
    }

    // Soft transparent glow shell.
    this.glow = MeshBuilder.CreateSphere(
      "ballGlow",
      { diameter: this.radius * 2.7, segments: 12 },
      scene
    );
    const glowMat = new StandardMaterial("matBallGlow", scene);
    glowMat.emissiveColor = hexToColor3(ThemeConfig.colors.lava).scale(0.9);
    glowMat.diffuseColor = new Color3(0, 0, 0);
    glowMat.specularColor = new Color3(0, 0, 0);
    glowMat.disableLighting = true;
    glowMat.alpha = 0.16;
    glowMat.backFaceCulling = false;
    this.glow.material = glowMat;
    this.glow.parent = this.mesh;
    this.glow.isPickable = false;
  }

  get position(): Vector3 {
    return this.pivot.position;
  }

  /**
   * Custom arcade movement (design doc §13). Applies steering + forward motion
   * and visual rolling. Y is set externally from the track height.
   */
  update(dt: number, steerX: number, speed: number): void {
    const targetVX = steerX * GameConfig.player.steerSpeed;
    // Frame-rate independent smoothing: reach the target quickly and consistently
    // regardless of FPS. Higher steerResponse = snappier steering.
    const t = 1 - Math.exp(-GameConfig.player.steerResponse * dt);
    this.velocityX = Scalar.Lerp(this.velocityX, targetVX, t);

    this.pivot.position.z += speed * dt;
    this.pivot.position.x += this.velocityX * dt;

    // Clamp lateral range to the track (soft — falling handled separately).
    const limit = LATERAL_LIMIT + 0.6; // allow a little overshoot for the fall
    if (this.pivot.position.x > limit) this.pivot.position.x = limit;
    if (this.pivot.position.x < -limit) this.pivot.position.x = -limit;

    // Visual rolling to sell the effect (on the child mesh, not the pivot).
    this.mesh.rotation.x += speed * dt * GameConfig.player.rollVisualMultiplier;
    this.mesh.rotation.z -= this.velocityX * dt * 0.3;

    this.updateSquash(dt);
  }

  /** Ease squash back to neutral and apply it as world-axis pivot scaling. */
  private updateSquash(dt: number): void {
    // Spring back toward 0 (neutral) with frame-rate-independent damping.
    this.squash = Scalar.Lerp(this.squash, 0, 1 - Math.exp(-12 * dt));
    // Positive squash => taller + thinner (stretch); negative => flat + wide.
    const sy = 1 + this.squash;
    const sxz = 1 - this.squash * 0.5;
    this.pivot.scaling.set(sxz, sy, sxz);
  }

  /** Trigger a squash/stretch impulse. +ve = stretch, -ve = squash. */
  private pokeSquash(amount: number): void {
    this.squash = amount;
    // Apply immediately so the very next render shows it (snappy).
    const sy = 1 + this.squash;
    const sxz = 1 - this.squash * 0.5;
    this.pivot.scaling.set(sxz, sy, sxz);
  }

  get airborne(): boolean {
    return this._airborne;
  }

  /** Current vertical velocity (negative = descending). Read-only for callers. */
  get verticalVelocity(): number {
    return this.velocityY;
  }

  /** Snap the ball onto the ground surface and clear vertical motion. */
  stickToGround(groundSurfaceY: number): void {
    // Squash impulse on the landing transition (impact scales with fall speed).
    if (this._airborne) {
      const impact = Math.min(0.35, 0.12 + Math.abs(this.velocityY) * 0.02);
      this.pokeSquash(-impact);
    }
    this.pivot.position.y = groundSurfaceY + this.radius;
    this.velocityY = 0;
    this._airborne = false;
  }

  /**
   * Leave a ramp edge into a parabolic arc. `upwardVelocity` is computed by the
   * caller from the gap length + current speed so the ball reliably clears it.
   */
  launch(upwardVelocity: number): void {
    if (this._airborne) return;
    this._airborne = true;
    this.velocityY = upwardVelocity;
    this.pokeSquash(0.28); // stretch upward as it leaps
  }

  /** Integrate the airborne arc (gravity). Call each frame while airborne. */
  integrateAir(dt: number): void {
    this.velocityY -= GameConfig.player.jump.gravity * dt;
    this.pivot.position.y += this.velocityY * dt;
  }

  /** Free-fall used during the Falling state. */
  applyFall(dt: number, fallVelocity: number): void {
    this.pivot.position.y -= fallVelocity * dt;
    this.mesh.rotation.x += dt * 4;
  }

  setY(y: number): void {
    this.pivot.position.y = y;
  }

  reset(): void {
    this.pivot.position.set(0, this.radius, 0);
    this.pivot.scaling.set(1, 1, 1);
    this.mesh.rotation.set(0, 0, 0);
    this.velocityX = 0;
    this.velocityY = 0;
    this._airborne = false;
    this.squash = 0;
  }
}
