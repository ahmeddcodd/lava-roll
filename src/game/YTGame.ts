/**
 * YTGame — a thin, fully-guarded façade over the YouTube Playables SDK
 * (`window.ytgame`, loaded via the script tag in index.html). It is the single
 * place the game touches the SDK, so every other system stays SDK-agnostic.
 *
 * The SDK is only present inside the YouTube Playables environment. Everywhere
 * else (local dev, Vercel preview, any standalone host) `window.ytgame` is
 * undefined, and EVERY method here degrades to a safe no-op — the game runs
 * identically with or without YouTube.
 *
 * IMPORTANT: the real SDK's methods rely on `this` being their owning object
 * (e.g. `system.onPause` uses `this.g`/`this.h` internally). So every call MUST
 * be a MEMBER call on the live SDK object — `sys.onPause(cb)`, never a detached
 * `const fn = sys.onPause; fn(cb)` (which loses `this`, throws, and silently
 * fails to register). We also read `window.ytgame` live at each call rather than
 * a constructor snapshot, in case the SDK attaches sub-objects asynchronously.
 *
 * SDK contract (developers.google.com/youtube/gaming/playables):
 *  - `ytgame.IN_PLAYABLES_ENV` — true only inside YouTube.
 *  - `ytgame.game.firstFrameReady()` then `gameReady()` — lifecycle signals.
 *  - `ytgame.system.onPause(cb)` / `onResume(cb)` — platform-owned pause; each
 *    returns an unsubscribe fn. The game MUST halt everything on pause and MUST
 *    NOT use the Page Visibility API when the SDK is present.
 *  - `ytgame.system.isAudioEnabled()` + `onAudioEnabledChange(cb)` — YouTube mute.
 *  - `ytgame.engagement.sendScore({ value })` — leaderboard score.
 *  - `ytgame.game.saveData(str)` / `loadData()` — per-account cloud save.
 */

type Unsub = () => void;

/** Minimal shape of the parts of the SDK we call (all optional/guarded). */
interface YTGameSDK {
  IN_PLAYABLES_ENV?: boolean;
  game?: {
    firstFrameReady?: () => void;
    gameReady?: () => void;
    saveData?: (data: string) => Promise<void>;
    loadData?: () => Promise<string>;
  };
  system?: {
    onPause?: (cb: () => void) => Unsub;
    onResume?: (cb: () => void) => Unsub;
    isAudioEnabled?: () => boolean;
    onAudioEnabledChange?: (cb: (isAudioEnabled: boolean) => void) => Unsub;
  };
  engagement?: {
    sendScore?: (score: { value: number }) => Promise<void>;
  };
  health?: {
    logError?: () => void;
  };
}

declare global {
  interface Window {
    ytgame?: YTGameSDK;
  }
}

export class YTGame {
  private readonly unsubs: Unsub[] = [];
  private firstFrameSignaled = false;
  private gameReadySignaled = false;

  /** Read the live SDK object (never a stale snapshot). */
  private sdkNow(): YTGameSDK | undefined {
    return typeof window !== "undefined" ? window.ytgame : undefined;
  }

  /** Whether the SDK object is present at all (regardless of env flag). */
  get available(): boolean {
    return !!this.sdkNow();
  }

  /** True only inside the YouTube Playables environment. */
  get inPlayables(): boolean {
    return !!this.sdkNow()?.IN_PLAYABLES_ENV;
  }

  // --- Lifecycle signals (idempotent, member calls) ----------------------

  /** Tell YouTube the first frame / splash is showing. Safe to call once. */
  signalFirstFrameReady(): void {
    if (this.firstFrameSignaled) return;
    const game = this.sdkNow()?.game;
    if (!game?.firstFrameReady) return;
    this.firstFrameSignaled = true;
    this.wrap("firstFrameReady", () => game.firstFrameReady!());
  }

  /** Tell YouTube the game is interactive. MUST follow firstFrameReady. */
  signalGameReady(): void {
    if (this.gameReadySignaled) return;
    const game = this.sdkNow()?.game;
    if (!game?.gameReady) return;
    this.gameReadySignaled = true;
    this.wrap("gameReady", () => game.gameReady!());
  }

  // --- Pause / resume (platform-owned) -----------------------------------

  onPause(cb: () => void): void {
    const sys = this.sdkNow()?.system;
    if (!sys?.onPause) return;
    // Member call: `this` inside onPause stays the `system` object.
    this.wrap("onPause", () => this.keep(sys.onPause!(cb)));
  }

  onResume(cb: () => void): void {
    const sys = this.sdkNow()?.system;
    if (!sys?.onResume) return;
    this.wrap("onResume", () => this.keep(sys.onResume!(cb)));
  }

  // --- Audio (YouTube mute) ----------------------------------------------

  /** Current YouTube audio setting; true (enabled) when the SDK is absent. */
  isAudioEnabled(): boolean {
    const sys = this.sdkNow()?.system;
    if (!sys?.isAudioEnabled) return true;
    try {
      return sys.isAudioEnabled();
    } catch (e) {
      this.warn("isAudioEnabled", e);
      return true;
    }
  }

  onAudioEnabledChange(cb: (isAudioEnabled: boolean) => void): void {
    const sys = this.sdkNow()?.system;
    if (!sys?.onAudioEnabledChange) return;
    this.wrap("onAudioEnabledChange", () =>
      this.keep(sys.onAudioEnabledChange!(cb))
    );
  }

  // --- Engagement / persistence ------------------------------------------

  /** Submit a run's score to the YouTube leaderboard (fire-and-forget). */
  sendScore(value: number): void {
    const eng = this.sdkNow()?.engagement;
    if (!eng?.sendScore) return;
    // YouTube expects a finite integer score.
    const v = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
    this.wrap("sendScore", () => {
      const p = eng.sendScore!({ value: v });
      if (p && typeof p.catch === "function") {
        p.catch((e) => this.warn("sendScore(reject)", e));
      }
    });
  }

  /** Persist a serialized save blob to the player's YouTube account. */
  async saveData(data: string): Promise<void> {
    const game = this.sdkNow()?.game;
    if (!game?.saveData) return;
    try {
      await game.saveData(data);
    } catch (e) {
      this.warn("saveData", e);
    }
  }

  /**
   * Load the player's saved blob. Returns a discriminated result so callers can
   * tell a CONFIRMED-EMPTY account (`{ok:true, data:null}`) apart from a LOAD
   * FAILURE (`{ok:false}`). This distinction is critical for data safety: on a
   * failure the caller must NOT persist (or it would overwrite real cloud data
   * with defaults). When the SDK is absent, that's a confirmed-empty success.
   */
  async loadData(): Promise<{ ok: boolean; data: string | null }> {
    const game = this.sdkNow()?.game;
    if (!game?.loadData) return { ok: true, data: null };
    try {
      const data = await game.loadData();
      return { ok: true, data: data ?? null };
    } catch (e) {
      this.warn("loadData", e);
      return { ok: false, data: null };
    }
  }

  // --- Internals ----------------------------------------------------------

  /** Store an unsubscribe fn (if the SDK returned one) for dispose(). */
  private keep(unsub: Unsub | void): void {
    if (typeof unsub === "function") this.unsubs.push(unsub);
  }

  /**
   * Run an SDK call, keeping the game crash-proof but NOT silent: a real SDK
   * breakage is logged to the console + SDK health so it surfaces next time
   * (an empty catch here is what hid the detached-`this` bug originally).
   */
  private wrap(label: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.warn(label, e);
    }
  }

  private warn(label: string, e: unknown): void {
    try {
      // eslint-disable-next-line no-console
      console.warn("[ytgame] " + label + " failed:", e);
    } catch {
      /* ignore */
    }
    try {
      this.sdkNow()?.health?.logError?.();
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    for (const u of this.unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.unsubs.length = 0;
  }
}
