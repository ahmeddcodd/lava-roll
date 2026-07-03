/**
 * InputManager — produces a normalized steer value in [-1, 1] from pointer input
 * (touch + mouse) with keyboard fallback (A/D + arrows).
 *
 * Two distinct pointer schemes (design doc §5.2), picked by device:
 *  - **Mouse (fine pointer / desktop):** the ball follows the cursor's absolute
 *    horizontal position over the canvas — no click required, and releasing does
 *    nothing (there is nothing to release). Move the mouse, the ball tracks it.
 *  - **Touch (coarse pointer / mobile):** drag to steer. Steer is the accumulated
 *    drag rather than an absolute; lifting your finger LEAVES the ball where it is
 *    (no snap back to center), so quick re-grabs feel continuous and responsive.
 */
export class InputManager {
  /** Smoothed steer value in [-1, 1]. */
  steerX = 0;

  /** Fired the first time any input arrives while in the Ready state. */
  onFirstInput: (() => void) | null = null;

  private rawSteer = 0;
  private pointerId: number | null = null;
  private pointerStartX = 0;
  // Steer value captured at the moment of the current drag's press, so the drag
  // adds to (rather than replaces) where the ball already was — no snap-back.
  private steerAtPress = 0;
  private readonly keys = new Set<string>();

  // True on touch/pen (coarse) devices — selects the drag scheme. Mouse devices
  // use absolute cursor-position steering with no press required.
  private readonly usesTouch: boolean;

  // Drag distance (px) that maps to full steer. Scaled by screen size (touch).
  private dragRange = 140;
  // Canvas width cached for absolute mouse mapping.
  private canvasWidth = 1;

  private readonly canvas: HTMLCanvasElement;
  private started = false;

  private readonly onDown: (e: PointerEvent) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.usesTouch =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: coarse)").matches
        : "ontouchstart" in window;
    this.updateDragRange();

    this.onDown = (e) => {
      // Mouse: any button press just arms the run + audio; steering is by move.
      this.fireFirstInput();
      if (!this.usesTouch) return;

      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.pointerStartX = e.clientX;
      // Continue steering from the current position rather than re-centering.
      this.steerAtPress = this.rawSteer;
      // Pointer capture keeps drags tracked even if the pointer leaves the
      // canvas; failure is harmless (some synthetic/edge cases have no capture).
      try {
        this.canvas.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    this.onMove = (e) => {
      if (this.usesTouch) {
        // Drag scheme: only the captured pointer steers, added onto the press
        // anchor so the ball keeps its position across grabs (no snap-back).
        if (e.pointerId !== this.pointerId) return;
        const dx = e.clientX - this.pointerStartX;
        this.rawSteer = clamp(this.steerAtPress + dx / this.dragRange, -1, 1);
        return;
      }
      // Mouse scheme: absolute cursor X across the canvas maps straight to steer.
      // No button needed — the ball tracks the cursor's horizontal position.
      const rect = this.canvas.getBoundingClientRect();
      const norm = (e.clientX - rect.left) / (rect.width || this.canvasWidth);
      this.rawSteer = clamp(norm * 2 - 1, -1, 1);
    };

    this.onUp = (e) => {
      if (!this.usesTouch) return;
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      // Intentionally DO NOT reset rawSteer — the ball stays where the player
      // left it, so lifting a finger never yanks it back to the center lane.
      try {
        this.canvas.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    this.onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (isSteerKey(k)) {
        this.keys.add(k);
        this.fireFirstInput();
        e.preventDefault();
      }
    };

    this.onKeyUp = (e) => {
      this.keys.delete(e.key.toLowerCase());
    };

    canvas.addEventListener("pointerdown", this.onDown);
    // Mouse steering needs move events even with no button down, so listen on
    // the window; the handler filters by scheme / captured pointer id.
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private fireFirstInput(): void {
    if (!this.started) {
      this.started = true;
      this.onFirstInput?.();
    }
  }

  /** Recompute drag sensitivity + canvas width from the current viewport. */
  updateDragRange(): void {
    // Short drag distance to reach full steer => a small flick fully deflects,
    // for a snappy, responsive touch feel.
    this.dragRange = Math.max(55, Math.min(120, window.innerWidth * 0.13));
    this.canvasWidth = this.canvas.clientWidth || window.innerWidth;
  }

  /** Call once per frame to compute the current steer value. */
  update(dt = 0): void {
    // Keyboard: while held, glide the steer toward the edge (fast, but not an
    // instant teleport) and PERSIST it in rawSteer, so releasing the key leaves
    // the ball where it landed instead of snapping back to the center lane.
    const left = this.keys.has("a") || this.keys.has("arrowleft");
    const right = this.keys.has("d") || this.keys.has("arrowright");
    if (left !== right) {
      const dir = left ? -1 : 1;
      this.rawSteer = clamp(this.rawSteer + dir * KEY_STEER_RATE * dt, -1, 1);
    }
    // Pointer (mouse position or accumulated touch drag) and keyboard all feed
    // rawSteer; the ball's own lerp provides the smoothing, so pass it through.
    this.steerX = this.rawSteer;
  }

  /** Clears held input; used on state transitions. */
  reset(): void {
    this.rawSteer = 0;
    this.steerX = 0;
    this.steerAtPress = 0;
    this.pointerId = null;
    this.keys.clear();
  }

  /** Re-arms first-input detection for a new run. */
  armFirstInput(): void {
    this.started = false;
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}

// How fast a held steer key drives the steer target toward its edge (units/sec
// of the [-1,1] range). ~4 crosses the full range in ~0.25s — snappy but not an
// instant jump, and it persists so releasing never re-centers the ball.
const KEY_STEER_RATE = 4;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function isSteerKey(k: string): boolean {
  return k === "a" || k === "d" || k === "arrowleft" || k === "arrowright";
}
