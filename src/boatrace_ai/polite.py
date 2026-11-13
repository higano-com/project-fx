"""公式サイト(boatrace.jp)へのアクセスを、全プロセス合わせて1本ずつ・2秒以上あけて行う.

見張りと過去データの収集が同時に動いても、サイトへの同時アクセスにならないよう、
ファイルロックで順番待ちをし、前のアクセスが終わってから MIN_GAP 秒は待つ。
"""

from __future__ import annotations

import fcntl
import os
import tempfile
import time
import urllib.request
from pathlib import Path

MIN_GAP = 2.0  # 前のアクセスが終わってから次を始めるまでの最低間隔(秒)
LOCK_PATH = Path(os.environ.get("BOATRACE_LOCK", Path(tempfile.gettempdir()) / "boatrace_ai_http.lock"))


def fetch_text(url: str, timeout: float = 30) -> str:
    """url を取得して UTF-8 の文字列で返す. 他のプロセスのアクセス中は順番を待つ."""
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK_PATH, "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            lock.seek(0)
            try:
                last = float(lock.read().strip() or 0)
            except ValueError:
                last = 0.0
            wait = last + MIN_GAP - time.time()
            if wait > 0:
                time.sleep(wait)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    return resp.read().decode("utf-8", errors="replace")
            finally:
                lock.seek(0)
                lock.truncate()
                lock.write(str(time.time()))
                lock.flush()
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
