import "./style.css";
import { Game } from "./game/Game";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;

const game = new Game(canvas, hud);
game.start();

// Debug handle for automated verification only (opt-in via ?debug). No effect
// on normal play — the flag is never set in production URLs.
if (new URLSearchParams(location.search).has("debug")) {
  (window as unknown as { __game: Game }).__game = game;
}
