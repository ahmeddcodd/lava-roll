/**
 * AudioManager — fully procedural audio via the Web Audio API. No external files
 * (keeps the bundle tiny, in keeping with the asset-free game). Provides one-shot
 * SFX and a looping, speed-reactive music bed.
 *
 * Mute is NOT persisted locally: inside YouTube the mute state is owned entirely
 * by the platform (driven via the SDK's onAudioEnabledChange); standalone it just
 * starts unmuted. No localStorage is used anywhere in the game.
 *
 * The AudioContext starts suspended in most browsers and must be resumed from a
 * user gesture — call resume() on the first pointer/key input.
 */
type Wave = OscillatorType;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private muted = false;

  // Music scheduler state.
  private musicOn = false;
  private nextNoteTime = 0;
  private step = 0;
  private schedulerId: number | null = null;
  private intensity = 0; // 0..1, driven by speed
  private musicTargetGain = 0;

  // Pentatonic-ish bassline + arpeggio (semitone offsets from a root).
  private readonly bass = [0, 0, 7, 5];
  private readonly arp = [12, 15, 19, 24, 19, 15, 12, 15];
  private readonly rootHz = 130.81; // C3

  constructor() {
    // Starts unmuted; mute is driven live by the YouTube SDK when present.
    this.muted = false;
  }

  /** Lazily create the context on first gesture; safe to call repeatedly. */
  resume(): void {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return; // audio unsupported — game still runs silently
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.master);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /**
   * Hard-suspend the whole audio clock (YouTube onPause). Freezes the music
   * scheduler's audio output and all in-flight voices with no state loss —
   * resumeCtx() picks up exactly where it left off. No-op if audio isn't up.
   */
  suspend(): void {
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
  }

  /** Resume the audio clock after a hard suspend (YouTube onResume). */
  resumeCtx(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Toggle mute. Returns the new muted state. */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  // --- Low-level tone helper ---------------------------------------------

  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: Wave;
      gain?: number;
      attack?: number;
      to?: number; // pitch slide target
      dest?: GainNode | null;
      detune?: number;
    } = {}
  ): void {
    const ctx = this.ctx;
    const dest = opts.dest ?? this.sfxGain;
    if (!ctx || !dest) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (opts.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + dur);
    }
    if (opts.detune) osc.detune.value = opts.detune;
    const peak = opts.gain ?? 0.5;
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, hpf = 800): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;
    const t = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hpf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // --- SFX ---------------------------------------------------------------

  collect(combo = 0): void {
    // Rising blip; pitch climbs with combo for a satisfying streak.
    const base = 880 * Math.pow(2, Math.min(combo, 6) / 12);
    this.tone(base, 0.12, { type: "triangle", gain: 0.35, to: base * 1.5 });
  }

  jump(): void {
    this.tone(320, 0.18, { type: "square", gain: 0.28, to: 720 });
  }

  land(): void {
    this.tone(200, 0.12, { type: "sine", gain: 0.4, to: 90 });
    this.noise(0.06, 0.12, 500);
  }

  hit(): void {
    this.tone(160, 0.35, { type: "sawtooth", gain: 0.5, to: 40 });
    this.noise(0.25, 0.35, 300);
  }

  fall(): void {
    this.tone(500, 0.7, { type: "sawtooth", gain: 0.4, to: 60 });
  }

  speedUp(): void {
    this.tone(600, 0.25, { type: "square", gain: 0.3, to: 1200 });
  }

  closeCall(): void {
    this.tone(1400, 0.1, { type: "sine", gain: 0.25, to: 2000 });
  }

  /** Combo milestone: a bright two-note sparkle that climbs with the streak. */
  combo(count = 0): void {
    const semis = Math.min(count, 12);
    const base = 784 * Math.pow(2, semis / 12); // G5 rising with combo
    this.tone(base, 0.12, { type: "triangle", gain: 0.32, to: base * 1.25 });
    this.later(0.08, () =>
      this.tone(base * 1.5, 0.16, { type: "triangle", gain: 0.3, to: base * 1.9 })
    );
  }

  gameOver(): void {
    // Short descending three-note motif.
    const notes = [440, 330, 220];
    notes.forEach((f, i) =>
      this.later(i * 0.14, () =>
        this.tone(f, 0.28, { type: "triangle", gain: 0.4, to: f * 0.98 })
      )
    );
  }

  newBest(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) =>
      this.later(i * 0.09, () =>
        this.tone(f, 0.2, { type: "triangle", gain: 0.35 })
      )
    );
  }

  tap(): void {
    this.tone(660, 0.06, { type: "square", gain: 0.25 });
  }

  private later(delaySec: number, fn: () => void): void {
    window.setTimeout(fn, delaySec * 1000);
  }

  // --- Music (looping, speed-reactive) -----------------------------------

  startMusic(): void {
    if (!this.ctx || !this.musicGain || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    this.musicTargetGain = 0.18;
    this.musicGain.gain.setTargetAtTime(
      this.musicTargetGain,
      this.ctx.currentTime,
      0.4
    );
    this.scheduleLoop();
  }

  /** Duck the music (menu / game over) without stopping the scheduler. */
  duckMusic(): void {
    if (!this.ctx || !this.musicGain) return;
    this.musicTargetGain = 0.06;
    this.musicGain.gain.setTargetAtTime(0.06, this.ctx.currentTime, 0.3);
  }

  liftMusic(): void {
    if (!this.ctx || !this.musicGain) return;
    this.musicTargetGain = 0.18;
    this.musicGain.gain.setTargetAtTime(0.18, this.ctx.currentTime, 0.3);
  }

  stopMusic(): void {
    if (!this.ctx || !this.musicGain) return;
    this.musicOn = false;
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  /** Feed 0..1 speed intensity to make the music rise with velocity. */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  private scheduleLoop(): void {
    if (this.schedulerId !== null) window.clearInterval(this.schedulerId);
    // Look-ahead scheduler: enqueue notes slightly ahead of the audio clock.
    this.schedulerId = window.setInterval(() => {
      const ctx = this.ctx;
      if (!ctx || !this.musicOn) return;
      // Tempo rises with intensity (110 -> ~150 BPM); 8 steps per bar => 16ths.
      const bpm = 110 + this.intensity * 40;
      const stepDur = 60 / bpm / 2;
      while (this.nextNoteTime < ctx.currentTime + 0.15) {
        this.playStep(this.step, this.nextNoteTime, stepDur);
        this.nextNoteTime += stepDur;
        this.step = (this.step + 1) % 16;
      }
    }, 40);
  }

  private playStep(step: number, when: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;

    // Bass on quarter beats.
    if (step % 4 === 0) {
      const semis = this.bass[(step / 4) % this.bass.length];
      this.scheduledTone(
        this.rootHz * Math.pow(2, semis / 12),
        when,
        dur * 3.4,
        "sawtooth",
        0.16
      );
    }

    // Arpeggio every step; brighter/louder with intensity.
    const semis = this.arp[step % this.arp.length] + (this.intensity > 0.6 ? 12 : 0);
    const arpGain = 0.05 + this.intensity * 0.09;
    this.scheduledTone(
      this.rootHz * Math.pow(2, semis / 12),
      when,
      dur * 0.9,
      "square",
      arpGain
    );

    // Hi-hat-ish tick on offbeats when moving fast.
    if (this.intensity > 0.35 && step % 2 === 1) {
      this.scheduledNoise(when, 0.02, 0.03 + this.intensity * 0.04);
    }
  }

  private scheduledTone(
    freq: number,
    when: number,
    dur: number,
    type: Wave,
    gain: number
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  private scheduledNoise(when: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.musicGain);
    src.start(when);
    src.stop(when + dur + 0.02);
  }

  dispose(): void {
    this.stopMusic();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}
