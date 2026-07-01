/**
 * InputManager — produces a normalized steer value in [-1, 1] from pointer drag
 * (touch + mouse) with keyboard fallback (A/D + arrows). Drag is relative to the
 * press point rather than absolute screen position (design doc §5.2), so the
 * player can grab anywhere and steer by dragging.
 */
export class InputManager {
  /** Smoothed steer value in [-1, 1]. */
  steerX = 0;

  /** Fired the first time any input arrives while in the Ready state. */
  onFirstInput: (() => void) | null = null;

  private rawSteer = 0;
  private pointerId: number | null = null;
  private pointerStartX = 0;
  private readonly keys = new Set<string>();

  // Drag distance (px) that maps to full steer. Scaled by screen size.
  private dragRange = 140;

  private readonly canvas: HTMLCanvasElement;
  private started = false;

  private readonly onDown: (e: PointerEvent) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.updateDragRange();

    this.onDown = (e) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.pointerStartX = e.clientX;
      this.rawSteer = 0;
      // Fire the run-start first — a capture failure must never block gameplay.
      this.fireFirstInput();
      // Pointer capture keeps drags tracked even if the pointer leaves the
      // canvas; failure is harmless (some synthetic/edge cases have no capture).
      try {
        this.canvas.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    this.onMove = (e) => {
      if (e.pointerId !== this.pointerId) return;
      const dx = e.clientX - this.pointerStartX;
      this.rawSteer = clamp(dx / this.dragRange, -1, 1);
      // Re-anchor gently when the drag saturates so the player can keep steering.
      if (this.rawSteer === 1 || this.rawSteer === -1) {
        this.pointerStartX = e.clientX - this.rawSteer * this.dragRange;
      }
    };

    this.onUp = (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.rawSteer = 0;
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
    canvas.addEventListener("pointermove", this.onMove);
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

  /** Recompute drag sensitivity from the current viewport width. */
  updateDragRange(): void {
    this.dragRange = Math.max(90, Math.min(220, window.innerWidth * 0.22));
  }

  /** Call once per frame to advance the smoothed steer value. */
  update(): void {
    // Keyboard overrides pointer when held.
    let target = this.rawSteer;
    const left = this.keys.has("a") || this.keys.has("arrowleft");
    const right = this.keys.has("d") || this.keys.has("arrowright");
    if (left && !right) target = -1;
    else if (right && !left) target = 1;

    // Light smoothing to remove jitter; the ball applies its own steerLerp too.
    this.steerX += (target - this.steerX) * 0.5;
  }

  /** Clears held input; used on state transitions. */
  reset(): void {
    this.rawSteer = 0;
    this.steerX = 0;
    this.pointerId = null;
    this.keys.clear();
  }

  /** Re-arms first-input detection for a new run. */
  armFirstInput(): void {
    this.started = false;
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function isSteerKey(k: string): boolean {
  return k === "a" || k === "d" || k === "arrowleft" || k === "arrowright";
}
