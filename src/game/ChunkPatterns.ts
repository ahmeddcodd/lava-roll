import type { ChunkPattern } from "./types";

/**
 * Reusable chunk templates (design doc §14). Z values are local to the chunk
 * (0 .. chunkLength). Lanes: -1 left, 0 center, 1 right.
 * Fairness rule: every hazardous pattern leaves at least one safe lane.
 */
export const ChunkPatterns: ChunkPattern[] = [
  {
    id: "straight_safe",
    difficulty: 0,
    collectibles: [
      { lane: 0, z: 4 },
      { lane: 0, z: 7 },
      { lane: 0, z: 10 },
    ],
  },
  {
    id: "coin_line",
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
    id: "left_right_blocks",
    difficulty: 1,
    obstacles: [
      { type: "block", lane: -1, z: 6 },
      { type: "block", lane: 1, z: 11 },
    ],
    collectibles: [
      { lane: 0, z: 3 },
      { lane: 1, z: 6 },
      { lane: -1, z: 11 },
    ],
  },
  {
    id: "risk_coin_edge",
    difficulty: 1,
    collectibles: [
      { lane: -1, z: 4 },
      { lane: -1, z: 6 },
      { lane: 1, z: 9 },
      { lane: 1, z: 11 },
    ],
  },
  {
    id: "center_block_weave",
    difficulty: 1,
    obstacles: [
      { type: "block", lane: 0, z: 5 },
      { type: "block", lane: 0, z: 11 },
    ],
    collectibles: [
      { lane: -1, z: 5 },
      { lane: 1, z: 11 },
    ],
  },
  {
    id: "fire_pillars",
    difficulty: 2,
    obstacles: [
      { type: "pillar", lane: -1, z: 5 },
      { type: "pillar", lane: 1, z: 9 },
      { type: "pillar", lane: -1, z: 13 },
    ],
    collectibles: [
      { lane: 1, z: 5 },
      { lane: -1, z: 9 },
      { lane: 1, z: 13 },
    ],
  },
  {
    id: "lava_crack",
    difficulty: 2,
    obstacles: [
      { type: "crack", lane: -1, z: 7 },
      { type: "crack", lane: 0, z: 7 },
    ],
    collectibles: [
      { lane: 1, z: 7 },
      { lane: 1, z: 10 },
    ],
  },
  {
    id: "split_gap",
    difficulty: 2,
    gaps: [{ lane: 0, zStart: 5, zEnd: 10 }],
    collectibles: [
      { lane: -1, z: 6 },
      { lane: 1, z: 8 },
    ],
  },
  {
    id: "edge_gap_right",
    difficulty: 3,
    gaps: [{ lane: 1, zStart: 4, zEnd: 12 }],
    obstacles: [{ type: "block", lane: -1, z: 8 }],
    collectibles: [
      { lane: 0, z: 6 },
      { lane: 0, z: 10 },
    ],
  },
  {
    id: "speed_pad",
    difficulty: 1,
    boostPads: [{ lane: 0, z: 4 }],
    collectibles: [
      { lane: 0, z: 7 },
      { lane: 0, z: 9 },
      { lane: 0, z: 11 },
      { lane: 0, z: 13 },
    ],
  },
  {
    id: "gauntlet",
    difficulty: 3,
    obstacles: [
      { type: "block", lane: -1, z: 4 },
      { type: "pillar", lane: 1, z: 8 },
      { type: "crack", lane: -1, z: 12 },
      { type: "crack", lane: 0, z: 12 },
    ],
    collectibles: [
      { lane: 1, z: 4 },
      { lane: -1, z: 8 },
      { lane: 1, z: 12 },
    ],
  },
];

/** Patterns guaranteed to contain no lethal hazards (used for tutorial start). */
export const SAFE_PATTERN_IDS = new Set([
  "straight_safe",
  "coin_line",
  "risk_coin_edge",
]);

export const SAFE_PATTERNS = ChunkPatterns.filter((p) =>
  SAFE_PATTERN_IDS.has(p.id)
);
