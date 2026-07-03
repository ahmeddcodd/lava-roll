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

export type ObstacleType = "block" | "pillar" | "barrier" | "mover";

export interface ObstacleSpec {
  type: ObstacleType;
  lane: number;
  /** Z position within the chunk (0 .. chunkLength). */
  z: number;
}

export interface CollectibleSpec {
  lane: number;
  z: number;
  /** Optional extra height above the surface (for coin arcs over jumps). */
  dy?: number;
  /**
   * If set, this coin ignores `lane` and spawns in the lane the pattern's
   * (random-lane) spring actually chose this time, so a spring→coin arc always
   * lines up no matter which lane the spring popped in.
   */
  followSpring?: boolean;
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

export interface SpringSpec {
  lane: number;
  z: number;
  /** If set, spawn in a random lane at runtime (avoiding any gap at this z). */
  randomLane?: boolean;
}

/** A reusable track-chunk template selected by difficulty (design doc §14). */
export interface ChunkPattern {
  id: string;
  difficulty: number;
  obstacles?: ObstacleSpec[];
  collectibles?: CollectibleSpec[];
  gaps?: GapSpec[];
  boostPads?: BoostPadSpec[];
  springs?: SpringSpec[];
}

/** Live scoring / run state shared across systems. */
export interface RunState {
  distance: number;
  score: number;
  coins: number;
  speed: number;
  elapsed: number;
}
