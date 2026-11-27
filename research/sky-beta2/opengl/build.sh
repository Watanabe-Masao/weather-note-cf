#!/bin/sh
# β2 の OpenGL 参照を作る（#537）。Bruneton の実装（BSD-3）を決めたコミットで取り、kochi_ref と一緒にビルドする。
# 要るもの：g++、libegl-dev・libgl-dev（Mesa の llvmpipe で画面なしに動く）。
# 使い方：sh research/sky-beta2/opengl/build.sh [作業フォルダ]  → 作業フォルダ/kochi_ref
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${1:-$HERE/.work}
REV=34f14e745cff948f4ca3157d1b62a445ffa7286f
mkdir -p "$WORK"
if [ ! -d "$WORK/bruneton" ]; then
  git clone -q https://github.com/ebruneton/precomputed_atmospheric_scattering "$WORK/bruneton"
fi
git -C "$WORK/bruneton" checkout -q "$REV"
B="$WORK/bruneton"
# Makefile と同じ：GLSL をC++ の文字列に（コメントと空行を除く）
for f in definitions functions; do
  sed -e "1i const char ${f}_glsl[] = R\"***(" -e '$a )***";' \
      -e '/^\/\*/,/\*\/$/d' -e '/^ *\/\//d' -e '/^$/d' "$B/atmosphere/$f.glsl" > "$B/atmosphere/$f.glsl.inc"
done
g++ -O2 -std=c++14 -I"$B" -I"$B/external/glad/include" -I"$B/external" \
  "$HERE/kochi_ref.cc" "$B/atmosphere/model.cc" "$B/external/glad/src/glad.cc" \
  -lEGL -lGL -ldl -o "$WORK/kochi_ref"
echo "$WORK/kochi_ref"
