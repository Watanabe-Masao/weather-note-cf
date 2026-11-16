#!/usr/bin/env bash
pip -q install pyarrow pandas >/dev/null 2>&1
python3 research/wxchart/fh03.py
