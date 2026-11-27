// β2 の OpenGL 参照（#537）：Bruneton の大気モデル（precomputed_atmospheric_scattering、BSD-3）を、画面なし（EGL）で動かし、
// 高知の固定事例の視線ごとに「観測者に届く光（輝度、cd/m²、線形 sRGB）」と「その方向の大気の透過率」を書き出す。
// 大気の条件はデモ（atmosphere/demo/demo.cc）の既定に合わせる：標準的な空気分子（Rayleigh）・エアロゾル（Mie、Ångström β 5.328e-3、
// α 0、高さの尺度 1.2 km、単散乱アルベド 0.9、g 0.8）・オゾン（300 DU）・地面のアルベド 0.1・太陽スペクトル（実測）。
// 2 通りで動かす：luminance（15 波長で事前計算し CIE の等色関数で積分した輝度、cd/m²、線形 sRGB。色の比較に使う）と、
// radiance（680・550・440 nm の放射輝度、W/m²/sr/nm。透過率はこちらの 3 波長で読む：luminance の表の透過率は最後の 3 波長の分で、色の意味を持たない）。
// 散乱の表は Mie を分けて持つ（まとめると luminance で Mie の色が崩れる）。表は半精度（ブラウザの WebGL 2 版と同じ）。
// 入力：cases.txt（tools/cases_txt.py が cases.json から作る）。出力：out/ に視線ごとの値（.bin）、帯（パノラマ）、事前計算の表（.dat）。
//
// 座標：x＝東、y＝北、z＝上。方位は北から東回り。長さの単位は km（kLengthUnitInMeters = 1000）。観測者は地表から observerHeightM。

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <glad/glad.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "atmosphere/constants.h"
#include "atmosphere/model.h"

using atmosphere::DensityProfileLayer;
using atmosphere::Model;

namespace {

constexpr double kPi = 3.1415926;
constexpr double kSunAngularRadius = 0.00935 / 2.0;
constexpr double kLengthUnitInMeters = 1000.0;
constexpr double kBottomRadius = 6360000.0;
constexpr double kTopRadius = 6420000.0;

void Die(const std::string& m) {
  std::cerr << "kochi_ref: " << m << std::endl;
  std::exit(1);
}

void InitEgl() {
  auto getPlatformDisplay = (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
  EGLDisplay dpy = getPlatformDisplay ? getPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, nullptr) : eglGetDisplay(EGL_DEFAULT_DISPLAY);
  EGLint major, minor;
  if (!eglInitialize(dpy, &major, &minor)) Die("eglInitialize");
  if (!eglBindAPI(EGL_OPENGL_API)) Die("eglBindAPI");
  const EGLint cfgAttr[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE};
  EGLConfig cfg;
  EGLint n = 0;
  eglChooseConfig(dpy, cfgAttr, &cfg, 1, &n);
  const EGLint ctxAttr[] = {EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 3, EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE};
  EGLContext ctx = eglCreateContext(dpy, n ? cfg : EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, ctxAttr);
  if (ctx == EGL_NO_CONTEXT) Die("eglCreateContext");
  if (!eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx)) Die("eglMakeCurrent");
  if (!gladLoadGLLoader((GLADloadproc)eglGetProcAddress)) Die("glad");
  std::cerr << "GL: " << glGetString(GL_VERSION) << " / " << glGetString(GL_RENDERER) << std::endl;
}

// demo.cc の InitModel と同じ条件（輝度は 15 波長で事前計算、表は半精度、散乱の表はまとめる）。
// 太陽スペクトル（白の基準：radiance を表示するときの white point に使う。demo の do_white_balance と同じ）
std::vector<double> gWavelengths, gSolar;

// 線形補間（wl は昇順）
double Lerp(const std::vector<double>& wl, const std::vector<double>& v, double x) {
  if (x <= wl.front()) return v.front();
  for (size_t i = 1; i < wl.size(); ++i)
    if (x <= wl[i]) return v[i - 1] + (v[i] - v[i - 1]) * (x - wl[i - 1]) / (wl[i] - wl[i - 1]);
  return v.back();
}

// bands（spectral の回）：3 つの波長（nm、R・G・B の枠の順）。radiance の計算は 680・550・440 nm の枠で値を読むので、
// その枠に「本当の波長の値」を入れた 3 点の表を渡し、好きな 3 波長の放射輝度を正しく（足し合わせなしで）計算する。
// 5 回（15 波長）を CPU で CIE の等色関数に積分すれば、多波長の色になる（tools/spectral.py）。
// エアロゾル（#537 の感度の比較、11/27）：Mie の消散を τ(λ) = β·λ^−α（λ は µm）、高さ方向は尺度高 H の指数。
// 既定は Bruneton のデモ（β 5.328e-3・α 0・H 1.2 km。550 nm の光学的厚さは約 0.005 で、ほぼエアロゾルなし）。
double gMieAlpha = 0.0, gMieScaleHeight = 1200.0;

std::unique_ptr<Model> MakeModel(double mieBeta, bool luminance, const std::vector<double>* bands = nullptr) {
  constexpr int kLambdaMin = 360, kLambdaMax = 830;
  constexpr double kSolarIrradiance[48] = {1.11776, 1.14259, 1.01249, 1.14716, 1.72765, 1.73054, 1.6887, 1.61253, 1.91198, 2.03474, 2.02042, 2.02212,
                                           1.93377, 1.95809, 1.91686, 1.8298,  1.8685,  1.8931,  1.85149, 1.8504, 1.8341,  1.8345,  1.8147,  1.78158,
                                           1.7533,  1.6965,  1.68194, 1.64654, 1.6048,  1.52143, 1.55622, 1.5113, 1.474,   1.4482,  1.41018, 1.36775,
                                           1.34188, 1.31429, 1.28303, 1.26758, 1.2367,  1.2082,  1.18737, 1.14683, 1.12362, 1.1058,  1.07124, 1.04992};
  constexpr double kOzoneCrossSection[48] = {1.18e-27,  2.182e-28, 2.818e-28, 6.636e-28, 1.527e-27, 2.763e-27, 5.52e-27,  8.451e-27, 1.582e-26, 2.316e-26,
                                             3.669e-26, 4.924e-26, 7.752e-26, 9.016e-26, 1.48e-25,  1.602e-25, 2.139e-25, 2.755e-25, 3.091e-25, 3.5e-25,
                                             4.266e-25, 4.672e-25, 4.398e-25, 4.701e-25, 5.019e-25, 4.305e-25, 3.74e-25,  3.215e-25, 2.662e-25, 2.238e-25,
                                             1.852e-25, 1.473e-25, 1.209e-25, 9.423e-26, 7.455e-26, 6.566e-26, 5.105e-26, 4.15e-26,  4.228e-26, 3.237e-26,
                                             2.451e-26, 2.801e-26, 2.534e-26, 1.624e-26, 1.465e-26, 2.078e-26, 1.383e-26, 7.105e-27};
  constexpr double kDobsonUnit = 2.687e20;
  constexpr double kMaxOzoneNumberDensity = 300.0 * kDobsonUnit / 15000.0;
  constexpr double kRayleigh = 1.24062e-6, kRayleighScaleHeight = 8000.0;
  const double kMieScaleHeight = gMieScaleHeight;
  const double kMieAngstromAlpha = gMieAlpha;
  constexpr double kMieSingleScatteringAlbedo = 0.9, kMiePhaseFunctionG = 0.8, kGroundAlbedo = 0.1;
  const double maxSunZenith = 102.0 / 180.0 * kPi;  // 半精度の表（demo と同じ）
  DensityProfileLayer rayleigh(0.0, 1.0, -1.0 / kRayleighScaleHeight, 0.0, 0.0);
  DensityProfileLayer mie(0.0, 1.0, -1.0 / kMieScaleHeight, 0.0, 0.0);
  std::vector<DensityProfileLayer> ozone = {DensityProfileLayer(25000.0, 0.0, 0.0, 1.0 / 15000.0, -2.0 / 3.0),
                                            DensityProfileLayer(0.0, 0.0, 0.0, -1.0 / 15000.0, 8.0 / 3.0)};
  std::vector<double> wl, sol, ray, mieS, mieE, abs, albedo;
  for (int l = kLambdaMin; l <= kLambdaMax; l += 10) {
    const double lambda = l * 1e-3;
    const double m = mieBeta / kMieScaleHeight * std::pow(lambda, -kMieAngstromAlpha);
    wl.push_back(l);
    sol.push_back(kSolarIrradiance[(l - kLambdaMin) / 10]);
    ray.push_back(kRayleigh * std::pow(lambda, -4));
    mieS.push_back(m * kMieSingleScatteringAlbedo);
    mieE.push_back(m);
    abs.push_back(kMaxOzoneNumberDensity * kOzoneCrossSection[(l - kLambdaMin) / 10]);
    albedo.push_back(kGroundAlbedo);
  }
  gWavelengths = wl;
  gSolar = sol;
  if (bands) {
    std::vector<double> w3 = {440.0, 550.0, 680.0}, s3, r3, ms3, me3, a3, al3;
    for (int k = 2; k >= 0; --k) {  // 440 の枠＝B（bands[2]）、550＝G、680＝R（bands[0]）
      const double x = (*bands)[k];
      s3.push_back(Lerp(wl, sol, x));
      r3.push_back(kRayleigh * std::pow(x * 1e-3, -4));
      ms3.push_back(Lerp(wl, mieS, x));
      me3.push_back(Lerp(wl, mieE, x));
      a3.push_back(Lerp(wl, abs, x));
      al3.push_back(kGroundAlbedo);
    }
    std::unique_ptr<Model> m(new Model(w3, s3, kSunAngularRadius, kBottomRadius, kTopRadius, {rayleigh}, r3, {mie}, ms3, me3, kMiePhaseFunctionG, ozone, a3, al3,
                                       maxSunZenith, kLengthUnitInMeters, 3, false, !std::getenv("KOCHI_FULL_PRECISION")));
    m->Init();
    return m;
  }
  // Init() はここで呼ぶ（11/27）：Model は波長の配列を参照で持ち、Init() の中でシェーダーを作るときに読む。この関数の外で
  // Init() を呼ぶと、配列がもう無く（呼び出し元の一時の配列）、でたらめな値で事前計算していた（3 色が同じ値・15 波長で色が崩れる）。
  // demo.cc も InitModel の中で Init() を呼んでいる。
  std::unique_ptr<Model> m(new Model(wl, sol, kSunAngularRadius, kBottomRadius, kTopRadius, {rayleigh}, ray, {mie}, mieS, mieE, kMiePhaseFunctionG, ozone, abs, albedo,
                                     maxSunZenith, kLengthUnitInMeters, luminance ? 15 : 3, false, !std::getenv("KOCHI_FULL_PRECISION")));
  m->Init();
  return m;
}

const char* kVertex = R"(#version 330
layout(location = 0) in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); })";

const char* kFragmentHead = "#version 330\n";
const char* kFragmentBody = R"(
uniform vec3 camera;
uniform vec3 sun_direction;
uniform sampler2D views;
layout(location = 0) out vec4 luminance;
layout(location = 1) out vec4 transmittance_out;
#ifdef USE_LUMINANCE
vec3 GetSkyLuminance(vec3 camera, vec3 view_ray, float shadow_length, vec3 sun_direction, out vec3 transmittance);
#define GetSky GetSkyLuminance
#else
vec3 GetSkyRadiance(vec3 camera, vec3 view_ray, float shadow_length, vec3 sun_direction, out vec3 transmittance);
#define GetSky GetSkyRadiance
#endif
void main() {
  vec3 v = normalize(texelFetch(views, ivec2(gl_FragCoord.xy), 0).xyz);
  vec3 t;
  vec3 l = GetSky(camera, v, 0.0, sun_direction, t);
  luminance = vec4(l, 1.0);
  transmittance_out = vec4(t, 1.0);
})";

GLuint Compile(GLenum type, const char* src) {
  GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[4096];
    glGetShaderInfoLog(s, sizeof log, nullptr, log);
    Die(std::string("shader: ") + log);
  }
  return s;
}

std::vector<float> Dir(double azDeg, double altDeg) {
  const double az = azDeg * kPi / 180.0, alt = altDeg * kPi / 180.0;
  return {float(std::sin(az) * std::cos(alt)), float(std::cos(az) * std::cos(alt)), float(std::sin(alt))};
}

// views（w×h、方向）を描いて、輝度と透過率を読み戻す。
void Evaluate(GLuint program, const std::vector<float>& dirs, int w, int h, std::vector<float>* lum, std::vector<float>* trans) {
  GLuint tex[3], fbo;
  glGenTextures(3, tex);
  glActiveTexture(GL_TEXTURE5);
  glBindTexture(GL_TEXTURE_2D, tex[0]);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB32F, w, h, 0, GL_RGB, GL_FLOAT, dirs.data());
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glUniform1i(glGetUniformLocation(program, "views"), 5);
  glGenFramebuffers(1, &fbo);
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  for (int i = 1; i <= 2; ++i) {
    glActiveTexture(GL_TEXTURE6);
    glBindTexture(GL_TEXTURE_2D, tex[i]);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, w, h, 0, GL_RGBA, GL_FLOAT, nullptr);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0 + i - 1, GL_TEXTURE_2D, tex[i], 0);
  }
  const GLenum bufs[2] = {GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1};
  glDrawBuffers(2, bufs);
  if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) Die("fbo");
  glViewport(0, 0, w, h);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  std::vector<float> rgba(size_t(w) * h * 4);
  for (int i = 0; i < 2; ++i) {
    glReadBuffer(GL_COLOR_ATTACHMENT0 + i);
    glReadPixels(0, 0, w, h, GL_RGBA, GL_FLOAT, rgba.data());
    auto* out = i == 0 ? lum : trans;
    out->resize(size_t(w) * h * 3);
    for (size_t k = 0; k < size_t(w) * h; ++k)
      for (int c = 0; c < 3; ++c) (*out)[k * 3 + c] = rgba[k * 4 + c];
  }
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glDeleteFramebuffers(1, &fbo);
  glDeleteTextures(3, tex);
}

void WriteFloats(const std::string& path, const std::vector<float>& v) {
  std::ofstream o(path, std::ios::binary);
  o.write(reinterpret_cast<const char*>(v.data()), v.size() * sizeof(float));
}

void SaveTexture(GLenum unit, GLenum target, int texels, const std::string& path) {
  std::vector<float> px(size_t(texels) * 4);
  glActiveTexture(unit);
  glGetTexImage(target, 0, GL_RGBA, GL_FLOAT, px.data());
  WriteFloats(path, px);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 4) Die("usage: kochi_ref cases.txt outdir luminance|radiance|spectral:a,b,c [aod550 [angstrom_alpha [mie_scale_height_km]]]");
  const std::string out = std::string(argv[2]) + "/";
  const std::string mode = argv[3];
  const bool luminance = mode == "luminance";
  std::vector<double> bands;
  if (mode.rfind("spectral:", 0) == 0) {
    std::stringstream bs(mode.substr(9));
    std::string t;
    while (std::getline(bs, t, ',')) bands.push_back(std::atof(t.c_str()));
    if (bands.size() != 3) Die("spectral:<nm>,<nm>,<nm>");
  }
  // 550 nm の光学的厚さ（AOD）を与えたときは β = AOD·0.55^α（τ(0.55 µm) = AOD）
  if (argc > 5) gMieAlpha = std::atof(argv[5]);
  if (argc > 6) gMieScaleHeight = std::atof(argv[6]) * 1000.0;
  const double mieBeta = argc > 4 ? std::atof(argv[4]) * std::pow(0.55, gMieAlpha) : 5.328e-3;
  // Mesa のシェーダーのキャッシュは使わない（念のため。値が崩れた本当の原因は MakeModel の Init() の位置だった）。
  setenv("MESA_SHADER_CACHE_DISABLE", "true", 1);
  InitEgl();
  const auto t0 = std::chrono::steady_clock::now();
  auto model = MakeModel(mieBeta, luminance, bands.empty() ? nullptr : &bands);
  glFinish();
  const double precomputeMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  std::cerr << "precompute " << precomputeMs << " ms" << std::endl;

  const std::string frag = std::string(kFragmentHead) + (luminance ? "#define USE_LUMINANCE\n" : "") + kFragmentBody;
  GLuint vs = Compile(GL_VERTEX_SHADER, kVertex), fs = Compile(GL_FRAGMENT_SHADER, frag.c_str());
  GLuint program = glCreateProgram();
  glAttachShader(program, vs);
  glAttachShader(program, fs);
  glAttachShader(program, model->shader());
  glLinkProgram(program);
  GLint ok;
  glGetProgramiv(program, GL_LINK_STATUS, &ok);
  if (!ok) Die("link");
  glUseProgram(program);
  model->SetProgramUniforms(program, 0, 1, 2, 3);

  GLuint vao, vbo;
  const float tri[] = {-1, -1, 3, -1, -1, 3};
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glGenBuffers(1, &vbo);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glBufferData(GL_ARRAY_BUFFER, sizeof tri, tri, GL_STATIC_DRAW);
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);

  std::ifstream in(argv[1]);
  std::string line, caseId;
  double heightM = 10, sunAlt = 0, sunAz = 0;
  double pano[6] = {0, 360, 0.5, -2, 60, 0.5};
  std::vector<std::string> ids;
  std::vector<float> dirs;
  std::ofstream meta(out + "meta.txt");
  {
    double r, g, b;
    Model::ConvertSpectrumToLinearSrgb(gWavelengths, gSolar, &r, &g, &b);
    const double m = (r + g + b) / 3.0;
    meta << "white_point " << r / m << " " << g / m << " " << b / m << "\n";
  }
  meta << "mode " << mode << "\nprecompute_ms " << precomputeMs << "\nmie_beta " << mieBeta << "\nmie_alpha " << gMieAlpha << "\nmie_scale_height_m " << gMieScaleHeight << "\naod550 " << mieBeta * std::pow(0.55, -gMieAlpha) << "\nrenderer " << glGetString(GL_RENDERER) << "\n";
  auto flush = [&]() {
    if (caseId.empty()) return;
    const float cam[3] = {0, 0, float((kBottomRadius + heightM) / kLengthUnitInMeters)};
    glUniform3fv(glGetUniformLocation(program, "camera"), 1, cam);
    auto s = Dir(sunAz, sunAlt);
    glUniform3fv(glGetUniformLocation(program, "sun_direction"), 1, s.data());
    std::vector<float> lum, trans;
    Evaluate(program, dirs, int(ids.size()), 1, &lum, &trans);
    std::ofstream o(out + caseId + ".views.txt");
    for (size_t i = 0; i < ids.size(); ++i)
      o << ids[i] << " " << lum[i * 3] << " " << lum[i * 3 + 1] << " " << lum[i * 3 + 2] << " " << trans[i * 3] << " " << trans[i * 3 + 1] << " " << trans[i * 3 + 2]
        << "\n";
    // 帯（パノラマ）
    const int w = int(std::round((pano[1] - pano[0]) / pano[2])), h = int(std::round((pano[4] - pano[3]) / pano[5])) + 1;
    std::vector<float> pd;
    for (int j = 0; j < h; ++j)
      for (int i = 0; i < w; ++i) {
        auto d = Dir(pano[0] + i * pano[2], pano[3] + j * pano[5]);
        pd.insert(pd.end(), d.begin(), d.end());
      }
    const auto t1 = std::chrono::steady_clock::now();
    Evaluate(program, pd, w, h, &lum, &trans);
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t1).count();
    WriteFloats(out + caseId + ".pano.lum.f32", lum);
    WriteFloats(out + caseId + ".pano.trans.f32", trans);
    meta << "case " << caseId << " pano " << w << "x" << h << " eval_ms " << ms << "\n";
    ids.clear();
    dirs.clear();
  };
  while (std::getline(in, line)) {
    std::istringstream ss(line);
    std::string k;
    ss >> k;
    if (k == "height") ss >> heightM;
    else if (k == "pano") for (double& p : pano) ss >> p;
    else if (k == "case") {
      flush();
      ss >> caseId >> sunAlt >> sunAz;
    } else if (k == "view") {
      std::string id;
      double az, alt;
      ss >> id >> az >> alt;
      ids.push_back(id);
      auto d = Dir(az, alt);
      dirs.insert(dirs.end(), d.begin(), d.end());
    }
  }
  flush();
  // ブラウザの WebGL 2 版が読む事前計算の表（atmosphere/demo/webgl/precompute.cc と同じ形）とシェーダー
  SaveTexture(GL_TEXTURE0, GL_TEXTURE_2D, atmosphere::TRANSMITTANCE_TEXTURE_WIDTH * atmosphere::TRANSMITTANCE_TEXTURE_HEIGHT, out + "transmittance.dat");
  SaveTexture(GL_TEXTURE1, GL_TEXTURE_3D, atmosphere::SCATTERING_TEXTURE_WIDTH * atmosphere::SCATTERING_TEXTURE_HEIGHT * atmosphere::SCATTERING_TEXTURE_DEPTH,
              out + "scattering.dat");
  SaveTexture(GL_TEXTURE2, GL_TEXTURE_2D, atmosphere::IRRADIANCE_TEXTURE_WIDTH * atmosphere::IRRADIANCE_TEXTURE_HEIGHT, out + "irradiance.dat");
  SaveTexture(GL_TEXTURE3, GL_TEXTURE_3D, atmosphere::SCATTERING_TEXTURE_WIDTH * atmosphere::SCATTERING_TEXTURE_HEIGHT * atmosphere::SCATTERING_TEXTURE_DEPTH,
              out + "single_mie_scattering.dat");
  {
    GLint len;
    glGetShaderiv(model->shader(), GL_SHADER_SOURCE_LENGTH, &len);
    std::string src(size_t(len), '\0');
    glGetShaderSource(model->shader(), len, nullptr, &src[0]);
    std::ofstream(out + "atmosphere_shader.glsl") << src.c_str();
  }
  return 0;
}
