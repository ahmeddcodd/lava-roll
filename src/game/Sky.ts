import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";

/**
 * Procedural gradient backdrop (design doc §7) with a FLAT horizon.
 *
 * Implementation: an inward-facing CYLINDER parented to the camera with
 * `infiniteDistance` (so it always renders at the back and never clips the far
 * plane). Unlike a sphere — whose gradient wraps the equator into a curved band
 * that sat mid-screen where props appear — a cylinder maps the vertical gradient
 * straight down its side, giving a level horizon line. Its height is tuned so the
 * warm horizon band lines up with the ground horizon, so distant props read as
 * rising OVER the horizon instead of dropping out of the sky. Tall enough that its
 * caps stay out of frame at every FOV/aspect.
 *
 * Unlit + fog-exempt so the gradient reads cleanly.
 */
export class Sky {
  private readonly dome: Mesh;
  private readonly tex: DynamicTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texH: number;

  // Last-applied colors, so we only repaint the gradient when it actually changes.
  private readonly lastTop = new Color3(-1, -1, -1);
  private readonly lastHorizon = new Color3(-1, -1, -1);

  constructor(scene: Scene, camera: Camera) {
    // Narrow, tall gradient texture painted top→bottom.
    const w = 2;
    const h = 256;
    this.texH = h;
    this.tex = new DynamicTexture("skyGradient", { width: w, height: h }, scene, false);
    this.ctx = this.tex.getContext() as CanvasRenderingContext2D;

    const mat = new StandardMaterial("matSky", scene);
    mat.emissiveTexture = this.tex; // unlit color comes from the gradient
    mat.disableLighting = true;
    mat.backFaceCulling = false; // viewed from inside the cylinder
    mat.fogEnabled = false; // horizon must not be eaten by fog
    mat.specularColor = new Color3(0, 0, 0);
    mat.diffuseColor = new Color3(0, 0, 0);

    // Inward-facing cylinder: vertical gradient down the wall = flat horizon.
    // Wide + tall so the flat caps never enter frame. `infiniteDistance` keeps it
    // pinned behind the world; the actual size only sets how the gradient maps.
    // Tall + wide so neither the open rim nor the (absent) caps ever enter frame
    // at any FOV/aspect — only the seamless wall is visible. The gradient is packed
    // into the lower portion of the wall (see setColors), which is the slice the
    // camera actually sees, so the deep→horizon transition stays on-screen.
    this.dome = MeshBuilder.CreateCylinder(
      "skyDome",
      {
        diameter: 120,
        height: 200,
        tessellation: 32,
        cap: Mesh.NO_CAP,
        sideOrientation: Mesh.BACKSIDE,
      },
      scene
    );
    this.dome.material = mat;
    this.dome.isPickable = false;
    this.dome.infiniteDistance = true; // always centred on camera, at the back
    this.dome.applyFog = false;
    this.dome.parent = camera;
    // Centre the wall on the camera so its top/bottom rims stay far out of frame.
    this.dome.position.set(0, 0, 0);

    // Prime with a neutral fill until the biome sets real colors.
    this.setColors(new Color3(0.1, 0.05, 0.07), new Color3(0.35, 0.12, 0.04));
  }

  /**
   * Repaint the vertical gradient: `top` at the frame top easing down to
   * `horizon` at the horizon band near the bottom. No-op when colors are unchanged.
   */
  setColors(top: Color3, horizon: Color3): void {
    if (this.lastTop.equals(top) && this.lastHorizon.equals(horizon)) return;
    this.lastTop.copyFrom(top);
    this.lastHorizon.copyFrom(horizon);

    // The DynamicTexture's canvas y=0 is the TOP; on the cylinder that maps to
    // the wall's TOP (deep sky) and canvas y=texH (bottom) maps to the horizon.
    // The camera only sees the middle-lower band of the wall, so pack the
    // deep→horizon transition there: deep fills the upper wall, the warm horizon
    // sits around the lower-middle (~0.62), then a dark skirt below (out of frame).
    const grd = this.ctx.createLinearGradient(0, 0, 0, this.texH);
    grd.addColorStop(0, rgb(top)); // wall top: deep sky (fills above the view)
    grd.addColorStop(0.45, rgb(top));
    grd.addColorStop(0.58, rgb(mix(top, horizon, 0.6)));
    grd.addColorStop(0.66, rgb(horizon)); // warm horizon band (in the lower view)
    grd.addColorStop(0.72, rgb(mix(horizon, top, 0.55))); // dim just under horizon
    grd.addColorStop(1, rgb(top)); // wall bottom: dark (below frame)
    this.ctx.fillStyle = grd;
    this.ctx.fillRect(0, 0, 2, this.texH);
    this.tex.update();
  }

  /** Debug: the currently applied gradient colors (for automated verification). */
  debugColors(): { top: Color3; horizon: Color3 } {
    return { top: this.lastTop, horizon: this.lastHorizon };
  }

  dispose(): void {
    this.dome.material?.dispose();
    this.dome.dispose();
    this.tex.dispose();
  }
}

function rgb(c: Color3): string {
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${to255(c.r)},${to255(c.g)},${to255(c.b)})`;
}

function mix(a: Color3, b: Color3, t: number): Color3 {
  return new Color3(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t
  );
}
