from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

USER_AGENT = "Ferrocat/1.1 (+https://github.com/ArcadiaLliure/ferrocat)"


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        status=3,
        backoff_factor=0.8,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


def validate_https(url: str, allowed_hosts: set[str] | None = None) -> None:
    p = urlparse(url)
    if p.scheme != "https":
        raise RuntimeError(f"Només es permet HTTPS: {url}")
    if allowed_hosts is not None and p.hostname not in allowed_hosts:
        raise RuntimeError(f"Host no autoritzat: {p.hostname}")


def download_atomic(
    url: str,
    dest: Path,
    *,
    allowed_hosts: set[str] | None = None,
    max_bytes: int = 2 * 1024**3,
    timeout: tuple[int, int] = (20, 180),
) -> Path:
    validate_https(url, allowed_hosts)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with session().get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            validate_https(r.url, allowed_hosts)
            declared = int(r.headers.get("Content-Length", "0") or 0)
            if declared > max_bytes:
                raise RuntimeError(f"Descàrrega massa gran ({declared} bytes)")
            total = 0
            with tmp.open("wb") as f:
                for chunk in r.iter_content(1024 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > max_bytes:
                        raise RuntimeError("Descàrrega supera el límit configurat")
                    f.write(chunk)
        os.replace(tmp, dest)
        return dest
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write_json_atomic(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=path.parent)
    os.close(fd)
    tmp = Path(name)
    try:
        tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def metadata(source: str, source_url: str, license_name: str, attribution: str, **extra: object) -> dict:
    return {
        "source": source,
        "source_url": source_url,
        "license": license_name,
        "attribution": attribution,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        **extra,
    }
