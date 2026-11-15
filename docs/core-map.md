# core の依存の図

`src/core/map.ts` が計算式の `needs`・`series`・`params` から作る図（`npm run core-map`）。手で直さない。計算式を足す・変えると、テストがこの文書との違いを知らせる。

## 計算上の依存

どの値から計算するか。コード（計算式の `needs`・`series`・`choices`）からだけ作る。線があることは、効くことが確かめられたという意味ではない。

```mermaid
flowchart LR
  subgraph 材料
    temp["気温（毎時）<br><code>temp</code>"]
    humidity["湿度（毎時）<br><code>humidity</code>"]
    wind["風速（毎時）<br><code>wind</code>"]
    rain["降水量（毎時）<br><code>rain</code>"]
    sunshine["日照時間（毎時）<br><code>sunshine</code>"]
    windHeight["風速計の高さ（場所）<br><code>windHeight</code>"]
    lat["緯度（場所）<br><code>lat</code>"]
    lon["経度（場所）<br><code>lon</code>"]
    hourStart["時刻<br><code>hourStart</code>"]
    dayMeans["平均気温（前の日から）<br><code>dayMeans</code>"]
  end
  subgraph 推測値
    windPerson["人の高さの風速<br><code>wind.person@1</code> m/s<br><small>数：personHeight・alpha</small>"]
    feelShade["肌感（日かげ）<br><code>feel.shade@1</code> ℃<br><small>数：neutral・a0・a1・a2・c0・c1・d</small>"]
    radSunshine["日照から推測した日射<br><code>rad.sunshine@1</code> W/m²<br><small>数：hazeMean・hazeAmplitude・hazeClearestDay・cloudy・sharePower・rainRef・rainDim・rainPower・rainFloor</small>"]
    windTen["10 m の風速<br><code>wind.ten@1</code> m/s<br><small>数：tenMeters・alpha</small>"]
    feelSun["肌感（日なた）<br><code>feel.sun@1</code> ℃<br><small>数：k・windOffset・absorb</small>"]
    historyMean["長期の気温履歴（単純平均）<br><code>history.long.mean@1</code> ℃<br><small>数：days・minDays</small>"]
    historyEma["長期の気温履歴（重み付きの平均）<br><code>history.long.ema@1</code> ℃<br><small>数：alpha・days・minCoverage</small>"]
  end
  subgraph 判定
    seasonShift["境目のずれ（季節）<br><code>judge.shift.season@1</code> ℃<br><small>数：slope・lo・hi・ref</small>"]
    level7["7段の判定<br><code>judge.level7@1</code> 段<br><small>数：b1・b2・b3・b4・b5・b6</small>"]
  end
  wind --> windPerson
  windHeight --> windPerson
  temp --> feelShade
  humidity --> feelShade
  windPerson --> feelShade
  hourStart --> radSunshine
  lat --> radSunshine
  lon --> radSunshine
  sunshine --> radSunshine
  rain --> radSunshine
  wind --> windTen
  windHeight --> windTen
  feelShade --> feelSun
  radSunshine --> feelSun
  windTen --> feelSun
  dayMeans -. 前の日から .-> historyMean
  dayMeans -. 前の日から .-> historyEma
  historyMean == どれか ==> seasonShift
  historyEma == どれか ==> seasonShift
  feelShade == どれか ==> level7
  seasonShift == どれか ==> level7
```

## 仮説上の影響

何が何に効くと考えているか（研究上の主張、`src/core/hypotheses.ts`）。状態は、答えの1歩先の予測で比べた結果だけが変える（仮説 → 確かめ中 → 支持／支持されない）。

```mermaid
flowchart LR
  historyMean["長期の気温履歴（単純平均）<br><code>historyMean</code>"]
  adaptation(["適応状態（慣れ）：直接は見えない状態"])
  historyEma["長期の気温履歴（重み付きの平均）<br><code>historyEma</code>"]
  shortHistory(["短期の履歴（当日の数時間）：これから作る"])
  rate(["肌感の変化の速さ：これから作る"])
  intercept(["切片：同じ肌感でも感じ方がどちらへ偏るか"])
  slope(["傾き：肌感の変化にどれだけ強く反応するか"])
  timeOfDay(["時刻（朝・昼・夜）"])
  historyMean -. "仮説<br><code>hyp.long-history.adaptation</code>" .-> adaptation
  historyEma -. "仮説<br><code>hyp.long-history-ema.adaptation</code>" .-> adaptation
  shortHistory -. "仮説<br><code>hyp.short-history.adaptation</code>" .-> adaptation
  rate -. "仮説<br><code>hyp.rate.intercept</code>" .-> intercept
  historyEma -. "仮説<br><code>hyp.long-history.intercept</code>" .-> intercept
  adaptation -. "仮説<br><code>hyp.adaptation.intercept</code>" .-> intercept
  adaptation -. "仮説<br><code>hyp.adaptation.slope</code>" .-> slope
  timeOfDay -. "仮説<br><code>hyp.time.intercept</code>" .-> intercept
```

## 確かめられた関係

まだない。学習あり版の比べた結果（効果の大きさと幅つき）から作る。手で書かない。
