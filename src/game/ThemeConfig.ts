/**
 * ThemeConfig — the single reskin surface (design doc §20).
 * Swap this object to retheme the whole game: material colors, fog, UI palette,
 * text labels, and effect colors all read from here.
 */
export interface Theme {
  id: string;
  displayName: string;
  colors: {
    background: string;
    fog: string;
    track: string;
    edge: string;
    lava: string;
    lavaBright: string;
    collectible: string;
    danger: string;
    /** Hazard body emissive glow — a warm warning tone that contrasts every biome. */
    emberWarn: string;
    /** Hazard warning rim — bright warm-white edge stripe (universal danger read). */
    hazardRim: string;
    uiMain: string;
    uiText: string;
    pillar: string;
  };
  labels: {
    collectible: string;
    tutorial: string;
    speedUp: string;
    closeCall: string;
    newBest: string;
    gameOver: string;
    retry: string;
    paused: string;
    distance: string;
  };
  gameplay: {
    trailColor: string;
    speedPadColor: string;
    emberColor: string;
  };
}

export const ThemeConfig: Theme = {
  id: "lava_temple",
  displayName: "Lava Temple Roll",
  colors: {
    background: "#090405",
    fog: "#180808",
    track: "#2b2524",
    edge: "#42322e",
    lava: "#ff4a00",
    lavaBright: "#ffcc33",
    collectible: "#ffd447",
    danger: "#ff1f00",
    emberWarn: "#ff8a1e",
    hazardRim: "#ffe9b0",
    uiMain: "#ffb347",
    uiText: "#fff4d0",
    pillar: "#191214",
  },
  labels: {
    collectible: "Idols",
    tutorial: "DRAG TO STEER",
    speedUp: "SPEED UP!",
    closeCall: "CLOSE CALL!",
    newBest: "NEW BEST!",
    gameOver: "GAME OVER",
    retry: "RETRY",
    paused: "PAUSED",
    distance: "Distance",
  },
  gameplay: {
    trailColor: "#ff6a00",
    speedPadColor: "#ffcc33",
    emberColor: "#ff8a1e",
  },
};
