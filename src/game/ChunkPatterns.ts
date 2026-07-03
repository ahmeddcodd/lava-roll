import type { ChunkPattern } from "./types";

/**
 * Reusable chunk templates (design doc §14). Z values are local to the chunk
 * (0 .. chunkLength = 15). Lanes: -1 left, 0 center, 1 right.
 *
 * Design rules for a satisfying, readable, consistent loop:
 *  - The path is fully solid (no gaps/holes). Every hazardous pattern leaves at
 *    least one clearly safe lane.
 *  - Hazards start at z ≥ 4 (reaction room after the seam) and never sit closer
 *    than ~4 units apart in z, so the player always has time to read + react.
 *  - No coin shares a hazard's (lane, z) — reward is always reachable.
 *  - Springs launch you into a coin arc; the arc coins use `followSpring` so they
 *    line up with whichever (random) lane the spring popped in.
 *  - Difficulty 0..4 escalates from pure coin runs to moving-hazard gauntlets
 *    (the TrackManager ramp weights selection toward the current difficulty).
 */
export const ChunkPatterns: ChunkPattern[] = [
  // ---------- difficulty 0: warm-up, pure reward ----------
  {
    id: "coin_river",
    difficulty: 0,
    collectibles: [
      { lane: 0, z: 3 },
      { lane: 0, z: 5.5 },
      { lane: 0, z: 8 },
      { lane: 0, z: 10.5 },
      { lane: 0, z: 13 },
    ],
  },
  {
    id: "coin_zigzag",
    difficulty: 0,
    collectibles: [
      { lane: -1, z: 3 },
      { lane: 0, z: 5 },
      { lane: 1, z: 7 },
      { lane: 0, z: 9 },
      { lane: -1, z: 11 },
      { lane: 0, z: 13 },
    ],
  },

  // ---------- difficulty 1: first hazards + generous reward ----------
  {
    // Single center barrier — drift to a side lane and collect there.
    id: "barrier_swerve",
    difficulty: 1,
    obstacles: [{ type: "barrier", lane: 0, z: 6 }],
    collectibles: [
      { lane: -1, z: 4 },
      { lane: -1, z: 6 },
      { lane: -1, z: 8 },
      { lane: 0, z: 11 },
      { lane: 0, z: 13 },
    ],
  },
  {
    // Two side blocks on opposite lanes, well spaced — weave from one side to the
    // other with room to spare (a full-track lane change gets ~7 units of z).
    id: "left_right_blocks",
    difficulty: 1,
    obstacles: [
      { type: "block", lane: -1, z: 4 },
      { type: "block", lane: 1, z: 11 },
    ],
    collectibles: [
      { lane: 0, z: 3 },
      { lane: 1, z: 4 },
      { lane: 0, z: 7.5 },
      { lane: -1, z: 11 },
      { lane: 0, z: 13 },
    ],
  },
  {
    // Spring pops up in a random lane and flings you into a coin arc that
    // follows that same lane, so the reward always lines up with the bounce.
    id: "spring_hop",
    difficulty: 1,
    springs: [{ lane: 0, z: 4, randomLane: true }],
    collectibles: [
      { lane: 0, z: 7, dy: 0.9, followSpring: true },
      { lane: 0, z: 9, dy: 1.6, followSpring: true },
      { lane: 0, z: 11, dy: 1.6, followSpring: true },
      { lane: 0, z: 13, dy: 0.8, followSpring: true },
    ],
  },

  // ---------- difficulty 2: pillars, gem clusters, spring runs ----------
  {
    // Alternating side pillars — snake between them. Spaced far apart in z so a
    // full-track weave (-1 → +1) always has generous dodge room.
    id: "fire_pillars",
    difficulty: 2,
    obstacles: [
      { type: "pillar", lane: -1, z: 4 },
      { type: "pillar", lane: 1, z: 11 },
    ],
    collectibles: [
      { lane: 1, z: 4 },
      { lane: 0, z: 6 },
      { lane: 0, z: 8 },
      { lane: -1, z: 11 },
      { lane: 0, z: 13 },
    ],
  },
  {
    // Pillar gate: two side pillars STAGGERED far apart in z, so you weave -1 → +1
    // with a full open lane AND plenty of dodge room at every moment.
    id: "pillar_gate",
    difficulty: 2,
    obstacles: [
      { type: "pillar", lane: -1, z: 5 },
      { type: "pillar", lane: 1, z: 12 },
    ],
    collectibles: [
      { lane: 1, z: 5 },
      { lane: 0, z: 7 },
      { lane: 0, z: 9 },
      { lane: -1, z: 12 },
    ],
  },
  {
    // Spring bounce straight into a rising coin arc (follows the spring lane).
    id: "spring_arc",
    difficulty: 2,
    springs: [{ lane: 0, z: 4, randomLane: true }],
    collectibles: [
      { lane: 0, z: 7, dy: 1.2, followSpring: true },
      { lane: 0, z: 9, dy: 1.8, followSpring: true },
      { lane: 0, z: 11, dy: 1.4, followSpring: true },
      { lane: 0, z: 13, dy: 0.8, followSpring: true },
    ],
  },
  {
    // Gem cluster reward in a side lane, guarded by one barrier in another lane.
    id: "gem_cluster",
    difficulty: 2,
    obstacles: [{ type: "barrier", lane: -1, z: 8 }],
    collectibles: [
      { lane: 1, z: 6 },
      { lane: 1, z: 7.2 },
      { lane: 1, z: 8.4 },
      { lane: 1, z: 9.6 },
      { lane: 0, z: 12 },
    ],
  },

  // ---------- difficulty 3: gauntlets, weaves, mixed hazards ----------
  {
    // Blocks weaving center → right; each lane change gets ~6 units of dodge room.
    // Only single-lane shifts (0→+1, +1→ open) so it never demands a hard swerve.
    id: "block_weave",
    difficulty: 3,
    obstacles: [
      { type: "block", lane: 0, z: 4 },
      { type: "block", lane: 1, z: 10 },
    ],
    collectibles: [
      { lane: -1, z: 4 },
      { lane: 1, z: 6 },
      { lane: 0, z: 8 },
      { lane: -1, z: 10 },
      { lane: 0, z: 13 },
    ],
  },
  {
    // Block then barrier on opposite sides, well spaced — cut across the middle
    // with a generous ~7 units before the second hazard.
    id: "block_barrier_mix",
    difficulty: 3,
    obstacles: [
      { type: "block", lane: -1, z: 4 },
      { type: "barrier", lane: 1, z: 11 },
    ],
    collectibles: [
      { lane: 1, z: 4 },
      { lane: 0, z: 7.5 },
      { lane: -1, z: 11 },
      { lane: 0, z: 13 },
    ],
  },
  {
    // Gauntlet: barrier left, then block right — each lane change gets ~7 units of
    // dodge room. A single wide weave rather than a rapid-fire triple swerve.
    id: "gauntlet",
    difficulty: 3,
    obstacles: [
      { type: "barrier", lane: -1, z: 4 },
      { type: "block", lane: 1, z: 11 },
    ],
    collectibles: [
      { lane: 1, z: 4 },
      { lane: 0, z: 6 },
      { lane: 0, z: 8 },
      { lane: -1, z: 11 },
      { lane: 0, z: 13 },
    ],
  },
  {
    // Two springs (random lanes); reward between them and after the second.
    id: "double_spring",
    difficulty: 3,
    springs: [
      { lane: 0, z: 4, randomLane: true },
      { lane: 0, z: 11, randomLane: true },
    ],
    collectibles: [
      { lane: 0, z: 7, dy: 1.6, followSpring: true },
      { lane: 0, z: 8.5, dy: 1.2, followSpring: true },
      { lane: -1, z: 13 },
      { lane: 1, z: 13 },
    ],
  },

  // ---------- difficulty 4: moving-hazard tension ----------
  {
    // Lone sweeping mover — read its swing, slip past on the open side.
    id: "mover_solo",
    difficulty: 4,
    obstacles: [{ type: "mover", lane: 0, z: 8 }],
    collectibles: [
      { lane: -1, z: 4 },
      { lane: -1, z: 5.5 },
      { lane: 1, z: 11 },
      { lane: 1, z: 12.5 },
    ],
  },
  {
    // Mover center, with a side-lane coin run tempting you into its sweep path.
    id: "mover_coin_run",
    difficulty: 4,
    obstacles: [{ type: "mover", lane: 0, z: 7 }],
    collectibles: [
      { lane: -1, z: 3 },
      { lane: -1, z: 5 },
      { lane: -1, z: 9 },
      { lane: -1, z: 11 },
      { lane: -1, z: 13 },
    ],
  },
  {
    // Mover early, static pillar late — reset your lane after the sweep.
    id: "mover_pillars",
    difficulty: 4,
    obstacles: [
      { type: "mover", lane: 0, z: 6 },
      { type: "pillar", lane: -1, z: 12 },
    ],
    collectibles: [
      { lane: 1, z: 4 },
      { lane: 1, z: 12 },
      { lane: 0, z: 14 },
    ],
  },
];

/** Patterns guaranteed to contain no lethal hazards (used for tutorial start). */
export const SAFE_PATTERN_IDS = new Set([
  "coin_river",
  "coin_zigzag",
  "spring_hop",
]);

export const SAFE_PATTERNS = ChunkPatterns.filter((p) =>
  SAFE_PATTERN_IDS.has(p.id)
);
