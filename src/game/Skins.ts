/**
 * Ball skins (design doc §19) — fully procedural: each skin is just a color set
 * applied to the ball's stone base, crack rings, and glow shell. Unlocked with
 * idols collected across runs (persisted by SaveManager).
 */
export interface BallSkin {
  id: string;
  name: string;
  /** Idol cost to unlock (0 = free/default). */
  cost: number;
  /** Sphere base color. */
  base: string;
  /** Emissive color of the crack rings. */
  crack: string;
  /** Soft glow shell color. */
  glow: string;
}

export const BallSkins: BallSkin[] = [
  {
    id: "lava_relic",
    name: "Lava Relic",
    cost: 0,
    base: "#1a1413",
    crack: "#ffcc33",
    glow: "#ff4a00",
  },
  {
    id: "golden_idol",
    name: "Golden Idol",
    cost: 25,
    base: "#7a5210",
    crack: "#ffe66b",
    glow: "#ffd447",
  },
  {
    id: "obsidian_orb",
    name: "Obsidian Orb",
    cost: 50,
    base: "#0b0a12",
    crack: "#b26bff",
    glow: "#7a2bff",
  },
  {
    id: "crystal_core",
    name: "Crystal Core",
    cost: 100,
    base: "#122a33",
    crack: "#8ef4ff",
    glow: "#2bd7ff",
  },
  {
    id: "fire_skull",
    name: "Fire Skull",
    cost: 200,
    base: "#2a0a06",
    crack: "#ff3b1e",
    glow: "#ff1f00",
  },
];

export const DEFAULT_SKIN_ID = BallSkins[0].id;

export function skinById(id: string): BallSkin {
  return BallSkins.find((s) => s.id === id) ?? BallSkins[0];
}
