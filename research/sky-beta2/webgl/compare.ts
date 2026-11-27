// β2 の比較ページ（#537）：高知の固定事例（太陽 +5°・−1.9°・−6.8°）で、太陽側・横・反対側を同じ視線で並べる。
// - β1：今の空の絵（shared/skyScene.ts の晴天大気。表示用の色）
// - OpenGL 参照：Bruneton のモデルを PC（Mesa llvmpipe）で計算した輝度（15 波長を CIE の等色関数で積分した表、opengl/kochi_ref）
// - WebGL 2：同じ事前計算の表（半精度）を、このブラウザで同じ視線に読み出した輝度
// 色変換：輝度 L（cd/m²、線形 sRGB）→ 1 − exp(−E·L) → sRGB の符号化。露出 E は 2 通り：
//   固定（3 事例で同じ。日没に伴う暗さを比べる）と、場面ごと（その場面の帯の明るい所（99 パーセンタイル）が白に飛ばない値。方位ごとの色を比べる）。
// β1 は物理の明るさを持たないので、色だけを並べる。
import { skyAt } from "../../../shared/sky";
import { type SceneInput, skyRgb, skyWeatherFrom } from "../../../shared/skyScene";
import { HillaireSky } from "./hillaire";

type View = { id: string; diff: number | null; az: number; alt: number };
type Case = { id: string; date: string; time: string; sunAlt: number; sunAz: number; views: View[] };
type Cases = { observerHeightM: number; panorama: { az: number[]; alt: number[] }; cases: Case[] };
type RefView = { luminance: number[]; spectral: number[]; radiance: number[]; transmittance: number[] };
type Ref = { meta: Record<string, Record<string, string[]>>; cases: Record<string, Record<string, RefView>> };

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const log = (t: string) => {
  $("#status").textContent = t;
};
const BOTTOM_RADIUS_KM = 6360;
const DIMS = { transmittance: [256, 64], scattering: [256, 128, 32], irradiance: [64, 16] };

/** 固定の露出（3 事例で同じ）：+5° の太陽側の低空（約 2 万 cd/m²）が白に飛ばない値。 */
const E_FIXED = 1e-4;
/** 3 波長の近似（今までの比較）の露出（Bruneton のデモと同じ 10、白は太陽スペクトル）。 */
const E_RAD = 10;
let WHITE = [1, 1, 1];

function dir(azDeg: number, altDeg: number): [number, number, number] {
  const az = (azDeg * Math.PI) / 180;
  const alt = (altDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
}
const srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
function tone(l: number[], e: number, white = [1, 1, 1]): number[] {
  return l.slice(0, 3).map((x, i) => Math.round(255 * Math.min(1, Math.max(0, srgb(1 - Math.exp((-Math.max(0, x) / white[i]) * e))))));
}
const hex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const fmtE = (e: number) => e.toExponential(2).replace("e", "×10^");

// 表・帯は base64 の文字（.f16.txt。非公開のページは任意の 2 進のファイルを配らないため）
async function f16(url: string): Promise<Uint16Array> {
  const res = await fetch(url + ".txt");
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bin = atob(await res.text());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint16Array(bytes.buffer);
}
function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

const FRAGMENT = `
uniform vec3 camera;
uniform vec3 sun_direction;
uniform highp sampler2D views;
layout(location = 0) out vec4 luminance;
vec3 GetSkyLuminance(vec3 camera, vec3 view_ray, float shadow_length, vec3 sun_direction, out vec3 transmittance);
void main() {
  vec3 v = normalize(texelFetch(views, ivec2(gl_FragCoord.xy), 0).xyz);
  vec3 t;
  luminance = vec4(GetSkyLuminance(camera, v, 0.0, sun_direction, t), 1.0);
}`;

class WebGlSky {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  floatTarget: boolean;
  constructor(shaderSource: string, tables: Record<string, Uint16Array>) {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 が使えない");
    this.gl = gl;
    this.floatTarget = !!gl.getExtension("EXT_color_buffer_float");
    if (!this.floatTarget && !gl.getExtension("EXT_color_buffer_half_float")) throw new Error("浮動小数の描き先が使えない");
    const tex = (unit: number, target: number) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, t);
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    };
    tex(0, gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, DIMS.transmittance[0], DIMS.transmittance[1], 0, gl.RGBA, gl.HALF_FLOAT, tables.transmittance);
    tex(1, gl.TEXTURE_3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, DIMS.scattering[0], DIMS.scattering[1], DIMS.scattering[2], 0, gl.RGBA, gl.HALF_FLOAT, tables.scattering);
    tex(2, gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, DIMS.irradiance[0], DIMS.irradiance[1], 0, gl.RGBA, gl.HALF_FLOAT, tables.irradiance);
    tex(3, gl.TEXTURE_3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, DIMS.scattering[0], DIMS.scattering[1], DIMS.scattering[2], 0, gl.RGBA, gl.HALF_FLOAT, tables.single_mie_scattering);
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, "#version 300 es\nlayout(location = 0) in vec2 p;\nvoid main() { gl_Position = vec4(p, 0.0, 1.0); }");
    const fs = sh(
      gl.FRAGMENT_SHADER,
      shaderSource.replace("#version 330", "#version 300 es\nprecision highp float;\nprecision highp sampler3D;\nprecision highp sampler2D;") + FRAGMENT,
    );
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    this.program = p;
    gl.useProgram(p);
    const u = (n: string) => gl.getUniformLocation(p, n);
    gl.uniform1i(u("transmittance_texture"), 0);
    gl.uniform1i(u("scattering_texture"), 1);
    gl.uniform1i(u("irradiance_texture"), 2);
    gl.uniform1i(u("single_mie_scattering_texture"), 3);
    gl.uniform1i(u("views"), 5);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }
  /** 方向（w×h）ごとの輝度。読み戻しまでの時間（ms）も返す。 */
  evaluate(dirs: Float32Array, w: number, h: number, heightM: number, sun: [number, number, number]): { lum: Float32Array; ms: number } {
    const gl = this.gl;
    const t0 = performance.now();
    gl.uniform3f(gl.getUniformLocation(this.program, "camera"), 0, 0, BOTTOM_RADIUS_KM + heightM / 1000);
    gl.uniform3f(gl.getUniformLocation(this.program, "sun_direction"), ...sun);
    const vt = gl.createTexture();
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, vt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, w, h, 0, gl.RGB, gl.FLOAT, dirs);
    const target = gl.createTexture();
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.floatTarget ? gl.RGBA32F : gl.RGBA16F, w, h, 0, gl.RGBA, this.floatTarget ? gl.FLOAT : gl.HALF_FLOAT, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const rgba = new Float32Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, rgba);
    const ms = performance.now() - t0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(target);
    gl.deleteTexture(vt);
    const lum = new Float32Array(w * h * 3);
    for (let k = 0; k < w * h; k++) for (let c = 0; c < 3; c++) lum[k * 3 + c] = rgba[k * 4 + c];
    return { lum, ms };
  }
}

function beta1Scene(c: Case): SceneInput {
  // 晴れ（雲を描かない）、月なし。今の空の絵と同じ晴天大気。
  return { clear: skyAt(c.sunAlt, 1, 0, true), sunAlt: c.sunAlt, sunAz: c.sunAz, moonAlt: -30, moonAz: 0, moonLit: 0, wx: skyWeatherFrom([], 1, "47893"), seed: 1 };
}

type Result = { c: Case; webViews: Float32Array; webPano: Float32Array; refPano: Float32Array; viewMs: number; panoMs: number; eScene: number; hilViews: Float32Array; hilTrans: Float32Array; hilPano: Float32Array; hilMs: number; eHil: number; radPano: Float32Array | null };

/** 場面ごとの露出：帯（地平線より上）の輝度（G）の 99 パーセンタイルが 0.9（1 − exp(−2.3)）になる値。 */
function sceneExposure(pano: Float32Array, w: number, h: number, alt0: number, altStep: number): number {
  const v: number[] = [];
  for (let j = 0; j < h; j++) {
    if (alt0 + j * altStep < 0) continue;
    for (let i = 0; i < w; i++) v.push(pano[(j * w + i) * 3 + 1]);
  }
  v.sort((a, b) => a - b);
  return 2.3 / Math.max(1e-6, v[Math.floor(v.length * 0.99)]);
}

function drawPanoramas(results: Result[], cases: Cases) {
  const [az0, az1, azStep] = cases.panorama.az;
  const [alt0, alt1, altStep] = cases.panorama.alt;
  const w = Math.round((az1 - az0) / azStep);
  const h = Math.round((alt1 - alt0) / altStep) + 1;
  const host = $("#panos");
  host.textContent = "";
  for (const r of results) {
    const box = document.createElement("section");
    box.className = "case";
    const title = document.createElement("h2");
    title.textContent = `${r.c.id}：${r.c.date} ${r.c.time}・太陽 高さ ${r.c.sunAlt.toFixed(1)}°・方位 ${r.c.sunAz.toFixed(1)}°`;
    const ex = document.createElement("p");
    ex.className = "ex";
    ex.textContent = `露出 E：Bruneton（輝度）固定 ${fmtE(E_FIXED)}／場面ごと ${fmtE(r.eScene)}（固定の ${(r.eScene / E_FIXED).toFixed(1)} 倍）。Hillaire（3 波長の放射輝度）固定 ${E_RAD}／場面ごと ${r.eHil.toFixed(1)}（${(r.eHil / E_RAD).toFixed(1)} 倍）`;
    box.append(title, ex);
    const at = (pano: Float32Array, i: number, j: number) => Array.from(pano.subarray((j * w + i) * 3, (j * w + i) * 3 + 3));
    const rows: [string, (i: number, j: number) => number[]][] = [
      ["β1（今の空の絵・表示の色）", (i, j) => skyRgb(beta1Scene(r.c), az0 + i * azStep, Math.max(0, alt0 + j * altStep)).map((v) => v * 255)],
      ["OpenGL 参照（PC）・固定の露出", (i, j) => tone(at(r.refPano, i, j), E_FIXED)],
      ["WebGL 2（このブラウザ）・固定の露出", (i, j) => tone(at(r.webPano, i, j), E_FIXED)],
      ["WebGL 2（このブラウザ）・場面ごとの露出", (i, j) => tone(at(r.webPano, i, j), r.eScene)],
      ["Hillaire（WebGL 2、3 波長）・固定の露出", (i, j) => tone(at(r.hilPano, i, j), E_RAD, WHITE)],
      ["Hillaire（WebGL 2、3 波長）・場面ごとの露出", (i, j) => tone(at(r.hilPano, i, j), r.eHil, WHITE)],
    ];
    // 同じ 3 波長・同じ表示・同じ露出の Bruneton（方式の違いだけを見る。11/27）
    const rp = r.radPano;
    if (rp) {
      rows.splice(rows.length - 2, 0, ["Bruneton（PC、3 波長・Hillaire と同じ表示）・固定の露出", (i, j) => tone(at(rp, i, j), E_RAD, WHITE)]);
      rows.push(["Bruneton（PC、3 波長・Hillaire と同じ表示）・Hillaire と同じ場面ごとの露出", (i, j) => tone(at(rp, i, j), r.eHil, WHITE)]);
    }
    for (const [label, px] of rows) {
      const fig = document.createElement("figure");
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const g = cv.getContext("2d")!;
      const img = g.createImageData(w, h);
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const c = px(i, j);
          const k = ((h - 1 - j) * w + i) * 4;
          img.data[k] = c[0];
          img.data[k + 1] = c[1];
          img.data[k + 2] = c[2];
          img.data[k + 3] = 255;
        }
      g.putImageData(img, 0, 0);
      const sx = ((r.c.sunAz - az0) / (az1 - az0)) * w;
      g.fillStyle = "#fff";
      g.fillRect(Math.round(sx), h - 6, 1, 6);
      const ticks = document.createElement("div");
      ticks.className = "ticks";
      ticks.innerHTML = ["北", "東", "南", "西", "北"].map((t, k) => `<span style="left:${k * 25}%">${t}</span>`).join("");
      const cap = document.createElement("figcaption");
      cap.textContent = label;
      fig.append(cv, ticks, cap);
      box.append(fig);
    }
    host.append(box);
  }
}

function drawTable(results: Result[], ref: Ref) {
  const host = $("#table");
  host.textContent = "";
  const t = document.createElement("table");
  t.innerHTML =
    "<thead><tr><th>事例</th><th>視線</th><th>β1</th><th>WebGL 2（場面ごと）</th><th>多波長 CPU（場面ごと）</th><th>3 波長の近似</th><th>Hillaire（3 波長）</th><th>輝度 cd/m²（OpenGL、15 波長）</th><th>多波長 CPU / 15 波長</th><th>WebGL / OpenGL</th><th>550 nm mW（Bruneton / Hillaire）</th><th>透過率（680/550/440 nm）</th></tr></thead>";
  const tb = document.createElement("tbody");
  for (const r of results) {
    r.c.views.forEach((v, k) => {
      if (!(v.id === "zenith" || [0, 90, 180].includes(v.diff ?? -1)) || ![3, 20, 90].includes(v.alt)) return;
      const o = ref.cases[r.c.id][v.id];
      const web = Array.from(r.webViews.subarray(k * 3, k * 3 + 3));
      const b1 = skyRgb(beta1Scene(r.c), v.az, v.alt).map((x) => x * 255);
      const sw = (c: number[]) => `<span class="sw" style="background:${hex(c)}"></span>${hex(c)}`;
      const hil = Array.from(r.hilViews.subarray(k * 3, k * 3 + 3));
      const ratio = (a: number[], b: number[]) => a.map((x, i) => (Math.abs(b[i]) > 1 ? (x / b[i]).toFixed(3) : "—")).join(" / ");
      const name = v.id === "zenith" ? "天頂" : `${v.diff === 0 ? "太陽側" : v.diff === 90 ? "横" : "反対側"}・${v.alt}°`;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.c.id}</td><td>${name}</td><td>${sw(b1)}</td><td>${sw(tone(web, r.eScene))}</td><td>${sw(tone(o.spectral, r.eScene))}</td><td>${sw(
        tone(o.radiance, E_RAD, WHITE),
      )}</td><td>${sw(tone(hil, E_RAD, WHITE))}</td><td>${o.luminance.map((x) => x.toFixed(1)).join(" / ")}</td><td>${ratio(o.spectral, o.luminance)}</td><td>${ratio(web, o.luminance)}</td><td>${(o.radiance[1] * 1000).toFixed(2)} / ${(hil[1] * 1000).toFixed(2)}</td><td>${o.transmittance
        .map((x) => x.toFixed(3))
        .join(" / ")}</td>`;
      tb.append(tr);
    });
  }
  t.append(tb);
  host.append(t);
}

async function main() {
  const t0 = performance.now();
  log("読み込み中…");
  const [cases, ref, shader, transmittance, scattering, single_mie_scattering, irradiance] = await Promise.all([
    fetch("data/cases.json").then((r) => r.json() as Promise<Cases>),
    fetch("data/ref.json").then((r) => r.json() as Promise<Ref>),
    fetch("data/atmosphere_shader.glsl").then((r) => r.text()),
    f16("data/transmittance.f16"),
    f16("data/scattering.f16"),
    f16("data/single_mie_scattering.f16"),
    f16("data/irradiance.f16"),
  ]);
  const tLoad = performance.now() - t0;
  WHITE = (ref.meta.radiance.white_point?.[0] ?? "1 1 1").split(" ").map(Number);
  const t1 = performance.now();
  const sky = new WebGlSky(shader, { transmittance, scattering, single_mie_scattering, irradiance });
  const tInit = performance.now() - t1;
  const [az0, az1, azStep] = cases.panorama.az;
  const [alt0, alt1, altStep] = cases.panorama.alt;
  const w = Math.round((az1 - az0) / azStep);
  const h = Math.round((alt1 - alt0) / altStep) + 1;
  const pano = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pano.set(dir(az0 + i * azStep, alt0 + j * altStep), (j * w + i) * 3);
  const hgl = document.createElement("canvas").getContext("webgl2");
  if (!hgl) throw new Error("WebGL 2 が使えない");
  // Hillaire の視線あたりの段数（?steps=192 などで変える。−6.8° の東の暗い弧が刻み数で動くかを見る）
  const steps = Number(new URLSearchParams(location.search).get("steps")) || 96;
  // 多重散乱の表の大きさ（?ms=32 など。既定 128：32 では深い薄明の暗い側が 2〜3 倍明るく出た、results.md 21:40）
  const msSize = Number(new URLSearchParams(location.search).get("ms")) || 128;
  const hil = new HillaireSky(hgl, steps, msSize);
  const results: Result[] = [];
  for (const c of cases.cases) {
    const sun = dir(c.sunAz, c.sunAlt);
    const vd = new Float32Array(c.views.length * 3);
    c.views.forEach((v, k) => vd.set(dir(v.az, v.alt), k * 3));
    const a = sky.evaluate(vd, c.views.length, 1, cases.observerHeightM, sun);
    const b = sky.evaluate(pano, w, h, cases.observerHeightM, sun);
    const raw = await f16(`data/${c.id}.pano.f16`);
    const refPano = new Float32Array(raw.length);
    for (let k = 0; k < raw.length; k++) refPano[k] = halfToFloat(raw[k]);
    const hv = hil.evaluate(vd, c.views.length, 1, cases.observerHeightM, sun);
    const hp = hil.evaluate(pano, w, h, cases.observerHeightM, sun);
    let radPano: Float32Array | null = null;
    try {
      const rr = await f16(`data/${c.id}.radpano.f16`);
      radPano = new Float32Array(rr.length);
      for (let k = 0; k < rr.length; k++) radPano[k] = halfToFloat(rr[k]);
    } catch {
      radPano = null; // 古いデータ（3 波長の帯なし）
    }
    const hpWhite = new Float32Array(hp.rad.length);
    for (let k = 0; k < hp.rad.length; k++) hpWhite[k] = hp.rad[k] / WHITE[k % 3];
    results.push({
      c,
      webViews: a.lum,
      webPano: b.lum,
      refPano,
      viewMs: a.ms,
      panoMs: b.ms,
      eScene: sceneExposure(b.lum, w, h, alt0, altStep),
      hilViews: hv.rad,
      hilTrans: hv.trans,
      hilPano: hp.rad,
      hilMs: hp.ms,
      radPano,
      eHil: sceneExposure(hpWhite, w, h, alt0, altStep),
    });
  }
  let worst = 0;
  for (const r of results)
    r.c.views.forEach((v, k) => {
      const o = ref.cases[r.c.id][v.id].luminance;
      for (let i = 0; i < 3; i++) if (o[i] > 1) worst = Math.max(worst, Math.abs(r.webViews[k * 3 + i] / o[i] - 1));
    });
  const gl = sky.gl;
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const info = {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    floatTarget: sky.floatTarget,
    loadMs: Math.round(tLoad),
    initMs: Math.round(tInit),
    viewsMs: results.map((r) => +r.viewMs.toFixed(1)),
    panoMs: results.map((r) => +r.panoMs.toFixed(1)),
    worstRelDiff: +worst.toPrecision(3),
    exposures: results.map((r) => ({ id: r.c.id, fixed: E_FIXED, scene: +r.eScene.toPrecision(3), hilFixed: E_RAD, hilScene: +r.eHil.toPrecision(3) })),
    hillaire: { lutMs: Math.round(hil.lutMs), panoMs: results.map((r) => +r.hilMs.toFixed(1)), steps: hil.steps, msSize: hil.msSize },
    userAgent: navigator.userAgent,
  };
  (window as unknown as { __b2: unknown }).__b2 = {
    info,
    results: results.map((r) => {
      // 太陽の反対の方位の縦の列（高さ −2〜60°）：Bruneton と Hillaire の G
      const col = Math.round((((r.c.sunAz + 180) % 360) - az0) / azStep) % w;
      const prof = (pano: Float32Array) => Array.from({ length: h }, (_, j) => pano[(j * w + col) * 3 + 1]);
      return { id: r.c.id, views: Array.from(r.webViews), eScene: r.eScene, hillaire: Array.from(r.hilViews), hillaireTrans: Array.from(r.hilTrans), antiBruneton: prof(r.webPano), antiHillaire: prof(r.hilPano) };
    }),
  };
  $("#info").textContent =
    `描画：${info.renderer}（描き先 ${info.floatTarget ? "32bit" : "16bit"}）・表の読み込み ${info.loadMs} ms・準備 ${info.initMs} ms・` +
    `視線 ${info.viewsMs.join("/")} ms・帯（${w}×${h}）${info.panoMs.join("/")} ms・OpenGL との最大の差 ${info.worstRelDiff < 1e-4 ? "0.01% 未満" : (info.worstRelDiff * 100).toFixed(2) + "%"}（輝度 1 cd/m² 超の視線）。Hillaire：表を作る ${info.hillaire.lutMs} ms・帯 ${info.hillaire.panoMs.join("/")} ms（視線あたり ${info.hillaire.steps} 段・多重散乱の表 ${info.hillaire.msSize}×${info.hillaire.msSize}）`;
  drawPanoramas(results, cases);
  drawTable(results, ref);
  log("");
}

main().catch((e) => log(`止まりました：${e instanceof Error ? e.message : e}`));
