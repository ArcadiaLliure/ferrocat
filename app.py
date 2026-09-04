from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd
import streamlit as st

FERROCAT_VERSION = "1.1-functional"
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
RAIL_RUNTIME = DATA / "rail" / "infrastructure.runtime.json"
SERVICES_RUNTIME = DATA / "rail" / "services.runtime.json"
ROADS_RUNTIME = DATA / "roads" / "roads.runtime.json"
TERRAIN_MANIFEST = DATA / "terrain" / "terrain_manifest.json"
TERRAIN_COARSE = DATA / "terrain" / "coarse.runtime.json"

st.set_page_config(page_title="Ferrocat — Simulador ferroviari de Catalunya", page_icon="🚆", layout="wide", initial_sidebar_state="collapsed")
st.markdown("""
<style>
header[data-testid="stHeader"],[data-testid="stToolbar"],[data-testid="stSidebar"]{display:none}
[data-testid="stAppViewContainer"]{background:#081c33;overflow:hidden}
[data-testid="stMain"]{overflow:hidden}.block-container{padding:0!important;margin:0!important;max-width:none!important;width:100%!important}
</style>
""", unsafe_allow_html=True)


def _json_or(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


@st.cache_data
def load_frontend_payload() -> dict:
    missing = [p for p in (MUNICIPIS_CSV, COMARQUES_JSON, OD_PARQUET, REL_PARQUET) if not p.exists()]
    if missing:
        raise FileNotFoundError("Falten fitxers: " + ", ".join(str(p.relative_to(ROOT)) for p in missing))
    municipis = pd.read_csv(MUNICIPIS_CSV, dtype={"ine_code": str, "id_idescat": str})
    municipis["ine_code"] = municipis["ine_code"].astype(str).str.zfill(5)
    rel = pd.read_parquet(REL_PARQUET)
    rel["ine_code"] = rel["ine_code"].astype(str).str.zfill(5)
    rel["mitma_zone"] = rel["mitma_zone"].astype(str)
    rel = rel.groupby("ine_code", as_index=False)["mitma_zone"].agg(lambda s: s.value_counts().index[0])
    municipis = municipis.merge(rel, on="ine_code", how="left")
    municipis["mitma_zone"] = municipis["mitma_zone"].fillna("")
    muni_records = [{
        "id": str(r.ine_code), "nom": str(r.nom), "pob": float(r.poblacio) if pd.notna(r.poblacio) else 0.0,
        "lat": float(r.lat), "lon": float(r.lon), "com": "" if pd.isna(r.comarca) else str(r.comarca), "zone": str(r.mitma_zone)
    } for r in municipis.itertuples(index=False)]
    od = pd.read_parquet(OD_PARQUET, columns=["origen","destino","viatges_dia"])
    od["origen"] = od["origen"].astype(str); od["destino"] = od["destino"].astype(str)
    od["viatges_dia"] = pd.to_numeric(od["viatges_dia"], errors="coerce").fillna(0.0)
    od = od[(od["origen"] != od["destino"]) & (od["viatges_dia"] > 0)].copy()
    od["za"] = od[["origen","destino"]].min(axis=1); od["zb"] = od[["origen","destino"]].max(axis=1)
    od = od.groupby(["za","zb"], as_index=False)["viatges_dia"].sum()
    return {
        "municipis": muni_records,
        "od_pairs": [[str(r.za),str(r.zb),round(float(r.viatges_dia),4)] for r in od.itertuples(index=False)],
        "comarques": _json_or(COMARQUES_JSON, []),
        "meta": _json_or(META_JSON, {}),
        "rail_edges": _json_or(RAIL_RUNTIME, []),
        "rail_services": _json_or(SERVICES_RUNTIME, []),
        "roads": _json_or(ROADS_RUNTIME, []),
        "terrain_manifest": _json_or(TERRAIN_MANIFEST, {}),
        "terrain_coarse": _json_or(TERRAIN_COARSE, {}),
    }


def extract_component_assets(template: str) -> tuple[str, str]:
    style = re.search(r"<style>(.*?)</style>", template, flags=re.S)
    body = re.search(r'<body>\s*(.*?)(?=<script>\s*const MUNICIPIS)', template, flags=re.S)
    if not style or not body:
        raise RuntimeError("frontend/index.html no té l'estructura esperada")
    return body.group(1).strip(), style.group(1).strip()


try:
    payload = load_frontend_payload()
except FileNotFoundError as exc:
    st.error(str(exc)); st.code("python download_mobility.py\npython -m streamlit run app.py"); st.stop()
if not hasattr(st.components, "v2"):
    st.error("Aquesta versió necessita Streamlit >= 1.62"); st.stop()

template = TEMPLATE_HTML.read_text(encoding="utf-8")
html_fragment, css = extract_component_assets(template)
client_js = APP_JS.read_text(encoding="utf-8")
js = f"""export default function(component) {{
  const {{ parentElement, data }} = component;
  const MUNICIPIS=data.municipis||[], COMARQUES=data.comarques||[], OD_PAIRS=data.od_pairs||[], META=data.meta||{{}};
  const RAIL_EDGES=data.rail_edges||[], RAIL_SERVICES=data.rail_services||[], ROADS=data.roads||[], TERRAIN_MANIFEST=data.terrain_manifest||{{}};
{client_js}
}}"""
rail_app = st.components.v2.component("ferrocat_fullscreen", html=html_fragment, css=css, js=js, isolate_styles=True)
# SECURITY: everything below is public in the browser component.
rail_app(data=payload, key="ferrocat_fullscreen_v1_1_functional", width="stretch", height="content")
