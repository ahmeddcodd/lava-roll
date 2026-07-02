/**
 * Biome palettes for the auto-shifting world (design doc §20 extension).
 * As the ball rolls forward the track/environment cross-fades between these
 * palettes, cycling endlessly. Biome 0 (lava) equals the base ThemeConfig look
 * exactly, so there is no visual change at the start of a run.
 *
 * Each biome recolors the SHARED materials + scene atmosphere; no per-chunk work
 * is ever needed (materials are singletons — see SceneManager).
 */

/** One biome's color set. Hex for material colors; RGB tuples for the light. */
export interface BiomePalette {
  id: string;
  name: string;
  /** matStoneTrack diffuse — the walkable lane floor. */
  track: string;
  /** matStoneEdge diffuse — the side rails. */
  edge: string;
  /** Primary glow (was "lava"): edge/lane emissive + lane pulse base. */
  accent: string;
  /** Bright glow (was "lavaBright"): lane diffuse, pulse peak, boost pads. */
  accentBright: string;
  /** matLava diffuse+emissive — the liquid plane below (and obstacle bases). */
  liquid: string;
  /** matBackgroundTemple — pillars + volcano cones. */
  pillar: string;
  /** scene.fogColor — the volumetric murk. */
  fog: string;
  /** scene.clearColor — the sky/backdrop fallback (covered by the skydome). */
  background: string;
  /** Skydome gradient — deep color at the top of the dome. */
  skyTop: string;
  /** Skydome gradient — warm glow color at the horizon band. */
  skyHorizon: string;
  /** Drifting ambient background particle ("mote") tint. */
  mote: string;
  /** Hemispheric light diffuse (sky tint). */
  lightDiffuse: [number, number, number];
  /** Hemispheric light groundColor (bounce tint). */
  lightGround: [number, number, number];
}

/**
 * The biome cycle order. Lava first == the current theme (no regression).
 * Cycles endlessly: …water → lava → candy → sand → water → …
 */
export const Biomes: BiomePalette[] = [
  {
    id: "lava",
    name: "LAVA TEMPLE",
    track: "#2b2524",
    edge: "#42322e",
    accent: "#ff4a00",
    accentBright: "#ffcc33",
    liquid: "#ff4a00",
    pillar: "#191214",
    fog: "#180808",
    background: "#090405",
    skyTop: "#1a0a12",
    skyHorizon: "#5a1e0a",
    mote: "#ff8a1e",
    lightDiffuse: [1, 0.85, 0.72],
    lightGround: [0.25, 0.12, 0.08],
  },
  {
    id: "candy",
    name: "CANDY LAND",
    track: "#5a2f45",
    edge: "#8a3f66",
    accent: "#ff4fa3",
    accentBright: "#ffd0ec",
    liquid: "#ff6ab0",
    pillar: "#3a1526",
    fog: "#2a0a1c",
    background: "#1a0510",
    skyTop: "#2a0820",
    skyHorizon: "#7a2a55",
    mote: "#ff9ad8",
    lightDiffuse: [1, 0.8, 0.9],
    lightGround: [0.3, 0.1, 0.2],
  },
  {
    id: "sand",
    name: "DESERT DUNES",
    track: "#7a6142",
    edge: "#a8895c",
    accent: "#ffb445",
    accentBright: "#ffe9a8",
    liquid: "#e8b661",
    pillar: "#4a3a22",
    fog: "#241a0c",
    background: "#120c04",
    skyTop: "#241505",
    skyHorizon: "#8a5a2a",
    mote: "#ffe0a0",
    lightDiffuse: [1, 0.95, 0.78],
    lightGround: [0.3, 0.24, 0.12],
  },
  {
    id: "water",
    name: "OCEAN DEPTHS",
    track: "#1e3a52",
    edge: "#2f5f80",
    accent: "#22d3ff",
    accentBright: "#a8f0ff",
    liquid: "#1f9fe0",
    pillar: "#12283a",
    fog: "#08161f",
    background: "#040d14",
    skyTop: "#04121f",
    skyHorizon: "#0a4a6a",
    mote: "#8fdcff",
    lightDiffuse: [0.8, 0.92, 1],
    lightGround: [0.08, 0.18, 0.25],
  },
];

/** Distance units each biome occupies before shifting to the next. */
export const BIOME_BAND = 400;

/**
 * Fraction of a band spent cross-fading into the next biome (the fade happens in
 * the band's tail). 0.12 * 400 ≈ 48 units ≈ ~1.5 s of travel at cruising speed.
 */
export const BIOME_FADE = 0.12;

/** Smoothstep easing for a soft (ease-in-out) cross-fade. t is clamped to [0,1]. */
export function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}
