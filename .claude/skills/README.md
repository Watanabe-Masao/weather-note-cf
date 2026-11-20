# GSAP 公式スキル（greensock/gsap-skills）

GSAP の開発元 GreenSock が出している、AI 向けの GSAP の書き方（MIT、`GSAP-SKILLS-LICENSE`）。
2026-11-20 渡辺さんの OK で、どのスレッドでも同じ書き方になるようにリポジトリに入れた。
元：https://github.com/greensock/gsap-skills の `skills/`（コミット aed9cfd、2026-04-21）。中身は書き換えない。

このリポジトリでの決まり（スキルより優先）：
- GSAP は `package.json` の版に固定（3.14.2）。版を上げる・プラグインを足すのは渡辺さんの OK のあと。
- React では `@gsap/react`（useGSAP）は入れていない。`useEffect` の中で `gsap.matchMedia()`（または `gsap.context()`）を作り、
  片づけで `revert()` する（gsap-react スキルの「手で片づける」書き方）。
- GSAP は使うページを開いたときだけ読み込む（動的 import）。例：`src/ui/MoonStory.tsx`。
- 動きを減らす設定（prefers-reduced-motion）では動かさない。
