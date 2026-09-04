"""
Tests de regressió per a app.py.

Cobreixen el que la secció 31/38 de l'especificació demana com a mínim
verificable des de Python: que el payload es carrega sense errors, que
l'extracció HTML/CSS del component segueix funcionant després de treure
els <script> morts, i que el bundle del frontend existeix.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as ferrocat_app  # noqa: E402


def test_load_frontend_payload_returns_expected_shape():
    municipis, od_pairs, comarques, meta = ferrocat_app.load_frontend_payload()

    assert isinstance(municipis, list) and len(municipis) > 0
    assert {"id", "nom", "pob", "lat", "lon", "com", "zone"} <= set(municipis[0].keys())

    assert isinstance(od_pairs, list) and len(od_pairs) > 0
    assert len(od_pairs[0]) == 3

    assert isinstance(comarques, list) and len(comarques) == 43

    assert isinstance(meta, dict)


def test_od_pairs_have_no_self_loops():
    _, od_pairs, _, _ = ferrocat_app.load_frontend_payload()
    for origen, desti, _viatges in od_pairs:
        assert origen != desti


def test_extract_component_assets_strips_script_and_style():
    template = ferrocat_app.TEMPLATE_HTML.read_text(encoding="utf-8")
    html_fragment, css = ferrocat_app.extract_component_assets(template)

    assert "<style>" not in html_fragment
    assert "<script>" not in html_fragment
    assert "__MUNICIPIS_JSON__" not in html_fragment
    assert len(css) > 0


def test_frontend_bundle_exists():
    assert ferrocat_app.APP_JS.exists(), (
        "Falta frontend/dist/ferrocat.bundle.js — executa `npm install && npm run build`"
    )
