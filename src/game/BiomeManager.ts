import type { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";

import { hexToColor3 } from "./SceneManager";
import type { SceneManager } from "./SceneManager";
import type { TrackManager } from "./TrackManager";
import { Biomes, BIOME_BAND, BIOME_FADE, smoothstep } from "./Biomes";

/** Pre-parsed Color3 form of a BiomePalette (parsed once, blended per frame). */
interface BiomeColors {
  track: Color3;
  edge: Color3;
  accent: Color3;
  accentBright: Color3;
  liquid: Color3;
  pillar: Color3;
  fog: Color3;
  background: Color3;
  lightDiffuse: Color3;
  lightGround: Color3;
}

/**
 * Drives the auto-shifting biome (lava → candy → sand → water, cycling). Owns no
 * geometry — it just recolors the SHARED materials + scene atmosphere every frame
 * by blending between two adjacent biome palettes based on distance travelled.
 *
 * All blends mutate existing Color3s in place (no per-frame allocation), and the
 * whole state is a pure function of `distance`, so retry/reset is trivial.
 */
export class BiomeManager {
  private readonly scene: Scene;
  private readonly sceneMgr: SceneManager;
  private readonly track: TrackManager;
  private readonly light: HemisphericLight | null;

  /** Palettes pre-parsed to Color3 once. */
  private readonly palettes: BiomeColors[];

  // Scratch Color3s reused each frame for the blended result (no allocation).
  private readonly bTrack = new Color3();
  private readonly bEdge = new Color3();
  private readonly bAccent = new Color3();
  private readonly bAccentBright = new Color3();
  private readonly bLineBase = new Color3();
  private readonly bLiquid = new Color3();
  private readonly bPillar = new Color3();

  /** Last integer biome index shown, for detecting biome-entry (toast/flash). */
  private lastBiomeIndex = -1;

  /** Fired when the world enters a new biome (name for a toast). Optional. */
  onBiomeChange: ((name: string) => void) | null = null;

  constructor(scene: Scene, sceneMgr: SceneManager, track: TrackManager) {
    this.scene = scene;
    this.sceneMgr = sceneMgr;
    this.track = track;
    this.light = scene.getLightByName("hemi") as HemisphericLight | null;

    this.palettes = Biomes.map((b) => ({
      track: hexToColor3(b.track),
      edge: hexToColor3(b.edge),
      accent: hexToColor3(b.accent),
      accentBright: hexToColor3(b.accentBright),
      liquid: hexToColor3(b.liquid),
      pillar: hexToColor3(b.pillar),
      fog: hexToColor3(b.fog),
      background: hexToColor3(b.background),
      lightDiffuse: new Color3(...b.lightDiffuse),
      lightGround: new Color3(...b.lightGround),
    }));
  }

  /**
   * Recolor the world for the current distance. Hold each biome for most of its
   * band, then ease into the next in the tail so the world "melts" between looks.
   */
  update(distance: number): void {
    const n = this.palettes.length;
    const f = distance / BIOME_BAND;
    const i = ((Math.floor(f) % n) + n) % n; // current biome (safe modulo)
    const j = (i + 1) % n; // next biome
    const frac = f - Math.floor(f);

    // Hold until the fade window in the band's tail, then smoothstep 0→1.
    const holdUntil = 1 - BIOME_FADE;
    const t =
      frac <= holdUntil ? 0 : smoothstep((frac - holdUntil) / BIOME_FADE);

    const from = this.palettes[i];
    const to = this.palettes[j];

    // Blend every themed channel (in-place into scratch Color3s).
    Color3.LerpToRef(from.track, to.track, t, this.bTrack);
    Color3.LerpToRef(from.edge, to.edge, t, this.bEdge);
    Color3.LerpToRef(from.accent, to.accent, t, this.bAccent);
    Color3.LerpToRef(from.accentBright, to.accentBright, t, this.bAccentBright);
    Color3.LerpToRef(from.liquid, to.liquid, t, this.bLiquid);
    Color3.LerpToRef(from.pillar, to.pillar, t, this.bPillar);

    const m = this.sceneMgr;

    // Track floor + rails.
    m.matStoneTrack.diffuseColor.copyFrom(this.bTrack);
    m.matStoneEdge.diffuseColor.copyFrom(this.bEdge);
    m.matStoneEdge.emissiveColor.copyFrom(this.bAccent).scaleInPlace(0.5);

    // Lane lines: diffuse set directly; the pulse owns emissive, so feed it the
    // biome's base/bright endpoints (base = accent×0.85, matching the original).
    m.matLaneLine.diffuseColor.copyFrom(this.bAccentBright);
    this.bLineBase.copyFrom(this.bAccent).scaleInPlace(0.85);
    this.track.setLineColors(this.bLineBase, this.bAccentBright);

    // Boost pads.
    m.matRuneBoost.diffuseColor.copyFrom(this.bAccentBright);
    m.matRuneBoost.emissiveColor.copyFrom(this.bAccentBright);

    // Liquid plane (also tints obstacle bases — acceptable).
    m.matLava.diffuseColor.copyFrom(this.bLiquid);
    m.matLava.emissiveColor.copyFrom(this.bLiquid);

    // Background pillars + volcanoes.
    m.matBackgroundTemple.diffuseColor.copyFrom(this.bPillar);
    m.matBackgroundTemple.emissiveColor.copyFrom(this.bPillar).scaleInPlace(0.25);

    // Scene atmosphere.
    Color3.LerpToRef(from.fog, to.fog, t, this.scene.fogColor);
    const bg = this.scene.clearColor as Color4;
    bg.r = from.background.r + (to.background.r - from.background.r) * t;
    bg.g = from.background.g + (to.background.g - from.background.g) * t;
    bg.b = from.background.b + (to.background.b - from.background.b) * t;

    if (this.light) {
      Color3.LerpToRef(
        from.lightDiffuse,
        to.lightDiffuse,
        t,
        this.light.diffuse
      );
      Color3.LerpToRef(
        from.lightGround,
        to.lightGround,
        t,
        this.light.groundColor
      );
    }

    // Fire a one-shot event when we CHANGE into a new biome (skip the initial
    // lava at run start, when lastBiomeIndex is -1, so retries don't toast).
    if (i !== this.lastBiomeIndex) {
      const isTransition = this.lastBiomeIndex !== -1;
      this.lastBiomeIndex = i;
      if (isTransition) this.onBiomeChange?.(Biomes[i].name);
    }
  }

  /** Snap back to the first biome (lava) for a fresh run. */
  reset(): void {
    this.lastBiomeIndex = -1;
    this.update(0);
  }
}
