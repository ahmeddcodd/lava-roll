/**
 * Cloud-only persistence (design doc §10, revised). The player's YouTube account
 * is the SINGLE source of truth via the SDK (`saveData`/`loadData`) — there is no
 * localStorage tier. Stores best score, the idol wallet (spendable across runs),
 * the set of owned skins, and the equipped skin.
 *
 * Reload safety (no data loss across rapid reloads) is the priority:
 *  - Reads are synchronous off the cached fields; `hydrate()` loads the cloud blob
 *    once at boot and flips `loaded` true.
 *  - `persist()` REFUSES to write until a successful `hydrate()` has run. This is
 *    the key guard: if a boot load fails or hasn't finished, a play action can
 *    never overwrite good cloud data with fresh-default (0/0) values.
 *  - Saves are serialized through one promise chain and always write the FULL
 *    latest blob, so a newer save supersedes an older one and they never interleave.
 *  - `flush()` exposes the in-flight save so the caller can await it on pause /
 *    pagehide, giving the write a chance to land before the document tears down.
 */
import { BallSkins, DEFAULT_SKIN_ID } from "./Skins";
import type { YTGame } from "./YTGame";

/** Shape of the single cloud-save blob (SDK saveData string is this JSON). */
interface SaveBlob {
  best: number;
  idols: number;
  owned: string[];
  equipped: string;
}

export class SaveManager {
  private cachedBest = 0;
  private cachedWallet = 0;
  private ownedSkins: Set<string> = new Set<string>([DEFAULT_SKIN_ID]);
  private equippedSkin: string = DEFAULT_SKIN_ID;

  private ytg: YTGame | null = null;

  // True only after hydrate() has completed (successfully or with a confirmed
  // empty account). Until then persist() is a no-op so we never clobber the
  // cloud with default values before we know what the account actually holds.
  private loaded = false;

  // Serialized-save chain: the tail of the last save promise. New saves append,
  // so writes never interleave and the latest state always wins.
  private saveChain: Promise<void> = Promise.resolve();
  // Set when a mutation happened; the pending blob to write on the next tick.
  private pendingBlob: string | null = null;

  /**
   * Load persisted state from the YouTube account. Must be awaited at boot before
   * showing the UI. Only marks the store `loaded` (which UNLOCKS saving) when the
   * load SUCCEEDS — a confirmed-empty account counts as success, but a load
   * FAILURE does not. This is the core data-safety guard: after a transient cloud
   * hiccup we must never save, or we'd overwrite the real account data with
   * defaults. A background retry re-attempts the load so saving can recover later
   * in the same session once the cloud responds.
   */
  async hydrate(ytg: YTGame): Promise<void> {
    this.ytg = ytg;
    const res = await ytg.loadData();
    if (res.ok) {
      if (res.data) this.applyBlob(res.data);
      this.loaded = true; // account state known → persistence allowed
    } else {
      // Load failed — keep persistence DISABLED and retry in the background so a
      // transient failure doesn't permanently block saves (but also never lets
      // a save clobber good cloud data before we've actually read it).
      this.retryLoad();
    }
  }

  private retryScheduled = false;

  private retryLoad(): void {
    if (this.retryScheduled || this.loaded) return;
    this.retryScheduled = true;
    const attempt = async (tries: number): Promise<void> => {
      const ytg = this.ytg;
      if (!ytg || this.loaded) return;
      const res = await ytg.loadData();
      if (res.ok) {
        if (res.data) this.applyBlob(res.data);
        this.loaded = true;
        return;
      }
      if (tries > 0) {
        setTimeout(() => void attempt(tries - 1), 2000);
      }
      // Give up after the retries: stays unloaded, so saving remains disabled and
      // the account data is left untouched (safe default).
    };
    setTimeout(() => void attempt(4), 2000);
  }

  /** Merge a loaded cloud blob into the cache (tolerant of partial/legacy blobs). */
  private applyBlob(raw: string): void {
    try {
      const blob = JSON.parse(raw) as Partial<SaveBlob>;
      if (typeof blob.best === "number" && blob.best >= 0) {
        this.cachedBest = blob.best;
      }
      if (typeof blob.idols === "number" && blob.idols >= 0) {
        this.cachedWallet = blob.idols;
      }
      if (Array.isArray(blob.owned)) {
        this.ownedSkins = new Set<string>([DEFAULT_SKIN_ID, ...blob.owned]);
      }
      if (
        typeof blob.equipped === "string" &&
        BallSkins.some((s) => s.id === blob.equipped)
      ) {
        this.equippedSkin = blob.equipped;
      }
    } catch {
      // Malformed cloud blob — keep the (default) cache; do NOT mark unloaded.
    }
  }

  /** Serialize the full state to the cloud-save JSON string. */
  private serialize(): string {
    const blob: SaveBlob = {
      best: this.cachedBest,
      idols: this.cachedWallet,
      owned: [...this.ownedSkins],
      equipped: this.equippedSkin,
    };
    return JSON.stringify(blob);
  }

  /**
   * Persist the current full state to the cloud. No-op until `loaded` (so we
   * never overwrite the account with defaults before hydrate completes) and when
   * the SDK is unavailable. Saves are serialized so the latest blob always wins.
   */
  persist(): void {
    if (!this.loaded) return;
    const ytg = this.ytg;
    if (!ytg || !ytg.available) return;

    const blob = this.serialize();
    this.pendingBlob = blob;
    // Append to the chain: when the previous save settles, write the LATEST
    // pending blob (collapsing bursts of rapid mutations into one final write).
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(async () => {
        const toWrite = this.pendingBlob;
        if (toWrite === null) return;
        this.pendingBlob = null;
        await ytg.saveData(toWrite);
      });
  }

  /**
   * Await any pending/in-flight save so it has a chance to land before the page
   * tears down (call on pause / pagehide). Resolves even if there's nothing to do.
   */
  async flush(): Promise<void> {
    // Ensure the latest state is queued, then wait for the chain to drain.
    this.persist();
    try {
      await this.saveChain;
    } catch {
      /* a failed save must not throw to the caller */
    }
  }

  // --- Best score ---

  get best(): number {
    return this.cachedBest;
  }

  /** Records a new best if higher. Returns true if a new best was set. */
  submit(score: number): boolean {
    if (score <= this.cachedBest) return false;
    this.cachedBest = score;
    this.persist();
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
    this.persist();
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
    this.persist();
    return true;
  }

  /** Equip an owned skin. Returns true on success. */
  equip(skinId: string): boolean {
    if (!this.ownedSkins.has(skinId)) return false;
    this.equippedSkin = skinId;
    this.persist();
    return true;
  }
}
