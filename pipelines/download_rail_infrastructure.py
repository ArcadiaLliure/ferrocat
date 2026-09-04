from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
import requests

from pipelines.common import metadata, session, write_json_atomic

ICGC_LAYER_URL = (
    "https://maps.icgc.cat/vector03/rest/services/RTT/"
    "Referencial_Topogr%C3%A0fic_Territorial/MapServer/25/query"
)
ALLOWED_HOST = "maps.icgc.cat"
RAIL_TYPES = {"ave", "fvc", "fer", "cre", "tra", "met", "fun", "prj"}


def fetch_features(where: str = "1=1", page_size: int = 1800) -> list[dict]:
    """Download RTT transport line features from the official ArcGIS REST API."""
    s = session()
    out: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": where,
            "outFields": "tipus,entorn,estat,terreny,xarxa,codivia,nom",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": page_size,
            "orderByFields": "OBJECTID",
        }
        r = s.get(ICGC_LAYER_URL, params=params, timeout=(20, 120))
        r.raise_for_status()
        if requests.utils.urlparse(r.url).hostname != ALLOWED_HOST:
            raise RuntimeError("Redirecció inesperada del servei ICGC")
        payload = r.json()
        features = payload.get("features") or []
        out.extend(features)
        print(f"[RTT] {len(out):,} features")
        if len(features) < page_size:
            break
        offset += len(features)
    return out


def _flatten_linestring(geometry: dict) -> list[list[list[float]]]:
    if geometry.get("type") == "LineString":
        return [geometry.get("coordinates") or []]
    if geometry.get("type") == "MultiLineString":
        return geometry.get("coordinates") or []
    return []


def build_runtime(features: list[dict]) -> tuple[list[dict], list[dict]]:
    rail: list[dict] = []
    roads: list[dict] = []
    for idx, feature in enumerate(features):
        props = feature.get("properties") or {}
        tipus = str(props.get("tipus") or "").lower()
        target = rail if tipus in RAIL_TYPES else roads
        for part_index, coords in enumerate(_flatten_linestring(feature.get("geometry") or {})):
            if len(coords) < 2:
                continue
            target.append({
                "id": f"rtt-{idx}-{part_index}",
                "tipus": tipus,
                "nom": props.get("nom") or "",
                "estat": props.get("estat") or "",
                "xarxa": props.get("xarxa") or "",
                "codivia": props.get("codivia") or "",
                "coords": [[round(float(lon), 6), round(float(lat), 6)] for lon, lat, *_ in coords],
            })
    return rail, roads


def write_geoparquet(features: list[dict], path: Path) -> None:
    try:
        import geopandas as gpd
    except ImportError as exc:
        raise RuntimeError("Instal·la requirements-pipeline.txt per generar GeoParquet") from exc
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_parquet(path, index=False)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("data/rail"))
    ap.add_argument("--roads-out", type=Path, default=Path("data/roads"))
    args = ap.parse_args()
    print("[1/4] Descarregant RTT transports...")
    features = fetch_features()
    print("[2/4] Separant ferrocarril i carreteres...")
    rail_runtime, road_runtime = build_runtime(features)
    rail_features = [f for f in features if str((f.get("properties") or {}).get("tipus") or "").lower() in RAIL_TYPES]
    road_features = [f for f in features if str((f.get("properties") or {}).get("tipus") or "").lower() not in RAIL_TYPES]
    print("[3/4] Escrivint GeoParquet/runtime...")
    args.out.mkdir(parents=True, exist_ok=True); args.roads_out.mkdir(parents=True, exist_ok=True)
    write_geoparquet(rail_features, args.out / "infrastructure.geoparquet")
    write_geoparquet(road_features, args.roads_out / "roads_catalunya.geoparquet")
    write_json_atomic(args.out / "infrastructure.runtime.json", rail_runtime)
    write_json_atomic(args.roads_out / "roads.runtime.json", road_runtime)
    print("[4/4] Metadades...")
    write_json_atomic(args.out / "metadata.json", metadata(
        "ICGC Referencial Topogràfic Territorial (RTT)", ICGC_LAYER_URL,
        "CC BY 4.0", "Institut Cartogràfic i Geològic de Catalunya (ICGC)",
        rail_features=len(rail_runtime), source_crs="EPSG:25831", output_crs="EPSG:4326",
    ))
    print(f"OK: {len(rail_runtime):,} trams ferroviaris; {len(road_runtime):,} trams no ferroviaris")


if __name__ == "__main__":
    main()
