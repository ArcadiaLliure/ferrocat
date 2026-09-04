from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import requests

BASE_URL = "https://movilidad-opendata.mitma.es"
CAT_PROVINCES = ("08", "17", "25", "43")  # Barcelona, Girona, Lleida, Tarragona
RSS_URL = f"{BASE_URL}/RSS.xml"
USER_AGENT = "simulador-ferroviari-catalunya/1.0 (+OpenData MITMS)"


@dataclass(frozen=True)
class DownloadedDay:
    day: date
    path: Path


def is_catalan_mitma_zone(value: object) -> bool:
    s = str(value)
    return s.startswith(CAT_PROVINCES)


def request_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    return s


def download_file(session: requests.Session, url: str, dest: Path, optional: bool = False) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return True
    try:
        with session.get(url, stream=True, timeout=(15, 180)) as r:
            if r.status_code == 404 and optional:
                return False
            r.raise_for_status()
            tmp = dest.with_suffix(dest.suffix + ".part")
            with tmp.open("wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        f.write(chunk)
            tmp.replace(dest)
            return True
    except requests.HTTPError:
        if optional:
            return False
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

    # Relation is repeated by census section; municipality -> MITMA municipal zone
    # should resolve to one zone. Keep the mode defensively if duplicates exist.
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



def get_latest_available_day(session: requests.Session) -> date:
    """
    Retorna la data més recent disponible per al fitxer
    YYYYMMDD_Viajes_municipios.csv.gz consultant el RSS oficial del MITMS.

    No prova dates una a una: descarrega RSS.xml una sola vegada, extreu totes
    les dates publicades per a Viajes_municipios i en retorna la màxima.
    """
    print(f"[rss] consultant {RSS_URL}")

    response = session.get(RSS_URL, timeout=30)
    response.raise_for_status()

    try:
        root = ET.fromstring(response.content)
    except ET.ParseError as exc:
        raise RuntimeError("El RSS del MITMS no és un XML vàlid.") from exc

    dates: list[date] = []

    # El RSS té habitualment estructura rss/channel/item, però fem servir
    # .//item per tolerar petits canvis d'estructura.
    for item in root.findall(".//item"):
        link = item.findtext("link")
        if not link:
            continue

        filename = link.rsplit("/", 1)[-1].split("?", 1)[0]

        match = re.fullmatch(
            r"(\d{8})_Viajes_municipios\.csv\.gz",
            filename,
        )
        if not match:
            continue

        try:
            dates.append(datetime.strptime(match.group(1), "%Y%m%d").date())
        except ValueError:
            continue

    if not dates:
        raise RuntimeError(
            "El RSS del MITMS no conté cap fitxer "
            "YYYYMMDD_Viajes_municipios.csv.gz."
        )

    latest = max(dates)
    print(f"[rss] últim Viajes_municipios publicat: {latest.isoformat()}")
    return latest

def download_days(
    session: requests.Session,
    raw_dir: Path,
) -> list[DownloadedDay]:
    """
    Consulta el RSS oficial per saber quina és la data més recent publicada
    i descarrega únicament aquell fitxer municipal.
    """
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

    ok = download_file(
        session=session,
        url=url,
        dest=dest,
        optional=False,
    )

    if not ok or not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError(
            f"No s'ha pogut descarregar un fitxer vàlid per a {latest_day}."
        )

    print(
        f"[download] OK — {dest.name} "
        f"({dest.stat().st_size / 1024 / 1024:.1f} MB)"
    )

    return [DownloadedDay(day=latest_day, path=dest)]


def read_daily_catalonia(path: Path, valid_zones: set[str]) -> pd.DataFrame:
    """
    Read a nationwide daily matrix in chunks, retain Catalonia-only OD flows,
    and aggregate all hourly/activity/sociodemographic segments.
    """
    wanted = {"origen", "destino", "viajes", "viajes_km"}
    pieces: list[pd.DataFrame] = []

    reader = pd.read_csv(
        path,
        sep="|",
        compression="gzip",
        chunksize=250_000,
        dtype={"origen": str, "destino": str},
        low_memory=False,
    )
    for chunk in reader:
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

    # Amb un únic dia publicat, aquesta agregació conserva la matriu direccional d'aquell dia.
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

    # Store both compact matrix and mapping used by Streamlit.
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
    (out_dir / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

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
    days = download_days(
        session=session,
        raw_dir=raw_dir,
    )

    print()
    print("=== Processament ===")
    build_dataset(days, relation, data_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
