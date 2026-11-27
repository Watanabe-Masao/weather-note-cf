// β2 の候補：Hillaire（2020）"A Scalable and Production Ready Sky and Atmosphere Rendering Technique" の方式を WebGL 2 で（#537）。
// 透過率の表（256×64）と多重散乱の表（32×32）を、このブラウザで最初に一度だけ作り、視線ごとの光は視線に沿った積分（レイマーチ）で求める。
// 太陽が地平線の下でも、標本の点ごとに太陽が地球に隠れるかを見るので、薄明（−6.8° など）も同じ式で扱える。
// 比べやすさのため、大気の条件は Bruneton の参照（opengl/kochi_ref、radiance）とそろえる：680・550・440 nm の Rayleigh・Mie・オゾン・太陽の放射照度・
// 地面のアルベド 0.1・地球の半径 6360 km・大気の上端 6420 km。出力は 3 波長の放射輝度（W/m²/sr/nm）と、視線方向の透過率。
// 位相関数は Bruneton と同じ（Rayleigh、Cornette–Shanks の Mie、g 0.8）。多重散乱は Hillaire の近似（等方の 2 次散乱 ×1/(1 − f_ms)）。

export const HILLAIRE_PARAMS = {
  bottomRadius: 6360, // km
  topRadius: 6420,
  // 680・550・440 nm（R・G・B の枠）
  rayleighScattering: [0.0058023, 0.0135578, 0.0331], // /km
  mieScattering: [0.003996, 0.003996, 0.003996], // /km（5.328e-3/1.2 km × 0.9）
  mieExtinction: [0.00444, 0.00444, 0.00444],
  ozoneAbsorption: [0.00064972, 0.0018809, 0.000085017],
  rayleighScaleHeight: 8, // km
  mieScaleHeight: 1.2,
  miePhaseG: 0.8,
  solarIrradiance: [1.474, 1.8504, 1.91198], // W/m²/nm
  groundAlbedo: 0.1,
};

const COMMON = `
const float PI = 3.14159265358979;
uniform float bottomRadius;
uniform float topRadius;
uniform vec3 rayleighScattering;
uniform vec3 mieScattering;
uniform vec3 mieExtinction;
uniform vec3 ozoneAbsorption;
uniform float rayleighH;
uniform float mieH;
uniform float mieG;
uniform float groundAlbedo;

struct Medium { vec3 scattering; vec3 extinction; vec3 rayleigh; vec3 mie; };
Medium medium(float r) {
  float h = max(0.0, r - bottomRadius);
  float dr = exp(-h / rayleighH);
  float dm = exp(-h / mieH);
  // オゾン：Bruneton と同じ山形（25 km で最大、幅 30 km）
  float dz = clamp(h < 25.0 ? h / 15.0 - 2.0 / 3.0 : -h / 15.0 + 8.0 / 3.0, 0.0, 1.0);
  Medium m;
  m.rayleigh = rayleighScattering * dr;
  m.mie = mieScattering * dm;
  m.scattering = m.rayleigh + m.mie;
  m.extinction = m.rayleigh + mieExtinction * dm + ozoneAbsorption * dz;
  return m;
}
// 原点（地球の中心）からの球との交点の距離（無ければ −1）
float raySphere(vec3 o, vec3 d, float R) {
  float b = dot(o, d);
  float c = dot(o, o) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc);
  float t0 = -b - s;
  float t1 = -b + s;
  if (t0 >= 0.0) return t0;
  if (t1 >= 0.0) return t1;
  return -1.0;
}
float rayleighPhase(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
float miePhase(float c) {
  float g = mieG;
  float k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + c * c) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
}
// 透過率の表の座標（Bruneton・Hillaire と同じ割り付け）
vec2 transmittanceUv(float r, float mu) {
  float H = sqrt(topRadius * topRadius - bottomRadius * bottomRadius);
  float rho = sqrt(max(0.0, r * r - bottomRadius * bottomRadius));
  float disc = r * r * (mu * mu - 1.0) + topRadius * topRadius;
  float d = max(0.0, -r * mu + sqrt(max(0.0, disc)));
  float dMin = topRadius - r;
  float dMax = rho + H;
  return vec2((d - dMin) / (dMax - dMin), rho / H);
}
void uvToRMu(vec2 uv, out float r, out float mu) {
  float H = sqrt(topRadius * topRadius - bottomRadius * bottomRadius);
  float rho = H * uv.y;
  r = sqrt(rho * rho + bottomRadius * bottomRadius);
  float dMin = topRadius - r;
  float dMax = rho + H;
  float d = dMin + uv.x * (dMax - dMin);
  mu = d == 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
}
`;

const VERT = "#version 300 es\nlayout(location = 0) in vec2 p;\nvoid main() { gl_Position = vec4(p, 0.0, 1.0); }";
const HEAD = "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n";

// 1) 透過率の表：(r, mu) から大気の上端までの透過率
const TRANSMITTANCE_FS = `${HEAD}${COMMON}
uniform vec2 size;
out vec4 color;
void main() {
  float r, mu;
  uvToRMu((gl_FragCoord.xy - 0.5) / (size - 1.0), r, mu);
  vec3 o = vec3(0.0, 0.0, r);
  vec3 d = vec3(sqrt(1.0 - mu * mu), 0.0, mu);
  float tMax = raySphere(o, d, topRadius);
  const int N = 64;
  vec3 depth = vec3(0.0);
  float dt = tMax / float(N);
  for (int i = 0; i < N; i++) {
    vec3 p = o + d * (float(i) + 0.5) * dt;
    depth += medium(length(p)).extinction * dt;
  }
  color = vec4(exp(-depth), 1.0);
}`;

const SAMPLE_T = `
uniform sampler2D transmittanceLut;
// 点（r）から太陽の方向（mu）の透過率。太陽が地球に隠れれば 0
vec3 sunTransmittance(float r, float mu) {
  float horizon = -sqrt(max(0.0, 1.0 - (bottomRadius * bottomRadius) / (r * r)));
  if (mu < horizon) return vec3(0.0);
  // 表の値は画素の中心（0〜1 の端が中心）にあるので、半画素ずらして引く
  vec2 uv = transmittanceUv(r, mu);
  return texture(transmittanceLut, 0.5 / vec2(256.0, 64.0) + uv * (1.0 - 1.0 / vec2(256.0, 64.0))).rgb;
}`;

// 2) 多重散乱の表：(太陽の天頂角の余弦, 高さ) ごとに、等方に散った 2 次の光 × 1/(1 − f_ms)（太陽の放射照度 1 あたり）
const MULTI_FS = `${HEAD}${COMMON}${SAMPLE_T}
uniform vec2 size;
out vec4 color;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / (size - 1.0);
  float muS = uv.x * 2.0 - 1.0;
  float r = bottomRadius + 0.0005 + uv.y * (topRadius - bottomRadius - 0.001);
  vec3 o = vec3(0.0, 0.0, r);
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - muS * muS)), 0.0, muS);
  const int SQRT = 8;
  const int STEPS = 20;
  vec3 L = vec3(0.0);
  vec3 fms = vec3(0.0);
  float iso = 1.0 / (4.0 * PI);
  for (int a = 0; a < SQRT; a++) {
    for (int b = 0; b < SQRT; b++) {
      float u = (float(a) + 0.5) / float(SQRT);
      float v = (float(b) + 0.5) / float(SQRT);
      float th = 2.0 * PI * u;
      float ph = acos(1.0 - 2.0 * v);
      vec3 d = vec3(sin(ph) * cos(th), sin(ph) * sin(th), cos(ph));
      float tG = raySphere(o, d, bottomRadius);
      float tT = raySphere(o, d, topRadius);
      float tMax = tG > 0.0 ? tG : tT;
      float dt = tMax / float(STEPS);
      vec3 T = vec3(1.0);
      vec3 Ls = vec3(0.0);
      vec3 Fs = vec3(0.0);
      for (int i = 0; i < STEPS; i++) {
        vec3 p = o + d * (float(i) + 0.5) * dt;
        float pr = length(p);
        Medium m = medium(pr);
        vec3 Ts = sunTransmittance(pr, dot(p / pr, sun));
        vec3 st = exp(-m.extinction * dt);
        vec3 S = Ts * m.scattering * iso;
        vec3 Sint = (S - S * st) / max(m.extinction, vec3(1e-9));
        Ls += T * Sint;
        vec3 Fint = (m.scattering - m.scattering * st) / max(m.extinction, vec3(1e-9));
        Fs += T * Fint;
        T *= st;
      }
      if (tG > 0.0) {
        vec3 pg = o + d * tG;
        vec3 n = normalize(pg);
        Ls += T * sunTransmittance(bottomRadius, dot(n, sun)) * groundAlbedo / PI * max(0.0, dot(n, sun));
      }
      L += Ls;
      fms += Fs * iso;
    }
  }
  float n = float(SQRT * SQRT);
  L /= n;
  fms = fms / n * 4.0 * PI;
  color = vec4(L / (1.0 - fms), 1.0);
}`;

// 3) 視線ごとの光：カメラから視線に沿って積分（単散乱は太陽の透過率と地球の影、多重散乱は表から）
const SKY_FS = `${HEAD}${COMMON}${SAMPLE_T}
uniform sampler2D multiLut;
uniform sampler2D views;
uniform vec3 camera;
uniform vec3 sunDir;
uniform vec3 solar;
uniform int steps;
layout(location = 0) out vec4 radiance;
layout(location = 1) out vec4 transmittanceOut;
vec3 multi(float r, float muS) {
  vec2 uv = vec2(muS * 0.5 + 0.5, (r - bottomRadius) / (topRadius - bottomRadius));
  return texture(multiLut, 0.5 / 32.0 + clamp(uv, 0.0, 1.0) * (1.0 - 1.0 / 32.0)).rgb;
}
void main() {
  vec3 d = normalize(texelFetch(views, ivec2(gl_FragCoord.xy), 0).xyz);
  float tG = raySphere(camera, d, bottomRadius);
  float tT = raySphere(camera, d, topRadius);
  float tMax = tG > 0.0 ? tG : tT;
  float cosT = dot(d, sunDir);
  float pr = rayleighPhase(cosT);
  float pm = miePhase(cosT);
  vec3 T = vec3(1.0);
  vec3 L = vec3(0.0);
  // 近い所を細かく（2 乗の刻み）
  float prevT = 0.0;
  for (int i = 1; i <= 256; i++) {
    if (i > steps) break;
    float f = float(i) / float(steps);
    float t = tMax * f * f;
    float dt = t - prevT;
    vec3 p = camera + d * (prevT + 0.5 * dt);
    prevT = t;
    float r = length(p);
    Medium m = medium(r);
    float muS = dot(p / r, sunDir);
    vec3 Ts = sunTransmittance(r, muS);
    vec3 S = solar * (Ts * (m.rayleigh * pr + m.mie * pm) + multi(r, muS) * m.scattering);
    vec3 st = exp(-m.extinction * dt);
    L += T * (S - S * st) / max(m.extinction, vec3(1e-9));
    T *= st;
  }
  radiance = vec4(L, 1.0);
  transmittanceOut = vec4(T, 1.0);
}`;

export class HillaireSky {
  gl: WebGL2RenderingContext;
  sky: WebGLProgram;
  lutMs: number;
  steps: number;
  private tLut: WebGLTexture;
  private mLut: WebGLTexture;
  constructor(gl: WebGL2RenderingContext, steps = 64) {
    this.gl = gl;
    this.steps = steps;
    if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) throw new Error("浮動小数の描き先が使えない");
    const t0 = performance.now();
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tp = this.program(TRANSMITTANCE_FS);
    this.tLut = this.renderLut(tp, 256, 64, () => undefined);
    const mp = this.program(MULTI_FS);
    this.mLut = this.renderLut(mp, 32, 32, () => this.bind(mp, "transmittanceLut", this.tLut, 0));
    this.sky = this.program(SKY_FS);
    const px = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); // 表ができるまで待つ
    this.lutMs = performance.now() - t0;
  }
  private program(fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    gl.useProgram(p);
    const P = HILLAIRE_PARAMS;
    const u = (n: string) => gl.getUniformLocation(p, n);
    gl.uniform1f(u("bottomRadius"), P.bottomRadius);
    gl.uniform1f(u("topRadius"), P.topRadius);
    gl.uniform3fv(u("rayleighScattering"), P.rayleighScattering);
    gl.uniform3fv(u("mieScattering"), P.mieScattering);
    gl.uniform3fv(u("mieExtinction"), P.mieExtinction);
    gl.uniform3fv(u("ozoneAbsorption"), P.ozoneAbsorption);
    gl.uniform1f(u("rayleighH"), P.rayleighScaleHeight);
    gl.uniform1f(u("mieH"), P.mieScaleHeight);
    gl.uniform1f(u("mieG"), P.miePhaseG);
    gl.uniform1f(u("groundAlbedo"), P.groundAlbedo);
    return p;
  }
  private bind(p: WebGLProgram, name: string, tex: WebGLTexture, unit: number) {
    const gl = this.gl;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(p, name), unit);
  }
  private target(w: number, h: number, filter: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private renderLut(p: WebGLProgram, w: number, h: number, before: () => void): WebGLTexture {
    const gl = this.gl;
    const t = this.target(w, h, gl.LINEAR);
    before();
    gl.useProgram(p);
    gl.uniform2f(gl.getUniformLocation(p, "size"), w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    return t;
  }
  /** 方向（w×h）ごとの放射輝度（680・550・440 nm）と透過率。読み戻しまでの時間（ms）も返す。 */
  evaluate(dirs: Float32Array, w: number, h: number, heightM: number, sun: [number, number, number]): { rad: Float32Array; trans: Float32Array; ms: number } {
    const gl = this.gl;
    const t0 = performance.now();
    const p = this.sky;
    gl.useProgram(p);
    this.bind(p, "transmittanceLut", this.tLut, 0);
    this.bind(p, "multiLut", this.mLut, 1);
    gl.uniform3f(gl.getUniformLocation(p, "camera"), 0, 0, HILLAIRE_PARAMS.bottomRadius + heightM / 1000);
    gl.uniform3f(gl.getUniformLocation(p, "sunDir"), ...sun);
    gl.uniform3fv(gl.getUniformLocation(p, "solar"), HILLAIRE_PARAMS.solarIrradiance);
    gl.uniform1i(gl.getUniformLocation(p, "steps"), this.steps);
    const vt = gl.createTexture();
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, vt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, w, h, 0, gl.RGB, gl.FLOAT, dirs);
    gl.uniform1i(gl.getUniformLocation(p, "views"), 5);
    const out = [0, 1].map(() => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      return t;
    });
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    out.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const read = (i: number) => {
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
      const rgba = new Float32Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, rgba);
      const o = new Float32Array(w * h * 3);
      for (let k = 0; k < w * h; k++) for (let c = 0; c < 3; c++) o[k * 3 + c] = rgba[k * 4 + c];
      return o;
    };
    const rad = read(0);
    const trans = read(1);
    const ms = performance.now() - t0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    out.forEach((t) => gl.deleteTexture(t));
    gl.deleteTexture(vt);
    return { rad, trans, ms };
  }
}
