/**
 * Best-score persistence via localStorage, guarded for sandboxed frames where
 * storage may throw (design doc §10 state persistence).
 */
const BEST_KEY = "lavaTempleRoll.best";

export class SaveManager {
  private cachedBest = 0;

  constructor() {
    this.cachedBest = this.readBest();
  }

  private readBest(): number {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  get best(): number {
    return this.cachedBest;
  }

  /** Records a new best if higher. Returns true if a new best was set. */
  submit(score: number): boolean {
    if (score <= this.cachedBest) return false;
    this.cachedBest = score;
    try {
      localStorage.setItem(BEST_KEY, String(score));
    } catch {
      // Storage unavailable — keep the in-memory best for this session.
    }
    return true;
  }
}
