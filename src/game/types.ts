/** Finite game states (design doc §10). */
export const GameState = {
  Boot: "boot",
  Ready: "ready",
  Playing: "playing",
  Paused: "paused",
  Falling: "falling",
  GameOver: "gameover",
} as const;

export type GameState = (typeof GameState)[keyof typeof GameState];

/** Lane index: -1 left, 0 center, 1 right (design doc §14). */
export type Lane = -1 | 0 | 1;

export type ObstacleType = "block" | "pillar" | "crack";

export interface ObstacleSpec {
  type: ObstacleType;
  lane: number;
  /** Z position within the chunk (0 .. chunkLength). */
  z: number;
}

export interface CollectibleSpec {
  lane: number;
  z: number;
}

export interface GapSpec {
  lane: number;
  zStart: number;
  zEnd: number;
}

export interface BoostPadSpec {
  lane: number;
  z: number;
}

/** A reusable track-chunk template selected by difficulty (design doc §14). */
export interface ChunkPattern {
  id: string;
  difficulty: number;
  obstacles?: ObstacleSpec[];
  collectibles?: CollectibleSpec[];
  gaps?: GapSpec[];
  boostPads?: BoostPadSpec[];
}

/** Live scoring / run state shared across systems. */
export interface RunState {
  distance: number;
  score: number;
  coins: number;
  speed: number;
  elapsed: number;
}
