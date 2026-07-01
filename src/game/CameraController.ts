import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import type { Scene } from "@babylonjs/core/scene";

import { GameConfig, SLOPE_GRADE } from "./Config";
import type { PlayerBall } from "./PlayerBall";

// How far the look target drops over the look-ahead distance, so the camera
// frames the descending track ahead rather than tilting up toward the sky.
const LOOK_DROP = SLOPE_GRADE * GameConfig.camera.lookAhead;

/**
 * Chase camera (design doc §16). Manual follow lerp, ball framed lower-middle,
 * looks ahead of the ball. Adapts FOV to aspect and adds subtle speed FOV +
 * small transient shake for feel.
 */
export class CameraController {
  readonly camera: UniversalCamera;

  private baseFov: number = GameConfig.camera.portraitFov;
  private shakeTime = 0;
  private shakeStrength = 0;
  private fovPulse = 0;

  // Reused temporaries to avoid per-frame allocation.
  private readonly targetTmp = new Vector3();
  private readonly desiredTmp = new Vector3();
  private readonly lookTmp = new Vector3();

  constructor(scene: Scene, ball: PlayerBall) {
    this.camera = new UniversalCamera(
      "chaseCam",
      new Vector3(0, GameConfig.camera.followHeight, GameConfig.camera.followDistance),
      scene
    );
    this.camera.minZ = 0.1;
    this.camera.maxZ = 220;
    this.camera.fov = this.baseFov;
    this.camera.inputs.clear(); // fully manual control
    this.snapTo(ball);
  }

  reframe(aspect: number): void {
    // Portrait (<1) uses tighter FOV; widen toward landscape.
    this.baseFov =
      aspect < 1
        ? GameConfig.camera.portraitFov
        : GameConfig.camera.landscapeFov;
  }

  /** Instantly place the camera behind the ball (used on start/reset). */
  snapTo(ball: PlayerBall): void {
    const p = ball.position;
    this.camera.position.set(
      p.x * 0.35,
      p.y + GameConfig.camera.followHeight,
      p.z + GameConfig.camera.followDistance
    );
    this.lookTmp.set(
      p.x * 0.25,
      p.y + 1.2 - LOOK_DROP,
      p.z + GameConfig.camera.lookAhead
    );
    this.camera.setTarget(this.lookTmp);
  }

  update(ball: PlayerBall, dt: number, speed: number): void {
    const p = ball.position;

    this.desiredTmp.set(
      p.x * 0.35,
      p.y + GameConfig.camera.followHeight,
      p.z + GameConfig.camera.followDistance
    );

    const t = GameConfig.camera.followLerp;
    this.camera.position.x = Scalar.Lerp(this.camera.position.x, this.desiredTmp.x, t);
    this.camera.position.y = Scalar.Lerp(this.camera.position.y, this.desiredTmp.y, t);
    this.camera.position.z = Scalar.Lerp(this.camera.position.z, this.desiredTmp.z, t);

    // Transient shake (decays).
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const s = this.shakeStrength * Math.max(0, this.shakeTime);
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    this.targetTmp.set(
      p.x * 0.25,
      p.y + 1.2 - LOOK_DROP,
      p.z + GameConfig.camera.lookAhead
    );
    this.camera.setTarget(this.targetTmp);

    // Subtle speed FOV: normalized speed pushes FOV a touch wider.
    const speedNorm = Scalar.Clamp(
      (speed - GameConfig.player.startSpeed) /
        (GameConfig.player.maxSpeed - GameConfig.player.startSpeed),
      0,
      1
    );
    if (this.fovPulse > 0) this.fovPulse -= dt * 1.5;
    const targetFov =
      this.baseFov + speedNorm * 0.12 + Math.max(0, this.fovPulse) * 0.1;
    this.camera.fov = Scalar.Lerp(this.camera.fov, targetFov, 0.1);
  }

  shake(strength: number, duration: number): void {
    this.shakeStrength = strength;
    this.shakeTime = duration;
  }

  pulseFov(): void {
    this.fovPulse = 1;
  }
}
