from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import streamlit as st

FERROCAT_VERSION = "1.5.0"

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
REFERENCE = ROOT / "reference"
DATA = ROOT / "data"

MUNICIPIS_CSV = REFERENCE / "municipis_catalunya.csv"
COMARQUES_JSON = REFERENCE / "comarques_catalunya.json"
TEMPLATE_HTML = FRONTEND / "index.html"
APP_JS = FRONTEND / "app.js"

OD_PARQUET = DATA / "od_catalunya.parquet"
REL_PARQUET = DATA / "municipi_ine_to_mitma.parquet"
META_JSON = DATA / "metadata.json"

RAIL_INFRASTRUCTURE_JSON = DATA / "rail" / "infrastructure.runtime.json"
RAIL_SERVICES_JSON = DATA / "rail" / "services.runtime.json"
RAIL_STATIONS_JSON = DATA / "rail" / "stations.runtime.json"
TERRAIN_MANIFEST_JSON = DATA / "terrain" / "terrain_manifest.json"
TERRAIN_COARSE_JSON = DATA / "terrain" / "coarse.runtime.json"

STATIC = ROOT / "static"
ROAD_MANIFEST_JSON = STATIC / "roads" / "manifest.json"
ROAD_LOD0_DIR = STATIC / "roads" / "lod0"
ROAD_OVERVIEW_JSON = STATIC / "roads" / "overview.json"
TERRAIN_CONTOURS_JSON = STATIC / "terrain" / "contours.json"
ATTRIBUTIONS_JSON = DATA / "attributions.json"

MAX_INLINE_ROAD_OVERVIEW_MB = 32.0
ANALYSIS_TERRAIN_RESOLUTION_M = 200.0
TERRAIN_NODATA = -32768

st.set_page_config(
    page_title="Ferrocat — Simulador ferroviari de Catalunya",
    page_icon="🚆",
    layout="wide",
    initial_sidebar_state="collapsed",
)

st.markdown(
    """
    <style>
      header[data-testid="stHeader"] {display:none}
      [data-testid="stToolbar"] {display:none}
      [data-testid="stSidebar"] {display:none}
      [data-testid="stAppViewContainer"] {
        background:#081c33;
        overflow:hidden;
      }
      [data-testid="stMain"] {overflow:hidden}
      .block-container {
        padding:0 !important;
        margin:0 !important;
        max-width:none !important;
        width:100% !important;
      }
    </style>
    """,
    unsafe_allow_html=True,
)


def load_json(path: Path, default: Any, *, required: bool = False) -> Any:
    if not path.exists():
        if required:
            raise FileNotFoundError(str(path))
        return default

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        if required:
            raise RuntimeError(f"No s'ha pogut llegir {path}: {exc}") from exc
        print(f"[Ferrocat] WARN: no s'ha pogut llegir {path}: {exc}")
        return default



def load_road_overview() -> list[dict]:
    """Carga un overview compacto y garantizado de la red viaria principal."""
    if ROAD_OVERVIEW_JSON.exists():
        rows = load_json(ROAD_OVERVIEW_JSON, [], required=False)
        return rows if isinstance(rows, list) else []

    # Compatibilidad con V3: si todavía no existe overview.json, intentamos
    # construir el fallback inline directamente desde LOD0.
    if not ROAD_LOD0_DIR.exists():
        return []

    files = sorted(ROAD_LOD0_DIR.glob("*.json"))
    if not files:
        return []

    total_bytes = sum(path.stat().st_size for path in files)
    if total_bytes > MAX_INLINE_ROAD_OVERVIEW_MB * 1024 * 1024:
        print(
            "[Ferrocat] INFO: LOD0 de carreteres no s'injecta inline "
            f"({total_bytes / 1024 / 1024:.1f} MB). "
            "Executa python -m pipelines.prepare_road_overview."
        )
        return []

    rows: list[dict] = []
    for path in files:
        chunk = load_json(path, [], required=False)
        if isinstance(chunk, list):
            rows.extend(chunk)
    return rows



def build_analysis_terrain(
    manifest: dict,
    fallback: dict,
    target_resolution_m: float = ANALYSIS_TERRAIN_RESOLUTION_M,
) -> dict:
    """Construeix el DEM d'anàlisi a partir dels tiles detallats del ICGC.

    El runtime global antic és de 500 m i és massa gruixut per calcular
    pendents, túnels i viaductes. Els tiles del manifest són normalment de
    100 m; els agreguem a 200 m per mantenir el payload del component en una
    mida raonable. L'agregació ignora NoData, cosa especialment important a
    la costa, on una cel·la parcialment terrestre no ha de convertir-se en
    un buit artificial.
    """
    if not isinstance(manifest, dict) or not isinstance(fallback, dict):
        return fallback

    tiles = manifest.get("tiles") or []
    bbox = manifest.get("bbox") or []
    try:
        source_resolution = float(manifest.get("resolution_m"))
        minx, miny, maxx, maxy = map(float, bbox)
    except (TypeError, ValueError):
        return fallback

    if (
        not tiles
        or source_resolution <= 0
        or target_resolution_m < source_resolution
    ):
        return fallback

    factor = int(round(target_resolution_m / source_resolution))
    if factor < 1 or not math.isclose(
        source_resolution * factor,
        target_resolution_m,
        rel_tol=0.0,
        abs_tol=1e-6,
    ):
        return fallback

    source_width = int(math.ceil((maxx - minx) / source_resolution))
    source_height = int(math.ceil((maxy - miny) / source_resolution))
    if source_width <= 0 or source_height <= 0:
        return fallback

    source = np.full(
        (source_height, source_width),
        TERRAIN_NODATA,
        dtype=np.int16,
    )
    loaded_tiles = 0

    for tile in tiles:
        try:
            rows = int(tile["rows"])
            cols = int(tile["cols"])
            tx0, _ty0, _tx1, ty1 = map(float, tile["bbox"])
            tile_path = DATA / "terrain" / str(tile["file"])
        except (KeyError, TypeError, ValueError):
            continue

        if rows <= 0 or cols <= 0 or not tile_path.exists():
            continue

        arr = np.fromfile(tile_path, dtype="<i2")
        if arr.size != rows * cols:
            print(
                f"[Ferrocat] WARN: tile DEM invàlid {tile_path.name}: "
                f"{arr.size} valors, esperats {rows * cols}"
            )
            continue
        arr = arr.reshape(rows, cols)

        col0 = int(round((tx0 - minx) / source_resolution))
        row0 = int(round((maxy - ty1) / source_resolution))
        col1 = min(source_width, col0 + cols)
        row1 = min(source_height, row0 + rows)
        if col0 < 0 or row0 < 0 or col0 >= col1 or row0 >= row1:
            continue

        source[row0:row1, col0:col1] = arr[: row1 - row0, : col1 - col0]
        loaded_tiles += 1

    if loaded_tiles == 0:
        return fallback

    target_width = int(math.ceil(source_width / factor))
    target_height = int(math.ceil(source_height / factor))
    padded_height = target_height * factor
    padded_width = target_width * factor

    padded = np.full(
        (padded_height, padded_width),
        TERRAIN_NODATA,
        dtype=np.int16,
    )
    padded[:source_height, :source_width] = source

    blocks = padded.reshape(target_height, factor, target_width, factor)
    valid = blocks != TERRAIN_NODATA
    counts = valid.sum(axis=(1, 3))
    sums = np.where(valid, blocks, 0).astype(np.int64).sum(axis=(1, 3))

    terrain = np.full(
        (target_height, target_width),
        TERRAIN_NODATA,
        dtype=np.int16,
    )
    has_data = counts > 0
    terrain[has_data] = np.rint(sums[has_data] / counts[has_data]).astype(np.int16)

    print(
        "[Ferrocat] DEM d'anàlisi: "
        f"{source_resolution:g} m → {target_resolution_m:g} m "
        f"({loaded_tiles:,} tiles, {target_width:,}×{target_height:,} cel·les)"
    )
    return {
        "crs": manifest.get("crs", "EPSG:25831"),
        "bbox": [minx, miny, maxx, maxy],
        "resolution_m": target_resolution_m,
        "width": target_width,
        "height": target_height,
        "nodata": TERRAIN_NODATA,
        "values": terrain.reshape(-1).astype(int).tolist(),
    }


@st.cache_data(show_spinner=False)
def load_frontend_payload() -> tuple[list[dict], list[list], list[dict], dict]:
    missing = [
        path
        for path in (
            MUNICIPIS_CSV,
            COMARQUES_JSON,
            OD_PARQUET,
            REL_PARQUET,
        )
        if not path.exists()
    ]
    if missing:
        raise FileNotFoundError(
            "Falten fitxers: "
            + ", ".join(str(path.relative_to(ROOT)) for path in missing)
        )

    municipis = pd.read_csv(
        MUNICIPIS_CSV,
        dtype={"ine_code": str, "id_idescat": str},
    )
    municipis["ine_code"] = municipis["ine_code"].astype(str).str.zfill(5)

    rel = pd.read_parquet(REL_PARQUET)
    rel["ine_code"] = rel["ine_code"].astype(str).str.zfill(5)
    rel["mitma_zone"] = rel["mitma_zone"].astype(str)
    rel = (
        rel.groupby("ine_code", as_index=False)["mitma_zone"]
        .agg(lambda values: values.value_counts().index[0])
    )

    municipis = municipis.merge(rel, on="ine_code", how="left")
    municipis["mitma_zone"] = municipis["mitma_zone"].fillna("")

    muni_records = [
        {
            "id": str(row.ine_code),
            "nom": str(row.nom),
            "pob": float(row.poblacio) if pd.notna(row.poblacio) else 0.0,
            "lat": float(row.lat),
            "lon": float(row.lon),
            "com": "" if pd.isna(row.comarca) else str(row.comarca),
            "zone": str(row.mitma_zone),
        }
        for row in municipis.itertuples(index=False)
    ]

    od = pd.read_parquet(
        OD_PARQUET,
        columns=["origen", "destino", "viatges_dia"],
    )
    od["origen"] = od["origen"].astype(str)
    od["destino"] = od["destino"].astype(str)
    od["viatges_dia"] = pd.to_numeric(
        od["viatges_dia"],
        errors="coerce",
    ).fillna(0.0)

    od = od[
        (od["origen"] != od["destino"])
        & (od["viatges_dia"] > 0)
    ].copy()

    od["za"] = od[["origen", "destino"]].min(axis=1)
    od["zb"] = od[["origen", "destino"]].max(axis=1)
    od = od.groupby(["za", "zb"], as_index=False)["viatges_dia"].sum()

    od_records = [
        [
            str(row.za),
            str(row.zb),
            round(float(row.viatges_dia), 4),
        ]
        for row in od.itertuples(index=False)
    ]

    comarques = load_json(COMARQUES_JSON, [], required=True)
    meta = load_json(META_JSON, {}, required=False)

    return muni_records, od_records, comarques, meta


@st.cache_data(show_spinner=False)
def load_runtime_payload() -> tuple[
    Any,
    Any,
    Any,
    Any,
    Any,
    Any,
    list[dict],
    Any,
    Any,
]:
    rail_infrastructure = load_json(
        RAIL_INFRASTRUCTURE_JSON,
        [],
        required=False,
    )
    rail_services = load_json(
        RAIL_SERVICES_JSON,
        [],
        required=False,
    )
    rail_stations = load_json(
        RAIL_STATIONS_JSON,
        [],
        required=False,
    )
    terrain_manifest = load_json(
        TERRAIN_MANIFEST_JSON,
        {},
        required=False,
    )
    terrain_coarse = load_json(
        TERRAIN_COARSE_JSON,
        {},
        required=False,
    )
    terrain_coarse = build_analysis_terrain(terrain_manifest, terrain_coarse)
    road_manifest = load_json(
        ROAD_MANIFEST_JSON,
        {},
        required=False,
    )
    roads_overview = load_road_overview()
    terrain_contours = load_json(
        TERRAIN_CONTOURS_JSON,
        {},
        required=False,
    )
    attributions = load_json(ATTRIBUTIONS_JSON, {"items": []}, required=False)
    return (
        rail_infrastructure,
        rail_services,
        rail_stations,
        terrain_manifest,
        terrain_coarse,
        road_manifest,
        roads_overview,
        terrain_contours,
        attributions,
    )


def extract_component_assets(template: str) -> tuple[str, str]:
    style = re.search(r"<style>(.*?)</style>", template, flags=re.S)
    body = re.search(
        r'<body>\s*(.*?)(?=<script>\s*const MUNICIPIS)',
        template,
        flags=re.S,
    )
    if not style or not body:
        raise RuntimeError(
            "frontend/index.html no té l'estructura esperada"
        )
    return body.group(1).strip(), style.group(1).strip()


try:
    municipis, od_pairs, comarques, meta = load_frontend_payload()
    (
        rail_infrastructure,
        rail_services,
        rail_stations,
        terrain_manifest,
        terrain_coarse,
        road_manifest,
        roads_overview,
        terrain_contours,
        attributions,
    ) = load_runtime_payload()
except (FileNotFoundError, RuntimeError) as exc:
    st.error(str(exc))
    st.stop()

if not hasattr(st.components, "v2"):
    st.error(
        "Aquesta versió necessita Streamlit >= 1.62.\n"
        "Executa:\n"
        "python -m pip install -r requirements.txt"
    )
    st.stop()

template = TEMPLATE_HTML.read_text(encoding="utf-8")
html_fragment, css = extract_component_assets(template)
client_js = APP_JS.read_text(encoding="utf-8")

js = f"""export default function(component) {{
  const {{ parentElement, data }} = component;

  const MUNICIPIS = data.municipis || [];
  const COMARQUES = data.comarques || [];
  const OD_PAIRS = data.od_pairs || [];
  const META = data.meta || {{}};

  const RAIL_EDGES = data.rail_infrastructure || [];
  const RAIL_SERVICES = data.rail_services || [];
  const RAIL_STATIONS = data.rail_stations || [];

  // Carreteres: manifest + LOD0 s'injecten com a fallback.
  // Els LOD detallats es carreguen sota demanda des de /app/static/roads.
  const ROAD_MANIFEST = data.road_manifest || {{}};
  const ROADS = data.roads_overview || [];

  const TERRAIN_MANIFEST = data.terrain_manifest || {{}};
  const TERRAIN_COARSE = data.terrain_coarse || {{}};
  const TERRAIN_CONTOURS = data.terrain_contours || {{}};
  const ATTRIBUTIONS = data.attributions || {{items: []}};

{client_js}
}}"""

rail_app = st.components.v2.component(
    "ferrocat_fullscreen_v1_5_0_public_sources",
    html=html_fragment,
    css=css,
    js=js,
    isolate_styles=True,
)

rail_app(
    data={
        "municipis": municipis,
        "comarques": comarques,
        "od_pairs": od_pairs,
        "meta": meta,
        "rail_infrastructure": rail_infrastructure,
        "rail_services": rail_services,
        "rail_stations": rail_stations,
        "road_manifest": road_manifest,
        "roads_overview": roads_overview,
        "terrain_manifest": terrain_manifest,
        "terrain_coarse": terrain_coarse,
        "terrain_contours": terrain_contours,
        "attributions": attributions,
    },
    key="ferrocat_fullscreen_v1_5_0_public_sources",
    width="stretch",
    height="content",
)
