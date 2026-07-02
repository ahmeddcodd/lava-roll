/**
 * Persistence via localStorage, guarded for sandboxed frames where storage may
 * throw (design doc §10). Stores best score, the idol wallet (spendable across
 * runs), the set of owned skins, and the equipped skin.
 */
import { BallSkins, DEFAULT_SKIN_ID } from "./Skins";

const BEST_KEY = "lavaTempleRoll.best";
const WALLET_KEY = "lavaTempleRoll.idols";
const OWNED_KEY = "lavaTempleRoll.ownedSkins";
const EQUIPPED_KEY = "lavaTempleRoll.skin";

export class SaveManager {
  private cachedBest = 0;
  private cachedWallet = 0;
  private ownedSkins: Set<string>;
  private equippedSkin: string;

  constructor() {
    this.cachedBest = this.readInt(BEST_KEY);
    this.cachedWallet = this.readInt(WALLET_KEY);
    this.ownedSkins = this.readOwned();
    this.equippedSkin = this.readEquipped();
  }

  private readInt(key: string): number {
    try {
      const raw = localStorage.getItem(key);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  private writeStr(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable — keep in-memory state for this session.
    }
  }

  private readOwned(): Set<string> {
    // The default (free) skin is always owned.
    const owned = new Set<string>([DEFAULT_SKIN_ID]);
    try {
      const raw = localStorage.getItem(OWNED_KEY);
      if (raw) {
        for (const id of JSON.parse(raw) as string[]) owned.add(id);
      }
    } catch {
      /* ignore */
    }
    return owned;
  }

  private readEquipped(): string {
    try {
      const raw = localStorage.getItem(EQUIPPED_KEY);
      if (raw && BallSkins.some((s) => s.id === raw)) return raw;
    } catch {
      /* ignore */
    }
    return DEFAULT_SKIN_ID;
  }

  // --- Best score ---

  get best(): number {
    return this.cachedBest;
  }

  /** Records a new best if higher. Returns true if a new best was set. */
  submit(score: number): boolean {
    if (score <= this.cachedBest) return false;
    this.cachedBest = score;
    this.writeStr(BEST_KEY, String(score));
    return true;
  }

  // --- Idol wallet (spendable currency) ---

  get idols(): number {
    return this.cachedWallet;
  }

  /** Add idols earned in a run to the persistent wallet. */
  addIdols(n: number): void {
    if (n <= 0) return;
    this.cachedWallet += n;
    this.writeStr(WALLET_KEY, String(this.cachedWallet));
  }

  // --- Skins ---

  get equipped(): string {
    return this.equippedSkin;
  }

  owns(skinId: string): boolean {
    return this.ownedSkins.has(skinId);
  }

  /** Spend idols to unlock a skin. Returns true on success. */
  buy(skinId: string, cost: number): boolean {
    if (this.ownedSkins.has(skinId)) return true;
    if (this.cachedWallet < cost) return false;
    this.cachedWallet -= cost;
    this.ownedSkins.add(skinId);
    this.writeStr(WALLET_KEY, String(this.cachedWallet));
    this.writeStr(OWNED_KEY, JSON.stringify([...this.ownedSkins]));
    return true;
  }

  /** Equip an owned skin. Returns true on success. */
  equip(skinId: string): boolean {
    if (!this.ownedSkins.has(skinId)) return false;
    this.equippedSkin = skinId;
    this.writeStr(EQUIPPED_KEY, skinId);
    return true;
  }
}
