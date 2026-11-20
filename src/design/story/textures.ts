// 満月の物語の本と本棚の質感（11/20 18:19 渡辺さん「もっとディテールと質感を意識して」）：革のしぼと、木目。
// 画像ファイルを持たず、SVG のノイズ（feTurbulence）を CSS の背景として使う（一度描かれたら使い回される）。
// 色は持たない（白黒の明暗だけ）。重ね方（soft-light など）は CSS の側。
const svg = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;

/** 革のしぼ：細かい凹凸を左上からの光で浮かせる。 */
export const LEATHER = svg(
  `<filter id='l' x='0' y='0'><feTurbulence type='fractalNoise' baseFrequency='0.55' numOctaves='3' stitchTiles='stitch'/><feDiffuseLighting lighting-color='white' surfaceScale='1.6' diffuseConstant='1'><feDistantLight azimuth='225' elevation='58'/></feDiffuseLighting></filter><rect width='100%' height='100%' filter='url(#l)'/>`,
  180,
  180,
);

/** 木目：横に長く伸びた筋。 */
export const WOOD = svg(
  `<filter id='w' x='0' y='0'><feTurbulence type='fractalNoise' baseFrequency='0.006 0.22' numOctaves='4' seed='7' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/><feComponentTransfer><feFuncR type='gamma' exponent='1.6'/><feFuncG type='gamma' exponent='1.6'/><feFuncB type='gamma' exponent='1.6'/></feComponentTransfer></filter><rect width='100%' height='100%' filter='url(#w)'/>`,
  600,
  160,
);

/**
 * 古い紙（11/20 20:43 渡辺さん「少し古文書をイメージした紙質」）：細かな繊維と、大きくゆるいむら。白黒の明暗だけで、
 * 紙の色の上に multiply で重ねる。
 */
export const PAPER = svg(
  `<filter id='p' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.85 0.55' numOctaves='3' seed='3' stitchTiles='stitch' result='f'/><feTurbulence type='fractalNoise' baseFrequency='0.0125' numOctaves='3' seed='9' stitchTiles='stitch' result='m'/><feComposite in='f' in2='m' operator='arithmetic' k2='0.45' k3='0.55'/><feColorMatrix type='saturate' values='0'/><feComponentTransfer><feFuncR type='linear' slope='0.7' intercept='0.55'/><feFuncG type='linear' slope='0.7' intercept='0.55'/><feFuncB type='linear' slope='0.7' intercept='0.55'/><feFuncA type='linear' slope='0' intercept='1'/></feComponentTransfer></filter><rect width='100%' height='100%' filter='url(#p)'/>`,
  320,
  320,
);
