// 写真の情報（EXIF）を読む（空の写真、2026-11-27 見本）。JPEG の APP1（Exif）だけ。HEIC は読まない（Safari が
// 選んだ写真を JPEG にして渡すかは端末の設定しだいなので、見本で何が読めるかを確かめる）。ライブラリは使わない。
// 読むもの：撮影時刻と時差、カメラ、露出時間・F 値・ISO・焦点距離、向き（GPS の写した方位）、位置。

export interface PhotoExif {
  /** 撮影時刻（"2026:11:27 17:05:12"、カメラの時計） */
  taken: string | null;
  /** 時差（"+09:00"） */
  offset: string | null;
  make: string | null;
  model: string | null;
  lens: string | null;
  exposure: number | null;
  fNumber: number | null;
  iso: number | null;
  focalLength: number | null;
  /** 写した方位（度、北から東回り）と、その基準（T＝真北、M＝磁北） */
  direction: number | null;
  directionRef: string | null;
  lat: number | null;
  lon: number | null;
}

const EMPTY: PhotoExif = { taken: null, offset: null, make: null, model: null, lens: null, exposure: null, fNumber: null, iso: null, focalLength: null, direction: null, directionRef: null, lat: null, lon: null };

/** JPEG の中身から EXIF を読む。読めなければ、全部 null。 */
export function readExif(buf: ArrayBuffer): PhotoExif {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return { ...EMPTY };
  let p = 2;
  while (p + 4 <= v.byteLength) {
    const marker = v.getUint16(p);
    const size = v.getUint16(p + 2);
    if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return readTiff(v, p + 10);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    p += 2 + size;
  }
  return { ...EMPTY };
}

function readTiff(v: DataView, t: number): PhotoExif {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o: number) => v.getUint16(t + o, le);
  const u32 = (o: number) => v.getUint32(t + o, le);
  const out: PhotoExif = { ...EMPTY };
  const entries = (ifd: number) => {
    const n = u16(ifd);
    const list: { tag: number; type: number; count: number; at: number }[] = [];
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      list.push({ tag: u16(e), type: u16(e + 2), count: u32(e + 4), at: e + 8 });
    }
    return list;
  };
  const size = (type: number) => ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 })[type] ?? 1;
  const where = (e: { type: number; count: number; at: number }) => (size(e.type) * e.count > 4 ? u32(e.at) : e.at);
  const ascii = (e: { type: number; count: number; at: number }) => {
    const o = where(e);
    let s = "";
    for (let i = 0; i < e.count; i++) {
      const c = v.getUint8(t + o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.trim() || null;
  };
  const rational = (e: { type: number; at: number }, k = 0) => {
    const o = where({ ...e, count: 1 }) + k * 8;
    const a = u32(o);
    const b = u32(o + 4);
    return b ? a / b : null;
  };
  const short = (e: { type: number; at: number }) => (e.type === 3 ? u16(e.at) : u32(e.at));
  try {
    let exifIfd = 0;
    let gpsIfd = 0;
    for (const e of entries(u32(4))) {
      if (e.tag === 0x010f) out.make = ascii(e);
      else if (e.tag === 0x0110) out.model = ascii(e);
      else if (e.tag === 0x8769) exifIfd = u32(e.at);
      else if (e.tag === 0x8825) gpsIfd = u32(e.at);
    }
    if (exifIfd)
      for (const e of entries(exifIfd)) {
        if (e.tag === 0x9003) out.taken = ascii(e);
        else if (e.tag === 0x9011) out.offset = ascii(e);
        else if (e.tag === 0x829a) out.exposure = rational(e);
        else if (e.tag === 0x829d) out.fNumber = rational(e);
        else if (e.tag === 0x8827) out.iso = short(e);
        else if (e.tag === 0x920a) out.focalLength = rational(e);
        else if (e.tag === 0xa434) out.lens = ascii(e);
      }
    if (gpsIfd) {
      let latRef = "N";
      let lonRef = "E";
      for (const e of entries(gpsIfd)) {
        if (e.tag === 0x0001) latRef = ascii(e) ?? "N";
        else if (e.tag === 0x0003) lonRef = ascii(e) ?? "E";
        else if (e.tag === 0x0010) out.directionRef = ascii(e);
        else if (e.tag === 0x0011) out.direction = rational(e);
        else if (e.tag === 0x0002 || e.tag === 0x0004) {
          const d = (rational(e, 0) ?? 0) + (rational(e, 1) ?? 0) / 60 + (rational(e, 2) ?? 0) / 3600;
          if (e.tag === 0x0002) out.lat = d;
          else out.lon = d;
        }
      }
      if (out.lat != null && latRef === "S") out.lat = -out.lat;
      if (out.lon != null && lonRef === "W") out.lon = -out.lon;
    }
  } catch {
    // 壊れた EXIF は、読めた所まで
  }
  return out;
}

/** 撮影時刻を ISO に（時差が無ければ日本時間とみなす）。 */
export function takenIso(x: PhotoExif): string | null {
  const m = x.taken?.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${x.offset ?? "+09:00"}`;
}

/** 方位を 16 方位の言葉に。 */
export function compass16(deg: number): string {
  const names = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
