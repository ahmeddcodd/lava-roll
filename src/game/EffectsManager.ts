import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

import { GameConfig } from "./Config";
import { ThemeConfig } from "./ThemeConfig";
import { hexToColor3 } from "./SceneManager";
import type { PlayerBall } from "./PlayerBall";

interface Ring {
  mesh: Mesh;
  mat: StandardMaterial;
  life: number; // remaining seconds
  maxLife: number;
  active: boolean;
}

/**
 * Lightweight fake-glow effects (design doc §17): a ball trail, low-count embers,
 * a collect burst, a speed-up pulse, and a fall splash. All particle counts
 * respect the mobile cap. A single procedural soft-dot texture is shared.
 */
export class EffectsManager {
  private readonly scene: Scene;
  private readonly softDot: DynamicTexture;
  private readonly emitterNode: TransformNode;

  private readonly trail: ParticleSystem;
  private readonly embers: ParticleSystem;
  private readonly burst: ParticleSystem;

  // Pooled expanding glow rings (pickup / landing pops).
  private readonly rings: Ring[] = [];

  private readonly maxParticles: number;

  // Reused target for the burst emitter.
  private readonly burstPos = new Vector3();

  constructor(scene: Scene, isMobile: boolean) {
    this.scene = scene;
    this.maxParticles = isMobile
      ? GameConfig.performance.maxParticlesMobile
      : GameConfig.performance.maxParticlesDesktop;

    this.softDot = this.makeSoftDotTexture();

    // Node that trails the ball; the trail particle system emits from here.
    this.emitterNode = new TransformNode("fxEmitter", scene);

    this.trail = this.makeTrail();
    this.embers = this.makeEmbers();
    this.burst = this.makeBurst();
    this.makeRingPool();
  }

  private makeRingPool(): void {
    for (let i = 0; i < 6; i++) {
      const mesh = MeshBuilder.CreateTorus(
        `fxRing${i}`,
        { diameter: 1, thickness: 0.12, tessellation: 20 },
        this.scene
      );
      mesh.rotation.x = Math.PI / 2; // lie flat, facing up
      mesh.isPickable = false;
      mesh.setEnabled(false);
      const mat = new StandardMaterial(`fxRingMat${i}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = hexToColor3(ThemeConfig.gameplay.trailColor);
      mat.alpha = 1;
      mat.backFaceCulling = false;
      mesh.material = mat;
      this.rings.push({ mesh, mat, life: 0, maxLife: 0.4, active: false });
    }
  }

  /** Emit an expanding glow ring at a world position. */
  ring(pos: Vector3, kind: "gold" | "trail" = "trail"): void {
    const r = this.rings.find((x) => !x.active);
    if (!r) return;
    const hex =
      kind === "gold"
        ? ThemeConfig.colors.collectible
        : ThemeConfig.gameplay.trailColor;
    r.mat.emissiveColor = hexToColor3(hex);
    r.mesh.position.copyFrom(pos);
    r.mesh.scaling.set(0.3, 0.3, 0.3);
    r.mat.alpha = 0.9;
    r.life = r.maxLife;
    r.active = true;
    r.mesh.setEnabled(true);
  }

  private updateRings(dt: number): void {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.setEnabled(false);
        continue;
      }
      const t = 1 - r.life / r.maxLife; // 0..1
      const s = 0.3 + t * 3.2; // expand outward
      r.mesh.scaling.set(s, s, s);
      r.mat.alpha = 0.9 * (1 - t); // fade out
    }
  }

  private makeSoftDotTexture(): DynamicTexture {
    const size = 64;
    const tex = new DynamicTexture(
      "softDot",
      { width: size, height: size },
      this.scene,
      false
    );
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const grd = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.4, "rgba(255,255,255,0.7)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    tex.hasAlpha = true;
    tex.update();
    return tex;
  }

  private baseSystem(name: string, capacity: number): ParticleSystem {
    const ps = new ParticleSystem(name, capacity, this.scene);
    ps.particleTexture = this.softDot.clone();
    ps.blendMode = ParticleSystem.BLENDMODE_ONEONE; // additive glow
    return ps;
  }

  private makeTrail(): ParticleSystem {
    const cap = Math.round(this.maxParticles * 0.5);
    const ps = this.baseSystem("trail", cap);
    ps.emitter = this.emitterNode as unknown as Vector3; // node-based emitter
    ps.minEmitBox = new Vector3(-0.15, -0.1, -0.2);
    ps.maxEmitBox = new Vector3(0.15, 0.1, 0.1);

    const trailC = Color3.FromHexString(ThemeConfig.gameplay.trailColor);
    ps.color1 = new Color4(trailC.r, trailC.g, trailC.b, 0.8);
    ps.color2 = new Color4(1, 0.85, 0.3, 0.6);
    ps.colorDead = new Color4(0.2, 0.02, 0, 0);

    ps.minSize = 0.25;
    ps.maxSize = 0.7;
    ps.minLifeTime = 0.18;
    ps.maxLifeTime = 0.4;
    ps.emitRate = cap * 3;
    ps.direction1 = new Vector3(-0.3, 0.1, -1.2);
    ps.direction2 = new Vector3(0.3, 0.5, -0.4);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 1.4;
    ps.gravity = new Vector3(0, 1.2, 0);
    return ps;
  }

  private makeEmbers(): ParticleSystem {
    const cap = Math.round(this.maxParticles * 0.35);
    const ps = this.baseSystem("embers", cap);
    ps.emitter = this.emitterNode as unknown as Vector3;
    ps.minEmitBox = new Vector3(-9, -3, 4);
    ps.maxEmitBox = new Vector3(9, -1, 26);

    const emberC = Color3.FromHexString(ThemeConfig.gameplay.emberColor);
    ps.color1 = new Color4(emberC.r, emberC.g, emberC.b, 0.7);
    ps.color2 = new Color4(1, 0.6, 0.1, 0.5);
    ps.colorDead = new Color4(0.1, 0.02, 0, 0);

    ps.minSize = 0.1;
    ps.maxSize = 0.35;
    ps.minLifeTime = 1.2;
    ps.maxLifeTime = 2.6;
    ps.emitRate = cap * 0.6;
    ps.direction1 = new Vector3(-0.2, 1.2, -0.2);
    ps.direction2 = new Vector3(0.2, 2.4, 0.2);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.9;
    ps.gravity = new Vector3(0, 0.6, 0);
    return ps;
  }

  private makeBurst(): ParticleSystem {
    const cap = Math.round(this.maxParticles * 0.25);
    const ps = this.baseSystem("burst", cap);
    ps.emitter = this.burstPos;
    ps.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
    ps.maxEmitBox = new Vector3(0.1, 0.1, 0.1);

    const goldC = Color3.FromHexString(ThemeConfig.colors.collectible);
    ps.color1 = new Color4(goldC.r, goldC.g, goldC.b, 1);
    ps.color2 = new Color4(1, 1, 0.6, 0.9);
    ps.colorDead = new Color4(0.3, 0.2, 0, 0);

    ps.minSize = 0.15;
    ps.maxSize = 0.4;
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.5;
    ps.emitRate = 300;
    ps.createSphereEmitter(0.6);
    ps.minEmitPower = 1.5;
    ps.maxEmitPower = 3.5;
    ps.gravity = new Vector3(0, -3, 0);
    ps.manualEmitCount = 0;
    return ps;
  }

  /** Begin continuous effects (trail + embers) for a run. */
  startAmbient(): void {
    this.trail.start();
    this.embers.start();
  }

  stopAmbient(): void {
    this.trail.stop();
    this.embers.stop();
    this.trail.reset();
    this.embers.reset();
  }

  /** Keep the trail/ember emitter following the ball; animate rings. */
  update(ball: PlayerBall, dt = 0): void {
    this.emitterNode.position.copyFrom(ball.position);
    if (dt > 0) this.updateRings(dt);
  }

  /** One-shot collect burst at a world position. */
  collectBurst(worldPos: Vector3): void {
    this.burstPos.copyFrom(worldPos);
    this.burst.manualEmitCount = Math.min(14, this.burst.getCapacity());
    if (!this.burst.isStarted()) this.burst.start();
  }

  /** Brief trail intensification for speed-up / boost pads. */
  speedPulse(): void {
    const original = this.trail.emitRate;
    this.trail.emitRate = original * 2.2;
    setTimeout(() => {
      this.trail.emitRate = original;
    }, 600);
  }

  dispose(): void {
    this.trail.dispose();
    this.embers.dispose();
    this.burst.dispose();
    for (const r of this.rings) {
      r.mesh.dispose();
      r.mat.dispose();
    }
    this.softDot.dispose();
    this.emitterNode.dispose();
  }
}
