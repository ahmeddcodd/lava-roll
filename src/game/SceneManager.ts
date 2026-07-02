import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Engine } from "@babylonjs/core/Engines/engine";

import { ThemeConfig } from "./ThemeConfig";
import { GameConfig } from "./Config";

/** Parse a "#rrggbb" hex string into a Babylon Color3. */
export function hexToColor3(hex: string): Color3 {
  return Color3.FromHexString(hex);
}

/**
 * Holds the shared material set (design doc §8.3) and scene-wide setup.
 * Materials are created once and reused everywhere — never duplicated at runtime.
 */
export class SceneManager {
  readonly scene: Scene;

  // Shared materials.
  readonly matStoneTrack: StandardMaterial;
  readonly matStoneEdge: StandardMaterial;
  readonly matLava: StandardMaterial;
  readonly matBallStone: StandardMaterial;
  readonly matBallCrackGlow: StandardMaterial;
  readonly matGold: StandardMaterial;
  readonly matObstacle: StandardMaterial;
  readonly matRuneBoost: StandardMaterial;
  readonly matBackgroundTemple: StandardMaterial;
  readonly matLaneLine: StandardMaterial;

  constructor(engine: Engine) {
    const scene = new Scene(engine);
    const c = ThemeConfig.colors;

    scene.clearColor = Color4.FromColor3(hexToColor3(c.background), 1);
    scene.ambientColor = new Color3(0.35, 0.28, 0.26);

    // Exponential fog hides far detail and sells the volcanic murk (design doc §7).
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = hexToColor3(c.fog);
    scene.fogDensity = 0.014;

    // Single hemispheric light — no shadows in MVP.
    const light = new HemisphericLight("hemi", new Vector3(0.2, 1, -0.35), scene);
    light.intensity = 0.95;
    light.diffuse = new Color3(1, 0.85, 0.72);
    light.groundColor = new Color3(0.25, 0.12, 0.08);

    this.scene = scene;

    // --- Shared material set ---
    this.matStoneTrack = this.makeMat("matStoneTrack", c.track, {
      specular: 0.02,
    });

    // Side rails glow warmly so the track edges read instantly on small screens.
    this.matStoneEdge = this.makeMat("matStoneEdge", c.edge, {
      specular: 0.04,
      emissive: c.lava,
      emissiveScale: 0.5,
    });

    // Emissive lane divider lines (fake glow, unlit). Brightness is animated by
    // the track for a speed pulse.
    this.matLaneLine = this.makeMat("matLaneLine", c.lavaBright, {
      emissive: c.lava,
      emissiveScale: 0.85,
      disableLighting: true,
    });

    this.matLava = this.makeMat("matLava", c.lava, {
      emissive: c.lava,
      emissiveScale: 1.0,
      disableLighting: true,
    });

    this.matBallStone = this.makeMat("matBallStone", "#1a1413", {
      specular: 0.08,
    });

    this.matBallCrackGlow = this.makeMat("matBallCrackGlow", c.lava, {
      emissive: c.lavaBright,
      emissiveScale: 1.0,
      disableLighting: true,
    });

    this.matGold = this.makeMat("matGold", c.collectible, {
      emissive: c.collectible,
      emissiveScale: 0.55,
      specular: 0.4,
    });

    this.matObstacle = this.makeMat("matObstacle", "#3a1c14", {
      emissive: c.danger,
      emissiveScale: 0.35,
      specular: 0.1,
    });

    this.matRuneBoost = this.makeMat("matRuneBoost", c.lavaBright, {
      emissive: ThemeConfig.gameplay.speedPadColor,
      emissiveScale: 1.0,
      disableLighting: true,
    });

    this.matBackgroundTemple = this.makeMat("matBackgroundTemple", c.pillar, {
      specular: 0.0,
    });
    // Background props are unlit-ish and should not receive fog as strongly.
    this.matBackgroundTemple.emissiveColor = hexToColor3(c.pillar).scale(0.25);
  }

  private makeMat(
    name: string,
    diffuseHex: string,
    opts: {
      specular?: number;
      emissive?: string;
      emissiveScale?: number;
      disableLighting?: boolean;
    } = {}
  ): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = hexToColor3(diffuseHex);
    const spec = opts.specular ?? 0.05;
    m.specularColor = new Color3(spec, spec, spec);
    if (opts.emissive) {
      m.emissiveColor = hexToColor3(opts.emissive).scale(opts.emissiveScale ?? 1);
    }
    if (opts.disableLighting) {
      m.disableLighting = true;
    }
    m.maxSimultaneousLights = 1;
    return m;
  }

  /**
   * Set render resolution from the device pixel ratio, capped for performance.
   * hardwareScalingLevel = 1 / effectiveDPR: a value < 1 renders ABOVE CSS
   * resolution (crisp on high-DPI phones). Called on init and on resize so the
   * canvas stays sharp after rotation / viewport changes.
   */
  applyPerformanceSettings(engine: Engine, isMobile: boolean): void {
    const cap = isMobile
      ? GameConfig.performance.maxMobilePixelRatio
      : GameConfig.performance.maxDesktopPixelRatio;
    const dpr = window.devicePixelRatio || 1;
    const effectiveDpr = Math.min(dpr, cap);
    engine.setHardwareScalingLevel(1 / effectiveDpr);
  }

  dispose(): void {
    this.scene.dispose();
  }
}
