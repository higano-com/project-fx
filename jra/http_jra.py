"""JRA公式サイトへのアクセスを、全プロセス合わせて1本ずつ・MIN_GAP 秒以上あけて行う。

過去データの取得と当日の見張りが同時に動いても同時アクセスにならないよう、
ファイルロックで順番待ちをする。「混雑中」(503など)のときは長めに待って再試行し、
続けて失敗したら諦める(無理に取りにいかない)。
"""
import fcntl
import os
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://www.jra.go.jp/JRADB/"
MIN_GAP = 5.0
UA = "Mozilla/5.0 (personal research)"
LOCK = Path(os.environ.get("JRA_LOCK", Path(tempfile.gettempdir()) / "jra_http.lock"))


def _once(page: str, cname: str) -> str:
    with open(LOCK, "a+") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            lk.seek(0)
            try:
                last = float(lk.read().strip() or 0)
            except ValueError:
                last = 0.0
            wait = last + MIN_GAP - time.time()
            if wait > 0:
                time.sleep(wait)
            data = urllib.parse.urlencode({"cname": cname}).encode()
            req = urllib.request.Request(BASE + page, data=data, headers={"User-Agent": UA})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return r.read().decode("cp932", errors="replace")
            finally:
                lk.seek(0)
                lk.truncate()
                lk.write(str(time.time()))
                lk.flush()
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN)


def post(page: str, cname: str, tries: int = 4) -> str:
    for i in range(tries):
        try:
            return _once(page, cname)
        except Exception as e:
            print(f"  失敗 {cname}: {e}、待って再試行", flush=True)
            if i < tries - 1:
                time.sleep(60 * (i + 1))
    raise RuntimeError(cname)
