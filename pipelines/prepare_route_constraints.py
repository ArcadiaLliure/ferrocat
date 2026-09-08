from __future__ import annotations

"""Build a compact routing-constraint raster for Ferrocat.

The runtime route optimiser works on the same coarse EPSG:25831 grid as
``data/terrain/coarse.runtime.json``.  This builder rasterises authoritative
ICGC RTT vectors into a bit mask so the browser can reason about:

* watercourses (avoid unless a crossing is justified),
* urbanised blocks (higher expropriation cost),
* roads, distinguishing major roads from secondary/local roads.

The output is intentionally compact and contains no third-party geometry:
``data/terrain/constraints.runtime.json``.
"""

import argparse
import json
import math
import os
import time
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from shapely.geometry import LineString, Polygon, box
from shapely.prepared import prep
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TERRAIN = DATA / "terrain"
RAW = DATA / "raw" / "transport" / "icgc_constraints"

RTT_BASE = (
    "https://maps.icgc.cat/vector03/rest/services/RTT/"
    "Referencial_Topogr%C3%A0fic_Territorial/MapServer"
)
HYDRO_LAYER = 16  # 160_hidrografia_eixos_l
URBAN_LAYER = 6   # 060_construccions_illa-urbanitzada_p
ROAD_LAYER = 23   # 230_transports_eixos_l

WATER = 1
URBAN = 2
ROAD = 4
MAJOR_ROAD = 8
PAGE = 700


def session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=4,
        connect=4,
        read=4,
        status=4,
        backoff_factor=0.8,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.headers.update({"User-Agent": "Ferrocat/1.5 route-constraints-builder"})
    return s


def request_json(s: requests.Session, url: str, params: dict) -> dict:
    r = s.get(url, params=params, timeout=(20, 300))
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(str(data["error"]))
    return data


def atomic_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    with tmp.open("w", encoding="utf-8", newline="") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def load_grid() -> dict:
    path = TERRAIN / "coarse.runtime.json"
    if not path.exists():
        raise RuntimeError(
            "Falta data/terrain/coarse.runtime.json. Executa primer "
            "python -m pipelines.PREPARAR_FERROCAT --only terrain"
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    required = {"bbox", "resolution_m", "width", "height"}
    if not required <= set(data):
        raise RuntimeError("coarse.runtime.json no té l'esquema esperat")
    if str(data.get("crs", "EPSG:25831")).upper() != "EPSG:25831":
        raise RuntimeError("El raster de constraints espera EPSG:25831")
    return data


def envelope_params(grid: dict) -> dict:
    b = [float(v) for v in grid["bbox"]]
    return {
        "geometry": ",".join(str(v) for v in b),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "25831",
        "spatialRel": "esriSpatialRelIntersects",
    }


def layer_features(
    s: requests.Session,
    layer: int,
    grid: dict,
    out_fields: str,
    refresh: bool,
) -> list[dict]:
    cache = RAW / f"layer_{layer}.json"
    if cache.exists() and not refresh:
        try:
            rows = json.loads(cache.read_text(encoding="utf-8"))
            if isinstance(rows, list):
                print(f"  cache layer {layer}: {len(rows):,} features")
                return rows
        except Exception:
            pass

    url = f"{RTT_BASE}/{layer}/query"
    common = envelope_params(grid)
    ids_data = request_json(
        s,
        url,
        {
            "f": "json",
            "where": "1=1",
            "returnIdsOnly": "true",
            **common,
        },
    )
    ids = sorted(int(v) for v in (ids_data.get("objectIds") or []))
    print(f"  layer {layer}: {len(ids):,} features")
    rows: list[dict] = []

    for offset in range(0, len(ids), PAGE):
        chunk = ids[offset : offset + PAGE]
        data = request_json(
            s,
            url,
            {
                "f": "json",
                "objectIds": ",".join(map(str, chunk)),
                "outFields": out_fields,
                "returnGeometry": "true",
                "outSR": "25831",
                # 25 m is far below the 500 m routing grid but materially
                # reduces the payload of detailed RTT geometries.
                "maxAllowableOffset": "25",
                "geometryPrecision": "1",
            },
        )
        rows.extend(data.get("features") or [])
        if len(rows) % 10000 < PAGE:
            print(f"    {len(rows):,}/{len(ids):,}")

    RAW.mkdir(parents=True, exist_ok=True)
    atomic_json(cache, rows)
    return rows


def arcgis_lines(geometry: dict | None):
    if not geometry:
        return
    for path in geometry.get("paths") or []:
        pts = [(float(p[0]), float(p[1])) for p in path if len(p) >= 2]
        if len(pts) >= 2:
            yield LineString(pts)


def arcgis_polygons(geometry: dict | None):
    """Yield conservative polygons from ArcGIS rings.

    RTT urban blocks are simple polygons in practice.  Treating every ring as
    an occupied polygon deliberately fills rare holes too, which is preferable
    for a routing exclusion/cost mask and avoids topology errors from mixed
    ring orientation.
    """
    if not geometry:
        return
    for ring in geometry.get("rings") or []:
        pts = [(float(p[0]), float(p[1])) for p in ring if len(p) >= 2]
        if len(pts) < 3:
            continue
        try:
            g = Polygon(pts)
            if not g.is_valid:
                g = g.buffer(0)
            if not g.is_empty:
                yield g
        except Exception:
            continue


def cell_ranges(bounds, grid: dict):
    minx, miny, maxx, maxy = bounds
    b = [float(v) for v in grid["bbox"]]
    res = float(grid["resolution_m"])
    w, h = int(grid["width"]), int(grid["height"])
    c0 = max(0, min(w - 1, math.floor((minx - b[0]) / res)))
    c1 = max(0, min(w - 1, math.floor((maxx - b[0]) / res)))
    r0 = max(0, min(h - 1, math.floor((b[3] - maxy) / res)))
    r1 = max(0, min(h - 1, math.floor((b[3] - miny) / res)))
    return range(r0, r1 + 1), range(c0, c1 + 1)


def rasterise_geometry(mask: list[int], geom, bit: int, grid: dict) -> int:
    if geom.is_empty:
        return 0
    b = [float(v) for v in grid["bbox"]]
    res = float(grid["resolution_m"])
    w = int(grid["width"])
    prepared = prep(geom)
    changed = 0
    rows, cols = cell_ranges(geom.bounds, grid)
    for row in rows:
        y1 = b[3] - row * res
        y0 = y1 - res
        for col in cols:
            x0 = b[0] + col * res
            x1 = x0 + res
            cell = box(x0, y0, x1, y1)
            if not prepared.intersects(cell):
                continue
            idx = row * w + col
            old = mask[idx]
            mask[idx] |= bit
            if mask[idx] != old:
                changed += 1
    return changed


def road_bit(attributes: dict) -> int:
    t = str(attributes.get("tipus") or "").lower().strip()
    x = str(attributes.get("xarxa") or "").lower().strip()

    # RTT runtime classes (aub/vpb/vcb...) plus the older raw codes that are
    # still accepted by PREPARAR_FERROCAT.
    if t in {"aub", "auf", "vpb", "vpf", "vcb"}:
        return ROAD | MAJOR_ROAD
    if t == "aut":
        return ROAD | MAJOR_ROAD
    if t in {"vpd", "vpu"} and x in {"vxb", "vfc"}:
        return ROAD | MAJOR_ROAD
    if t in {"vcd", "vcu"} and x == "vxb":
        return ROAD | MAJOR_ROAD
    return ROAD


def build(refresh: bool = False) -> Path:
    grid = load_grid()
    w, h = int(grid["width"]), int(grid["height"])
    mask = [0] * (w * h)
    s = session()

    print("=== Ferrocat · constraints de traçat ICGC RTT ===")
    hydro = layer_features(s, HYDRO_LAYER, grid, "OBJECTID,tipus,nom", refresh)
    urban = layer_features(s, URBAN_LAYER, grid, "OBJECTID,tipus,estat,nom", refresh)
    roads = layer_features(
        s,
        ROAD_LAYER,
        grid,
        "OBJECTID,tipus,xarxa,estat,codivia,nom",
        refresh,
    )

    counts = {"water_cells": 0, "urban_cells": 0, "road_cells": 0, "major_road_cells": 0}

    print("  rasteritzant hidrografia...")
    for feature in hydro:
        for geom in arcgis_lines(feature.get("geometry")):
            counts["water_cells"] += rasterise_geometry(mask, geom, WATER, grid)

    print("  rasteritzant illes urbanitzades...")
    for feature in urban:
        for geom in arcgis_polygons(feature.get("geometry")):
            counts["urban_cells"] += rasterise_geometry(mask, geom, URBAN, grid)

    print("  rasteritzant carreteres...")
    for feature in roads:
        attrs = feature.get("attributes") or {}
        bit = road_bit(attrs)
        for geom in arcgis_lines(feature.get("geometry")):
            before_major = sum(1 for _ in ())  # explicit no-op; avoids a second geometry pass
            changed = rasterise_geometry(mask, geom, bit, grid)
            counts["road_cells"] += changed
            if bit & MAJOR_ROAD:
                counts["major_road_cells"] += changed

    # Recompute exact per-bit cell counts because cells can be touched by many
    # geometries; the incremental counters above are only progress-like counts.
    counts = {
        "water_cells": sum(1 for v in mask if v & WATER),
        "urban_cells": sum(1 for v in mask if v & URBAN),
        "road_cells": sum(1 for v in mask if v & ROAD),
        "major_road_cells": sum(1 for v in mask if v & MAJOR_ROAD),
    }

    out = {
        "version": 1,
        "crs": "EPSG:25831",
        "bbox": [float(v) for v in grid["bbox"]],
        "resolution_m": float(grid["resolution_m"]),
        "width": w,
        "height": h,
        "bits": {
            "water": WATER,
            "urban": URBAN,
            "road": ROAD,
            "major_road": MAJOR_ROAD,
        },
        "mask": mask,
        "counts": counts,
        "source": "ICGC Referencial Topogràfic Territorial (RTT)",
        "source_layers": {
            "water": HYDRO_LAYER,
            "urban": URBAN_LAYER,
            "roads": ROAD_LAYER,
        },
        "license": "CC BY 4.0",
        "attribution": "Institut Cartogràfic i Geològic de Catalunya (ICGC)",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    target = TERRAIN / "constraints.runtime.json"
    atomic_json(target, out)
    print(f"  OK: {target.relative_to(ROOT)}")
    print(f"  {counts}")
    return target


def main() -> int:
    ap = argparse.ArgumentParser(description="Prepara constraints de traçat ICGC per Ferrocat")
    ap.add_argument("--refresh", action="store_true", help="Redescarrega les capes RTT")
    args = ap.parse_args()
    build(args.refresh)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
