from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st

FERROCAT_VERSION = "1.5.1"

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
REFERENCE = ROOT / "reference"
DATA = ROOT / "data"

MUNICIPIS_CSV = REFERENCE / "municipis_catalunya.csv"
COMARQUES_JSON = REFERENCE / "comarques_catalunya.json"
TEMPLATE_HTML = FRONTEND / "index.html"
APP_JS = FRONTEND / "app.js"
ROUTE_EDITING_JS = FRONTEND / "route_editing.js"
ROUTE_OPTIMIZER_JS = FRONTEND / "route_optimizer.js"
PROFILE_LINKING_JS = FRONTEND / "profile_linking.js"
GESTURE_ARBITRATION_JS = FRONTEND / "gesture_arbitration.js"
SIDEBAR_RESIZE_JS = FRONTEND / "sidebar_resize.js"

OD_PARQUET = DATA / "od_catalunya.parquet"
REL_PARQUET = DATA / "municipi_ine_to_mitma.parquet"
META_JSON = DATA / "metadata.json"

RAIL_INFRASTRUCTURE_JSON = DATA / "rail" / "infrastructure.runtime.json"
RAIL_SERVICES_JSON = DATA / "rail" / "services.runtime.json"
RAIL_STATIONS_JSON = DATA / "rail" / "stations.runtime.json"
TERRAIN_MANIFEST_JSON = DATA / "terrain" / "terrain_manifest.json"
TERRAIN_COARSE_JSON = DATA / "terrain" / "coarse.runtime.json"
ROUTE_CONSTRAINTS_JSON = DATA / "terrain" / "constraints.runtime.json"

STATIC = ROOT / "static"
ROAD_MANIFEST_JSON = STATIC / "roads" / "manifest.json"
ROAD_LOD0_DIR = STATIC / "roads" / "lod0"
ROAD_OVERVIEW_JSON = STATIC / "roads" / "overview.json"
TERRAIN_CONTOURS_JSON = STATIC / "terrain" / "contours.json"
ATTRIBUTIONS_JSON = DATA / "attributions.json"

MAX_INLINE_ROAD_OVERVIEW_MB = 32.0

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
        [str(row.za), str(row.zb), round(float(row.viatges_dia), 4)]
        for row in od.itertuples(index=False)
    ]

    comarques = load_json(COMARQUES_JSON, [], required=True)
    meta = load_json(META_JSON, {}, required=False)
    return muni_records, od_records, comarques, meta


@st.cache_data(show_spinner=False)
def load_runtime_payload() -> tuple[Any, Any, Any, Any, Any, Any, Any, list[dict], Any, Any]:
    rail_infrastructure = load_json(RAIL_INFRASTRUCTURE_JSON, [], required=False)
    rail_services = load_json(RAIL_SERVICES_JSON, [], required=False)
    rail_stations = load_json(RAIL_STATIONS_JSON, [], required=False)
    terrain_manifest = load_json(TERRAIN_MANIFEST_JSON, {}, required=False)
    terrain_coarse = load_json(TERRAIN_COARSE_JSON, {}, required=False)
    route_constraints = load_json(ROUTE_CONSTRAINTS_JSON, {}, required=False)
    road_manifest = load_json(ROAD_MANIFEST_JSON, {}, required=False)
    roads_overview = load_road_overview()
    terrain_contours = load_json(TERRAIN_CONTOURS_JSON, {}, required=False)
    attributions = load_json(ATTRIBUTIONS_JSON, {"items": []}, required=False)
    return (
        rail_infrastructure,
        rail_services,
        rail_stations,
        terrain_manifest,
        terrain_coarse,
        route_constraints,
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
        raise RuntimeError("frontend/index.html no té l'estructura esperada")
    return body.group(1).strip(), style.group(1).strip()


try:
    municipis, od_pairs, comarques, meta = load_frontend_payload()
    (
        rail_infrastructure,
        rail_services,
        rail_stations,
        terrain_manifest,
        terrain_coarse,
        route_constraints,
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
route_editing_js = ROUTE_EDITING_JS.read_text(encoding="utf-8")
route_optimizer_js = ROUTE_OPTIMIZER_JS.read_text(encoding="utf-8")
profile_linking_js = PROFILE_LINKING_JS.read_text(encoding="utf-8")
gesture_arbitration_js = GESTURE_ARBITRATION_JS.read_text(encoding="utf-8")
sidebar_resize_js = SIDEBAR_RESIZE_JS.read_text(encoding="utf-8")

js = f"""export default function(component) {{
  const {{ parentElement, data }} = component;

  const MUNICIPIS = data.municipis || [];
  const COMARQUES = data.comarques || [];
  const OD_PAIRS = data.od_pairs || [];
  const META = data.meta || {{}};

  const RAIL_EDGES = data.rail_infrastructure || [];
  const RAIL_SERVICES = data.rail_services || [];
  const RAIL_STATIONS = data.rail_stations || [];

  const ROAD_MANIFEST = data.road_manifest || {{}};
  const ROADS = data.roads_overview || [];

  const TERRAIN_MANIFEST = data.terrain_manifest || {{}};
  const TERRAIN_COARSE = data.terrain_coarse || {{}};
  const ROUTE_CONSTRAINTS = data.route_constraints || {{}};
  const TERRAIN_CONTOURS = data.terrain_contours || {{}};
  const ATTRIBUTIONS = data.attributions || {{items: []}};

{client_js}

{route_editing_js}

{route_optimizer_js}

{profile_linking_js}

{gesture_arbitration_js}

{sidebar_resize_js}
}}"""

rail_app = st.components.v2.component(
    "ferrocat_fullscreen_v1_5_1_route_optimizer",
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
        "route_constraints": route_constraints,
        "terrain_contours": terrain_contours,
        "attributions": attributions,
    },
    key="ferrocat_fullscreen_v1_5_1_route_optimizer",
    width="stretch",
    height="content",
)
