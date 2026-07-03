import "./style.css";
import { Game } from "./game/Game";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;

const game = new Game(canvas, hud);
// start() is async (renders the first frame, signals firstFrameReady, awaits any
// YouTube cloud-save hydration, then signals gameReady + runs the loop).
void game.start();

// Debug handle for automated verification only (opt-in via ?debug). No effect
// on normal play — the flag is never set in production URLs.
if (new URLSearchParams(location.search).has("debug")) {
  (window as unknown as { __game: Game }).__game = game;
}
