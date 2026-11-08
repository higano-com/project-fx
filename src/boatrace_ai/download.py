"""公式サイト(mbrace)から番組表(B)・競走成績(K)のLZHファイルを取得して展開する."""

from __future__ import annotations

import io
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

BASE_URL = "https://www1.mbrace.or.jp/od2"


def file_url(kind: str, d: date) -> str:
    """kind は 'B'(番組表) か 'K'(競走成績)."""
    kind = kind.upper()
    return f"{BASE_URL}/{kind}/{d:%Y%m}/{kind.lower()}{d:%y%m%d}.lzh"


def _extract_lzh(data: bytes) -> bytes:
    import lhafile

    archive = lhafile.Lhafile(io.BytesIO(data))
    names = archive.namelist()
    if not names:
        raise ValueError("empty LZH archive")
    return archive.read(names[0])


def download_day(d: date, out_dir: Path, kinds: tuple[str, ...] = ("B", "K"), overwrite: bool = False) -> list[Path]:
    """1日分のファイルを取得し、Shift_JISのまま txt で保存する."""
    out_dir.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    for kind in kinds:
        path = out_dir / f"{kind.lower()}{d:%y%m%d}.txt"
        if path.exists() and not overwrite:
            saved.append(path)
            continue
        try:
            with urllib.request.urlopen(file_url(kind, d), timeout=30) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:  # 開催なし・未公開
                continue
            raise
        path.write_bytes(_extract_lzh(raw))
        saved.append(path)
    return saved


def download_range(start: date, end: date, out_dir: Path, sleep: float = 1.0, **kwargs) -> list[Path]:
    saved: list[Path] = []
    d = start
    while d <= end:
        saved += download_day(d, out_dir, **kwargs)
        time.sleep(sleep)  # サーバ負荷への配慮
        d += timedelta(days=1)
    return saved
