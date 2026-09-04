from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse
from xml.etree.ElementTree import ParseError

import pandas as pd
import requests
from defusedxml import ElementTree as ET
from defusedxml.common import DefusedXmlException
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_URL = "https://movilidad-opendata.mitma.es"
CAT_PROVINCES = ("08", "17", "25", "43")  # Barcelona, Girona, Lleida, Tarragona
RSS_URL = f"{BASE_URL}/RSS.xml"
USER_AGENT = "simulador-ferroviari-catalunya/1.0 (+OpenData MITMS)"

ALLOWED_DOWNLOAD_HOSTS = frozenset({"movilidad-opendata.mitma.es"})
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
MAX_REDIRECTS = 5
MAX_RSS_BYTES = 10 * 1024 * 1024
MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024 * 1024
# Deliberately generous hard ceiling: protects against anomalous decompression while
# remaining far above the expected scale of the official daily municipal dataset.
MAX_ROWS_PER_DATASET = 250_000_000
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
CONNECT_TIMEOUT_SECONDS = 15
READ_TIMEOUT_SECONDS = 180
RSS_READ_TIMEOUT_SECONDS = 30


@dataclass(frozen=True)
class DownloadedDay:
    day: date
    path: Path


def is_catalan_mitma_zone(value: object) -> bool:
    s = str(value)
    return s.startswith(CAT_PROVINCES)


def validate_download_url(url: str) -> None:
    """Allow downloads only from the official MITMS HTTPS endpoint."""
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme.lower() != "https":
        raise RuntimeError(f"Es rebutja una URL no HTTPS: {url}")
    if hostname not in ALLOWED_DOWNLOAD_HOSTS:
        raise RuntimeError(f"Es rebutja un host de descàrrega no autoritzat: {hostname or '<buit>'}")
    if parsed.username is not None or parsed.password is not None:
        raise RuntimeError("No s'admeten credencials incrustades a les URL de descàrrega.")
    if parsed.port not in (None, 443):
        raise RuntimeError(f"Es rebutja un port HTTPS no autoritzat: {parsed.port}")


def request_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        status=3,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("https://", adapter)
    return s


def _get_with_validated_redirects(
    session: requests.Session,
    url: str,
    *,
    stream: bool,
    timeout: tuple[int, int],
) -> requests.Response:
    """GET while validating every redirect target instead of following blindly."""
    current = url
    for redirect_count in range(MAX_REDIRECTS + 1):
        validate_download_url(current)
        response = session.get(
            current,
            stream=stream,
            timeout=timeout,
            allow_redirects=False,
        )
        validate_download_url(response.url or current)
        if response.status_code not in REDIRECT_STATUSES:
            return response

        location = response.headers.get("Location")
        response.close()
        if not location:
            raise RuntimeError("Resposta de redirecció sense capçalera Location.")
        if redirect_count >= MAX_REDIRECTS:
            raise RuntimeError("Massa redireccions durant la descàrrega.")
        current = urljoin(current, location)
        validate_download_url(current)

    raise RuntimeError("Massa redireccions durant la descàrrega.")


def _content_length(headers: requests.structures.CaseInsensitiveDict | dict[str, str]) -> int | None:
    raw = headers.get("Content-Length")
    if raw is None:
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def _check_declared_size(headers: requests.structures.CaseInsensitiveDict | dict[str, str], max_bytes: int) -> None:
    declared = _content_length(headers)
    if declared is not None and declared > max_bytes:
        raise RuntimeError(
            f"La descàrrega declara {declared:,} bytes, per sobre del límit de {max_bytes:,}."
        )


def fetch_limited_bytes(
    session: requests.Session,
    url: str,
    *,
    max_bytes: int,
    timeout: tuple[int, int] = (CONNECT_TIMEOUT_SECONDS, RSS_READ_TIMEOUT_SECONDS),
) -> bytes:
    """Fetch a small resource with both declared and observed byte limits."""
    response = _get_with_validated_redirects(session, url, stream=True, timeout=timeout)
    with response:
        response.raise_for_status()
        _check_declared_size(response.headers, max_bytes)
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=min(DOWNLOAD_CHUNK_BYTES, max_bytes + 1)):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                raise RuntimeError(f"La resposta supera el límit de {max_bytes:,} bytes.")
            chunks.append(chunk)
        return b"".join(chunks)


def download_file(
    session: requests.Session,
    url: str,
    dest: Path,
    optional: bool = False,
    *,
    max_bytes: int = MAX_DOWNLOAD_BYTES,
) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return True

    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.unlink(missing_ok=True)
    try:
        response = _get_with_validated_redirects(
            session,
            url,
            stream=True,
            timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
        )
        with response:
            if response.status_code == 404 and optional:
                return False
            response.raise_for_status()
            _check_declared_size(response.headers, max_bytes)

            total = 0
            with tmp.open("wb") as file_obj:
                for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_BYTES):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > max_bytes:
                        raise RuntimeError(
                            f"La descàrrega supera el límit de {max_bytes:,} bytes."
                        )
                    file_obj.write(chunk)

            if total == 0:
                raise RuntimeError("La descàrrega ha retornat un fitxer buit.")
            tmp.replace(dest)
            return True
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def download_reference_files(session: requests.Session, raw_dir: Path) -> dict[str, Path]:
    """Download the MITMS municipality/INE crosswalk required by the app."""
    refs = {
        "relation": (
            f"{BASE_URL}/zonificacion/relacion_ine_zonificacionMitma.csv",
            raw_dir / "zonificacion" / "relacion_ine_zonificacionMitma.csv",
        ),
        "names": (
            f"{BASE_URL}/zonificacion/zonificacion_municipios/nombres_municipios.csv",
            raw_dir / "zonificacion" / "nombres_municipios.csv",
        ),
        "population": (
            f"{BASE_URL}/zonificacion/zonificacion_municipios/poblacion_municipios.csv",
            raw_dir / "zonificacion" / "poblacion_municipios.csv",
        ),
    }
    out: dict[str, Path] = {}
    for key, (url, path) in refs.items():
        print(f"[ref] {url}")
        download_file(session, url, path)
        out[key] = path
    return out


def read_relation(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep="|", dtype=str)
    normalized = {c.lower().strip(): c for c in df.columns}

    def pick(*candidates: str) -> str:
        for cand in candidates:
            if cand in normalized:
                return normalized[cand]
        raise KeyError(f"No trobo cap de les columnes {candidates}. Columnes: {list(df.columns)}")

    ine_col = pick("municipio_ine", "municipi_ine")
    mitma_col = pick("municipio_mitma", "municipi_mitma")

    rel = df[[ine_col, mitma_col]].dropna().rename(
        columns={ine_col: "ine_code", mitma_col: "mitma_zone"}
    )
    rel["ine_code"] = rel["ine_code"].astype(str).str.zfill(5)
    rel["mitma_zone"] = rel["mitma_zone"].astype(str)

    rel = (
        rel.groupby("ine_code", as_index=False)["mitma_zone"]
        .agg(lambda s: s.value_counts().index[0])
    )
    rel = rel[rel["ine_code"].str.startswith(CAT_PROVINCES)].copy()
    return rel


def daily_url(day: date) -> str:
    ym = day.strftime("%Y-%m")
    ymd = day.strftime("%Y%m%d")
    return (
        f"{BASE_URL}/estudios_basicos/por-municipios/viajes/"
        f"ficheros-diarios/{ym}/{ymd}_Viajes_municipios.csv.gz"
    )


def get_latest_available_day(
    session: requests.Session,
    *,
    max_bytes: int = MAX_RSS_BYTES,
) -> date:
    """Return the newest municipal OD date advertised by the official MITMS RSS."""
    print(f"[rss] consultant {RSS_URL}")
    xml_bytes = fetch_limited_bytes(session, RSS_URL, max_bytes=max_bytes)

    try:
        root = ET.fromstring(xml_bytes)
    except (ParseError, DefusedXmlException) as exc:
        raise RuntimeError("El RSS del MITMS no és un XML vàlid o segur.") from exc

    dates: list[date] = []
    for item in root.findall(".//item"):
        link = item.findtext("link")
        if not link:
            continue
        filename = link.rsplit("/", 1)[-1].split("?", 1)[0]
        match = re.fullmatch(r"(\d{8})_Viajes_municipios\.csv\.gz", filename)
        if not match:
            continue
        try:
            dates.append(datetime.strptime(match.group(1), "%Y%m%d").date())
        except ValueError:
            continue

    if not dates:
        raise RuntimeError(
            "El RSS del MITMS no conté cap fitxer YYYYMMDD_Viajes_municipios.csv.gz."
        )

    latest = max(dates)
    print(f"[rss] últim Viajes_municipios publicat: {latest.isoformat()}")
    return latest


def download_days(session: requests.Session, raw_dir: Path) -> list[DownloadedDay]:
    """Download only the newest municipal OD file advertised by the official RSS."""
    latest_day = get_latest_available_day(session)
    ymd = latest_day.strftime("%Y%m%d")
    dest = (
        raw_dir
        / "viajes_municipios"
        / latest_day.strftime("%Y-%m")
        / f"{ymd}_Viajes_municipios.csv.gz"
    )
    url = daily_url(latest_day)
    print(f"[download] {url}")
    ok = download_file(session=session, url=url, dest=dest, optional=False)

    if not ok or not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError(f"No s'ha pogut descarregar un fitxer vàlid per a {latest_day}.")

    print(f"[download] OK — {dest.name} ({dest.stat().st_size / 1024 / 1024:.1f} MB)")
    return [DownloadedDay(day=latest_day, path=dest)]


def read_daily_catalonia(
    path: Path,
    valid_zones: set[str],
    *,
    max_rows: int = MAX_ROWS_PER_DATASET,
) -> pd.DataFrame:
    """Read the national matrix in chunks, retaining Catalonia-only OD flows."""
    wanted = {"origen", "destino", "viajes", "viajes_km"}
    pieces: list[pd.DataFrame] = []
    rows_seen = 0

    reader = pd.read_csv(
        path,
        sep="|",
        compression="gzip",
        chunksize=250_000,
        dtype={"origen": str, "destino": str},
        low_memory=False,
    )
    for chunk in reader:
        rows_seen += len(chunk)
        if rows_seen > max_rows:
            raise RuntimeError(
                f"{path.name}: supera el límit defensiu de {max_rows:,} files."
            )
        missing = {"origen", "destino", "viajes"} - set(chunk.columns)
        if missing:
            raise RuntimeError(f"{path.name}: falten columnes {sorted(missing)}")
        cols = [c for c in wanted if c in chunk.columns]
        c = chunk[cols].copy()
        c["origen"] = c["origen"].astype(str)
        c["destino"] = c["destino"].astype(str)
        mask = c["origen"].isin(valid_zones) & c["destino"].isin(valid_zones)
        c = c.loc[mask]
        if c.empty:
            continue
        c["viajes"] = pd.to_numeric(c["viajes"], errors="coerce").fillna(0.0)
        if "viajes_km" in c.columns:
            c["viajes_km"] = pd.to_numeric(c["viajes_km"], errors="coerce").fillna(0.0)
        agg_cols = {"viajes": "sum"}
        if "viajes_km" in c.columns:
            agg_cols["viajes_km"] = "sum"
        pieces.append(c.groupby(["origen", "destino"], as_index=False).agg(agg_cols))

    if not pieces:
        return pd.DataFrame(columns=["origen", "destino", "viajes", "viajes_km"])

    all_parts = pd.concat(pieces, ignore_index=True)
    agg_cols = {"viajes": "sum"}
    if "viajes_km" in all_parts.columns:
        agg_cols["viajes_km"] = "sum"
    return all_parts.groupby(["origen", "destino"], as_index=False).agg(agg_cols)


def build_dataset(days: list[DownloadedDay], relation: pd.DataFrame, out_dir: Path) -> None:
    valid_zones = set(relation["mitma_zone"].dropna().astype(str))
    daily_frames: list[pd.DataFrame] = []

    for item in days:
        print(f"[proc] {item.day}: filtrant Catalunya i agregant OD...")
        df = read_daily_catalonia(item.path, valid_zones)
        df["fecha"] = pd.Timestamp(item.day)
        daily_frames.append(df)

    daily = pd.concat(daily_frames, ignore_index=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    agg_spec = {
        "viatges_dia": ("viajes", "mean"),
        "viatges_std": ("viajes", "std"),
        "dies_observats": ("fecha", "nunique"),
    }
    if "viajes_km" in daily.columns:
        agg_spec["viatges_km_dia"] = ("viajes_km", "mean")

    od = (
        daily.groupby(["origen", "destino"], as_index=False)
        .agg(**agg_spec)
        .fillna({"viatges_std": 0.0})
    )

    relation.to_parquet(out_dir / "municipi_ine_to_mitma.parquet", index=False)
    od.to_parquet(out_dir / "od_catalunya.parquet", index=False)

    meta = {
        "source": "MITMS Estudio de movilidad con Big Data - estudios_basicos/por-municipios/viajes",
        "base_url": BASE_URL,
        "days": [x.day.isoformat() for x in days],
        "n_days": len(days),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "aggregation": "Últim dia municipal publicat al RSS; totes les franges i segments del dia agregats.",
        "scope": "Origen i destí en zones MITMS associades a municipis de Catalunya.",
    }
    (out_dir / "metadata.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print()
    print("Fet.")
    print(f"  OD:      {out_dir / 'od_catalunya.parquet'} ({len(od):,} relacions direccionals)")
    print(f"  Mapa ID: {out_dir / 'municipi_ine_to_mitma.parquet'} ({len(relation):,} municipis INE)")
    print(f"  Dies:    {', '.join(meta['days'])}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Descarrega i prepara la matriu OD municipal MITMS només per Catalunya."
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "data",
        help="Directori on es guardaran els fitxers raw i els Parquet processats.",
    )
    args = parser.parse_args()

    data_dir = args.data_dir.resolve()
    raw_dir = data_dir / "raw"
    session = request_session()

    print("=== Referències de zonificació ===")
    refs = download_reference_files(session, raw_dir)
    relation = read_relation(refs["relation"])

    print()
    print("=== Matrius OD diàries ===")
    days = download_days(session=session, raw_dir=raw_dir)

    print()
    print("=== Processament ===")
    build_dataset(days, relation, data_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
