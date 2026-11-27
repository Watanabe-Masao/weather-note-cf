"""同じ露出で帯（パノラマ）を縦に並べた画像（#537、11/27）。
python3 research/sky-beta2/tools/aer_images.py <cases.json> <事例 id> <出力 png> <見出し> <ラベル>=<luminance の出力フォルダ> ...
露出は全部の段で同じ：E = 2.3 / （段の中で最も明るいものの、地平線より上の G の 99 パーセンタイル）。輝度 L → 1 − exp(−E·L) → sRGB。"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

cases_path, cid, out, title = sys.argv[1:5]
panels = [a.split("=", 1) for a in sys.argv[5:]]
cases = json.load(open(cases_path))
c = next(x for x in cases["cases"] if x["id"] == cid)
az0, az1, azs = cases["panorama"]["az"]
alt0, alt1, alts = cases["panorama"]["alt"]
w = round((az1 - az0) / azs)
h = round((alt1 - alt0) / alts) + 1
above = int(round((0 - alt0) / alts))
imgs = [np.fromfile(os.path.join(d, cid + ".pano.lum.f32"), dtype="<f4").reshape(h, w, 3) for _, d in panels]
E = 2.3 / max(np.percentile(a[above:, :, 1], 99) for a in imgs)


def srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(v, 1 / 2.4) - 0.055)


font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 22)
small = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 18)
S = 2  # 縦横 2 倍
ph = h * S
gap = 64
W = w * S
H = 70 + len(panels) * (ph + gap)
canvas = Image.new("RGB", (W, H), (246, 247, 249))
d = ImageDraw.Draw(canvas)
d.text((12, 10), f"{title}（同じ露出 E = {E:.3g}）", fill=(27, 31, 39), font=font)
y = 70
for (label, _), a in zip(panels, imgs):
    rgb = (srgb(1 - np.exp(-np.maximum(a, 0) * E)) * 255).astype(np.uint8)[::-1]  # 上が高い所
    im = Image.fromarray(rgb).resize((W, ph), Image.BILINEAR)
    canvas.paste(im, (0, y))
    sx = int((c["sunAz"] - az0) / (az1 - az0) * W)
    d.line([(sx, y + ph - 14), (sx, y + ph)], fill=(255, 255, 255), width=2)
    for k, t in enumerate(["北", "東", "南", "西", "北"]):
        x = int(k * W / 4)
        d.text((min(max(x - 9, 0), W - 22), y + ph + 2), t, fill=(91, 99, 114), font=small)
    d.text((12, y + ph + 22), label, fill=(27, 31, 39), font=small)
    y += ph + gap
canvas.save(out)
print(out, "E", E)
