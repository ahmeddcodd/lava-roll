import { ThemeConfig } from "./ThemeConfig";

/**
 * HTML/CSS HUD overlay (design doc §9). Kept out of Babylon GUI to minimize
 * bundle size. Builds the DOM once, then updates text/visibility per frame.
 */
export class UIManager {
  onRetry: (() => void) | null = null;
  onToggleMute: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly distanceEl: HTMLElement;
  private readonly coinsEl: HTMLElement;
  private readonly coinsLabelEl: HTMLElement;
  private readonly messageEl: HTMLElement;
  private readonly tutorialEl: HTMLElement;
  private readonly pausedEl: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly muteBtn: HTMLElement;

  // Game over panel.
  private readonly panelEl: HTMLElement;
  private readonly panelNewBestEl: HTMLElement;
  private readonly panelDistanceEl: HTMLElement;
  private readonly panelCoinsEl: HTMLElement;
  private readonly panelBestEl: HTMLElement;

  private messageTimer = 0;

  constructor(hud: HTMLElement) {
    this.root = hud;
    this.applyThemeVars();

    const labels = ThemeConfig.labels;

    hud.innerHTML = `
      <div id="hud-flash"></div>
      <div class="hud-top">
        <div class="hud-pill hud-stat">
          <span class="hud-stat-label">${labels.distance}</span>
          <span class="hud-stat-value" id="hud-distance">0</span>
        </div>
        <button id="hud-mute" type="button" aria-label="Toggle sound">&#128266;</button>
        <div class="hud-pill hud-stat right">
          <span class="hud-stat-label" id="hud-coins-label">${labels.collectible}</span>
          <span class="hud-stat-value" id="hud-coins">0</span>
        </div>
      </div>
      <div id="hud-message"></div>
      <div id="hud-tutorial">
        <span class="tut-text">${labels.tutorial}</span>
        <span class="arrows">&#8592;&nbsp;&#8594;</span>
      </div>
      <div id="hud-paused">${labels.paused}</div>
      <div id="hud-panel">
        <div class="panel-card">
          <div class="panel-title">${labels.gameOver}</div>
          <div class="panel-newbest" id="hud-newbest"></div>
          <div class="panel-stats">
            <div class="panel-row"><span class="label">${labels.distance}</span><span class="value" id="hud-panel-distance">0</span></div>
            <div class="panel-row"><span class="label">${labels.collectible}</span><span class="value" id="hud-panel-coins">0</span></div>
            <div class="panel-row"><span class="label">Best</span><span class="value" id="hud-panel-best">0</span></div>
          </div>
          <button id="retry-btn" type="button">${labels.retry}</button>
        </div>
      </div>
    `;

    this.distanceEl = this.byId("hud-distance");
    this.coinsEl = this.byId("hud-coins");
    this.coinsLabelEl = this.byId("hud-coins-label");
    this.messageEl = this.byId("hud-message");
    this.tutorialEl = this.byId("hud-tutorial");
    this.pausedEl = this.byId("hud-paused");
    this.panelEl = this.byId("hud-panel");
    this.panelNewBestEl = this.byId("hud-newbest");
    this.panelDistanceEl = this.byId("hud-panel-distance");
    this.panelCoinsEl = this.byId("hud-panel-coins");
    this.panelBestEl = this.byId("hud-panel-best");
    this.flashEl = this.byId("hud-flash");
    this.muteBtn = this.byId("hud-mute");

    this.byId("retry-btn").addEventListener("click", () => this.onRetry?.());
    this.muteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onToggleMute?.();
    });
    // The mute button is on the canvas layer; stop its taps from steering.
    this.muteBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  private byId(id: string): HTMLElement {
    return this.root.querySelector(`#${id}`) as HTMLElement;
  }

  private applyThemeVars(): void {
    const c = ThemeConfig.colors;
    const s = document.documentElement.style;
    s.setProperty("--ui-main", c.uiMain);
    s.setProperty("--ui-text", c.uiText);
    s.setProperty("--ui-danger", c.danger);
    s.setProperty("--ui-gold", c.collectible);
  }

  /** Per-frame HUD refresh during play. */
  update(distance: number, coins: number, dt: number): void {
    this.distanceEl.textContent = String(distance);
    this.coinsEl.textContent = String(coins);

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.messageEl.classList.remove("show");
    }
  }

  /** Flash a transient center message ("SPEED UP!", "CLOSE CALL!"). */
  flashMessage(text: string, seconds = 1.1): void {
    this.messageEl.textContent = text;
    this.messageEl.classList.add("show");
    this.messageTimer = seconds;
  }

  /** Punch-scale a HUD stat ("coins" | "distance") when it changes. */
  pop(which: "coins" | "distance"): void {
    const el = which === "coins" ? this.coinsEl : this.distanceEl;
    el.classList.remove("pop");
    // Force reflow so the animation restarts even on rapid repeats.
    void el.offsetWidth;
    el.classList.add("pop");
  }

  /** Full-screen color flash for impact (red = hit, gold = speed, cyan = miss). */
  flash(color: "red" | "gold" | "cyan"): void {
    this.flashEl.className = ""; // reset
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add("flash-" + color);
  }

  /** Reflect the current mute state on the button icon. */
  setMuted(muted: boolean): void {
    this.muteBtn.textContent = muted ? "\u{1F507}" : "\u{1F50A}"; // 🔇 / 🔊
    this.muteBtn.classList.toggle("muted", muted);
  }

  showTutorial(show: boolean): void {
    this.tutorialEl.classList.toggle("show", show);
  }

  showPaused(show: boolean): void {
    this.pausedEl.classList.toggle("show", show);
  }

  showGameOver(
    distance: number,
    coins: number,
    best: number,
    isNewBest: boolean
  ): void {
    this.panelDistanceEl.textContent = String(distance);
    this.panelCoinsEl.textContent = String(coins);
    this.panelBestEl.textContent = String(best);
    this.panelNewBestEl.textContent = isNewBest ? ThemeConfig.labels.newBest : "";
    this.panelEl.classList.add("show");
  }

  hideGameOver(): void {
    this.panelEl.classList.remove("show");
    this.panelNewBestEl.textContent = "";
  }

  /** Reset HUD for a fresh run. */
  reset(): void {
    this.distanceEl.textContent = "0";
    this.coinsEl.textContent = "0";
    this.coinsLabelEl.textContent = ThemeConfig.labels.collectible;
    this.messageEl.classList.remove("show");
    this.messageTimer = 0;
    this.hideGameOver();
  }
}
