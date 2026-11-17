// JMA's forecast JSON flattened the way shiromatz's record does (FH-05): for the tests of the record (#250).

/** JMA's forecast JSON as the record flattens it: a row per area (or station) and time. */
export function flatten(json: { publishingOffice: string; reportDatetime: string; timeSeries: { timeDefines: string[]; areas: Record<string, unknown>[] }[] }[]): string {
  const cols = ["publishingOffice", "reportDatetime", "timeDefine", "areaName", "areaCode", "weatherCodes", "weathers", "winds", "waves", "pops", "temps", "tempsMin", "tempsMax", "tempsMinUpper", "tempsMaxUpper", "tempsMinLower", "tempsMaxLower", "reliabilities"];
  const lines = [cols.join(",")];
  for (const part of json)
    for (const ts of part.timeSeries)
      ts.timeDefines.forEach((t, i) => {
        for (const a of ts.areas) {
          const area = a.area as { name: string; code: string };
          const r: Record<string, string> = { publishingOffice: part.publishingOffice, reportDatetime: part.reportDatetime, timeDefine: t, areaName: area.name, areaCode: area.code };
          for (const k of cols.slice(5)) if (Array.isArray(a[k])) r[k] = String((a[k] as string[])[i] ?? "");
          lines.push(cols.map((c) => r[c] ?? "").join(","));
        }
      });
  return lines.join("\n") + "\n";
}
