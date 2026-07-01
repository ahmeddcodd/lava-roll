import "./style.css";
import { Game } from "./game/Game";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;

const game = new Game(canvas, hud);
game.start();
