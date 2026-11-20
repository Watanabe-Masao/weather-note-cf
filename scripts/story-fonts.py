# 満月の物語の書体を、物語で使う字だけに絞って配る形（woff2）にする（11/20 渡辺さん「システムフォントは雰囲気台無し」）。
# 手で走らせ、出来た物はリポジトリに置く（public/event/story/fonts/、版つきの URL で一度読んだら取っておかれる）。
#
#   pip install fonttools brotli        （作るときだけ。アプリには入らない）
#   python3 scripts/story-fonts.py <書体の ttf を置いたフォルダ>
#
# 書体（どちらも SIL Open Font License 1.1、google/fonts の ofl/ から）：
#   - 和文：Shippori Mincho（しっぽり明朝）Medium・SemiBold  ofl/shipporimincho/ShipporiMincho-{Medium,SemiBold}.ttf
#   - 和文の見出し：Zen Old Mincho Bold（表紙の名前・本の背の名前。11/20 20:09 渡辺さん「重厚感」）ofl/zenoldmincho/ZenOldMincho-Bold.ttf
#   - 欧文：Cormorant Garamond（可変、斜体も）           ofl/cormorantgaramond/CormorantGaramond[wght].ttf ほか
# 和文は物語の文・呼び名・説明・画面の文言に出てくる字（shared/fullMoonNames.ts・shared/windowMoon.ts と src/ui/MoonStory.tsx・
# src/design/story/ の文字）と、かな・数字・記号だけに絞る。文を足したら走らせ直す（字が無いと別の書体で出る）。
import pathlib, re, sys
from fontTools import subset

SRC = pathlib.Path(sys.argv[1])
OUT = pathlib.Path("public/event/story/fonts")
OUT.mkdir(parents=True, exist_ok=True)

texts = []
for p in ["shared/fullMoonNames.ts", "shared/windowMoon.ts", "src/ui/MoonStory.tsx", *map(str, pathlib.Path("src/design/story").glob("*.ts*"))]:
    texts.append(pathlib.Path(p).read_text(encoding="utf-8"))
used = set("".join(texts))
kana = {chr(c) for c in range(0x3040, 0x30FF + 1)}
ascii_ = {chr(c) for c in range(0x20, 0x7F)}
punct = set("、。・「」『』（）〜ー―…！？：；％　／＋－×＝℃°々〆〇月日年時分秒")
ja = sorted(c for c in used | kana | ascii_ | punct if c.isprintable() and not re.match(r"[\uD800-\uDFFF]", c))

def make(src: str, out: str, chars):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    f = subset.load_font(str(SRC / src), opts)
    s = subset.Subsetter(opts)
    s.populate(text="".join(chars))
    s.subset(f)
    subset.save_font(f, str(OUT / out), opts)
    print(out, (OUT / out).stat().st_size // 1024, "KB", len(chars), "字")

# 入れた字の一覧（テストで、物語の文の字がすべて入っているかを確かめる。test/data/story-book.test.ts）。
(OUT / "chars.txt").write_text("".join(ja), encoding="utf-8")
make("ShipporiMincho-Medium.ttf", "shippori-mincho-500.woff2", ja)
make("ShipporiMincho-SemiBold.ttf", "shippori-mincho-600.woff2", ja)
make("ZenOldMincho-Bold.ttf", "zen-old-mincho-700.woff2", ja)
latin = sorted(ascii_ | set("—–‘’“”…·"))
make("CormorantGaramond[wght].ttf", "cormorant-garamond.woff2", latin)
make("CormorantGaramond-Italic[wght].ttf", "cormorant-garamond-italic.woff2", latin)
