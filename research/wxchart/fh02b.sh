#!/usr/bin/env bash
set -u
R=https://raw.githubusercontent.com/shiromatz/Japan-Meteorological-Agency-Weather-Forecast/main/forecast
for ym in 202111 202112 202201 202206 202301; do
  curl -sL -o f.zip $R/forecast_$ym.zip
  echo "$ym: $(unzip -l f.zip | grep -c csv) files, 高知: $(unzip -l f.zip | grep -o 'forecast_[0-9]*_3900[0-9]*.csv' | tr '\n' ' ')"
  unzip -l f.zip | awk '{print $4}' | grep csv | head -3 | tr '\n' ' '; echo
done
pip -q install pyarrow pandas >/dev/null 2>&1
curl -sL -o j.parquet https://huggingface.co/datasets/jniimi/weather_forecast_japan/resolve/main/data/train/2026-10.parquet
python3 - <<'PY'
import pandas as pd
d=pd.read_parquet("j.parquet"); print(d.shape); print(list(d.columns)); 
for c in d.columns:
    if "name" in c or "place" in c: print(c, sorted(d[c].unique())[:30])
k=d[d.apply(lambda r: "高知" in " ".join(map(str,r.values)),axis=1)]; print("高知 rows",len(k)); print(k.head(3).to_string()[:1500])
PY
