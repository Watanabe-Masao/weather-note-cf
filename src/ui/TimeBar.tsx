// 時刻の操作（2026-11-19 渡辺さん）：太陽と月のシート・全画面・月のこよみで同じ形。
// - つまみの両側に ◀ ▶（10分ずつ）。
// - 「現在時刻」：押すと今の時刻に付いていく（付いている間は選んでいる色）。もう一度押すと付いていくのをやめる。今日だけ。
// - ▶／⏸：時間を進めて見る（再生）。
import { Button, Glyph, IconButton, Slider } from "./kit";

const STEP = 10;

export function TimeBar({
  value,
  onChange,
  ticks,
  valueText,
  follow,
  onFollow,
  playing,
  onPlay,
  className,
}: {
  value: number;
  onChange: (m: number) => void;
  ticks: number[];
  valueText: string;
  /** 今日でないときは undefined（「現在時刻」を出さない）。 */
  follow?: boolean;
  onFollow?: () => void;
  playing: boolean;
  onPlay: () => void;
  className?: string;
}) {
  const clamp = (m: number) => Math.max(0, Math.min(1430, m));
  return (
    <div className={`sun-play${className ? ` ${className}` : ""}`}>
      <div className="time-row">
        <IconButton size="sm" label="10分前へ" disabled={value <= 0} onClick={() => onChange(clamp(Math.ceil(value / STEP) * STEP - STEP))}>
          <Glyph name="prev" />
        </IconButton>
        <Slider className="sun-slider" min={0} max={1430} step={STEP} ticks={ticks} thumbs={[{ value, label: "時刻（10分ごと）", valueText, onChange }]} />
        <IconButton size="sm" label="10分先へ" disabled={value >= 1430} onClick={() => onChange(clamp(Math.floor(value / STEP) * STEP + STEP))}>
          <Glyph name="next" />
        </IconButton>
      </div>
      <div className="time-acts">
        {follow !== undefined && onFollow && (
          <Button size="sm" aria-pressed={follow} aria-label={follow ? "現在時刻に付いていく（押すとやめる）" : "現在時刻に付いていく"} onClick={onFollow}>
            現在時刻
          </Button>
        )}
        <Button size="sm" className="sun-playbtn" aria-pressed={playing} aria-label={playing ? "止める" : "時間を動かす"} onClick={onPlay}>
          <Glyph name={playing ? "pause" : "play"} />
        </Button>
      </div>
    </div>
  );
}
