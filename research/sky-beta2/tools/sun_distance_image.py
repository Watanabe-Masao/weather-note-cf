"""地球と太陽の距離の比較を画像にする（#537、11/27）。
python3 research/sky-beta2/tools/sun_distance_image.py <近日点 json> <平均 json> <遠日点 json> <出力 png>
json は tools/check_web.py の ?sun=…&dump=1 の出力（Hillaire 15 波長の帯）。3 枚は同じ露出（平均の距離の場面ごとの E）で表示し、
下に、近日点と遠日点の表示の色の差を 20 倍した図を置く（灰色が明るいほど差が大きい）。"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

paths = sys.argv[1:4]
out = sys.argv[4]
runs = [json.load(open(p)) for p in paths]
labels = ["1月3日ごろ（近日点・太陽の光 +3.4%）", "平均の距離（今の計算）", "7月6日ごろ（遠日点・太陽の光 −3.3%）"]
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
f_title, f_lab = ImageFont.truetype(FONT, 22), ImageFont.truetype(FONT, 16)


def srgb(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 0), 1 / 2.4) - 0.055)


def show(pano, w, h, e):
    a = np.array(pano, dtype=np.float64).reshape(h, w, 3)[::-1]
    return np.clip(np.round(255 * srgb(1 - np.exp(-np.maximum(a, 0) * e))), 0, 255).astype(np.uint8)


ids = [r["id"] for r in runs[1]["results"]]
titles = {"sun+5": "太陽 +5°（16:34）", "sunset-1.9": "太陽 −1.9°（17:10）", "dusk-6.8": "太陽 −6.8°（17:35）"}
W, H = runs[1]["results"][0]["panoSize"]
pad, gap = 16, 6
row_h = H + 22
block = 34 + 4 * (row_h + gap) + 10
img = Image.new("RGB", (W + 2 * pad, pad + len(ids) * block + 60), (24, 27, 34))
dr = ImageDraw.Draw(img)
y = pad
lines = []
for cid in ids:
    res = [next(r for r in run["results"] if r["id"] == cid) for run in runs]
    e = res[1]["eScene"]
    pics = [show(r["hillaireSpectralPano"], W, H, e) for r in res]
    diff = np.abs(pics[0].astype(int) - pics[2].astype(int))
    mx = int(diff.max())
    dr.text((pad, y), f"{titles.get(cid, cid)}　同じ露出で 3 枚", font=f_title, fill=(235, 238, 245))
    y += 34
    for lab, pic in zip(labels, pics):
        img.paste(Image.fromarray(pic), (pad, y))
        dr.text((pad, y + H + 2), lab, font=f_lab, fill=(170, 178, 192))
        y += row_h + gap
    d = np.clip(diff.max(axis=2) * 20, 0, 255).astype(np.uint8)
    img.paste(Image.fromarray(np.stack([d] * 3, axis=2)), (pad, y))
    dr.text((pad, y + H + 2), f"近日点と遠日点の差を 20 倍（最大 {mx} 段 / 255）", font=f_lab, fill=(170, 178, 192))
    y += row_h + gap + 10
    lines.append(f"{cid}: 最大 {mx} 段")
dr.text((pad, y), "Hillaire 15 波長・表 128×128。左が北、方位 0〜360°、高さ −2〜60°。", font=f_lab, fill=(150, 158, 172))
dr.text((pad, y + 20), "露出は、平均の距離の場面ごとの値で 3 枚共通（明るさを合わせ直すと差は 0 段）。", font=f_lab, fill=(150, 158, 172))
img.save(out)
print("\n".join(lines))
