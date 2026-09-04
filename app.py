from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd
import streamlit as st

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

st.set_page_config(
    page_title="Simulador de línies de tren — Catalunya",
    page_icon="🚆",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# The simulator itself owns the complete viewport. Strip Streamlit chrome/padding.
st.markdown(
    """
    <style>
      header[data-testid="stHeader"] {display:none}
      [data-testid="stToolbar"] {display:none}
      [data-testid="stSidebar"] {display:none}
      [data-testid="stAppViewContainer"] {background:#081c33; overflow:hidden;}
      [data-testid="stMain"] {overflow:hidden;}
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


@st.cache_data
def load_frontend_payload() -> tuple[list[dict], list[list], list[dict], dict]:
    missing = [
        p for p in (MUNICIPIS_CSV, COMARQUES_JSON, OD_PARQUET, REL_PARQUET)
        if not p.exists()
    ]
    if missing:
        raise FileNotFoundError(
            "Falten fitxers: " + ", ".join(str(p.relative_to(ROOT)) for p in missing)
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
        .agg(lambda s: s.value_counts().index[0])
    )
    municipis = municipis.merge(rel, on="ine_code", how="left")
    municipis["mitma_zone"] = municipis["mitma_zone"].fillna("")

    muni_records = [
        {
            "id": str(r.ine_code),
            "nom": str(r.nom),
            "pob": float(r.poblacio) if pd.notna(r.poblacio) else 0.0,
            "lat": float(r.lat),
            "lon": float(r.lon),
            "com": "" if pd.isna(r.comarca) else str(r.comarca),
            "zone": str(r.mitma_zone),
        }
        for r in municipis.itertuples(index=False)
    ]

    od = pd.read_parquet(
        OD_PARQUET,
        columns=["origen", "destino", "viatges_dia"],
    )
    od["origen"] = od["origen"].astype(str)
    od["destino"] = od["destino"].astype(str)
    od["viatges_dia"] = pd.to_numeric(od["viatges_dia"], errors="coerce").fillna(0.0)
    od = od[(od["origen"] != od["destino"]) & (od["viatges_dia"] > 0)].copy()
    od["za"] = od[["origen", "destino"]].min(axis=1)
    od["zb"] = od[["origen", "destino"]].max(axis=1)
    od = od.groupby(["za", "zb"], as_index=False)["viatges_dia"].sum()
    od_records = [
        [str(r.za), str(r.zb), round(float(r.viatges_dia), 4)]
        for r in od.itertuples(index=False)
    ]

    comarques = json.loads(COMARQUES_JSON.read_text(encoding="utf-8"))
    meta = json.loads(META_JSON.read_text(encoding="utf-8")) if META_JSON.exists() else {}
    return muni_records, od_records, comarques, meta


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
except FileNotFoundError as exc:
    st.error(str(exc))
    st.code("python download_mobility.py\npython -m streamlit run app.py")
    st.stop()

if not hasattr(st.components, "v2"):
    st.error(
        'Aquesta versió necessita Streamlit >= 1.62. Executa:\n'
        'python -m pip install -U "streamlit>=1.62"'
    )
    st.stop()

template = TEMPLATE_HTML.read_text(encoding="utf-8")
html_fragment, css = extract_component_assets(template)
client_js = APP_JS.read_text(encoding="utf-8")

# V2 executes inline in the Streamlit page instead of in a fixed-height iframe.
# Existing client code is wrapped in the component renderer and receives data
# through `data`, while all user interaction remains browser-local.
js = f"""export default function(component) {{
  const {{ parentElement, data }} = component;
  const MUNICIPIS = data.municipis || [];
  const COMARQUES = data.comarques || [];
  const OD_PAIRS = data.od_pairs || [];
  const META = data.meta || {{}};

{client_js}
}}
"""

rail_app = st.components.v2.component(
    "catatrens_fullscreen",
    html=html_fragment,
    css=css,
    js=js,
    isolate_styles=True,
)

# SECURITY: everything passed to the browser component is public to the client.
# Never put API keys, tokens, credentials, environment secrets or private data here.
rail_app(
    data={
        "municipis": municipis,
        "comarques": comarques,
        "od_pairs": od_pairs,
        "meta": meta,
    },
    key="catatrens_fullscreen_v9",
    width="stretch",
    height="content",
)
