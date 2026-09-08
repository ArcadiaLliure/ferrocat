from __future__ import annotations

import argparse
import importlib.util
import csv
import hashlib
import io
import json
import math
import os
import random
import re
import shutil
import threading
import time
import unicodedata
import zipfile
from collections import Counter, OrderedDict, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Iterator

import numpy as np
import pandas as pd
import requests
from PIL import Image
from pyproj import Transformer
from requests.adapters import HTTPAdapter
from shapely.geometry import GeometryCollection, LineString, MultiLineString, box, shape
from shapely.ops import linemerge, transform as shapely_transform, unary_union
from skimage import measure
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
STATIC = ROOT / "static"
RAW = DATA / "raw" / "transport"
RAIL = DATA / "rail"
ROADS_OUT = STATIC / "roads"
TERRAIN = DATA / "terrain"
STATIC_TERRAIN = STATIC / "terrain"

RAIL_INFRA_LAYER = (
    "https://maps.icgc.cat/vector03/rest/services/"
    "RTT/Referencial_Topogr%C3%A0fic_Territorial/MapServer/25"
)
RAIL_INFRA_QUERY = RAIL_INFRA_LAYER + "/query"
RAIL_INFRA_TYPES = ("ave", "fvc", "fer", "cre", "tra", "met", "fun", "prj")

TERRAIN_WCS_URL = "https://geoserveis.icgc.cat/icc_mdt/wcs/service"
DEFAULT_TERRAIN_BBOX = (255000.0, 4485000.0, 530000.0, 4755000.0)
TERRAIN_NODATA = -32768

# -----------------------------------------------------------------------------
# Fonts. Mode públic: NO fem servir GTFS TMB ni Open Data TRAM per evitar
# condicions específiques/restrictives. Metro i tramvia venen d'IGR-RT CNIG.
# -----------------------------------------------------------------------------
ICGC_LAYER = (
    "https://maps.icgc.cat/vector03/rest/services/"
    "RTT/Referencial_Topogr%C3%A0fic_Territorial/MapServer/23"
)
ICGC_QUERY = ICGC_LAYER + "/query"

RENFE_CER = (
    "https://ssl.renfe.com/ftransit/"
    "Fichero_CER_FOMENTO/fomento_transit.zip"
)
FGC_GTFS = "https://www.fgc.cat/google/google_transit.zip"

CNIG_BASE = (
    "https://certiserviciosgis.ign.es/servicios/rest/services/"
    "RT/igr_rt_ferrocarril/MapServer"
)
CNIG_STATIONS = CNIG_BASE + "/0/query"
CNIG_UIC = CNIG_BASE + "/4/query"
CNIG_LINE_TYPE = CNIG_BASE + "/8/query"

CAT_BBOX = (-0.25, 40.35, 3.55, 43.05)
CAT_BOX = box(*CAT_BBOX)

CONNECT_TIMEOUT = 20
READ_TIMEOUT = 300
MAX_ATTEMPTS = 8
ROAD_WORKERS = 4
ROAD_CHUNK_IDS = 750
ROAD_TILE_M = 25_000.0
ROAD_LOD_TOL = {0: 300.0, 1: 150.0, 2: 60.0, 3: 20.0}
ROAD_RAW_TYPES = ("aut", "vpd", "vpu", "vcd", "vcu", "vnc")
ROAD_LOD_TYPES = {
    0: {"aub", "auf", "vpb", "vpf"},
    1: {"aub", "auf", "vpb", "vpf", "vcb"},
    2: {"aub", "auf", "vpb", "vpf", "vcb", "vcc"},
    3: {"aub", "auf", "vpb", "vpf", "vcb", "vcc", "vcl", "vcf", "vnc"},
}
ROAD_DERIVED = set().union(*ROAD_LOD_TYPES.values())
RAIL_LOD_TOL = (250.0, 80.0, 20.0, 5.0)
CNIG_PAGE = 2000

TO_UTM = Transformer.from_crs(4326, 25831, always_xy=True).transform
TO_WGS = Transformer.from_crs(25831, 4326, always_xy=True).transform
_thread = threading.local()

TMB_COLORS = {
    "L1": "#d71920", "L2": "#8a3ab9", "L3": "#1f9d45",
    "L4": "#f3c300", "L5": "#1f77d0", "L9N": "#d98c18",
    "L9S": "#d98c18", "L10N": "#22b6ea", "L10S": "#22b6ea",
    "L11": "#8bd146", "FM": "#0a7b57",
}

ATTRIBUTIONS = [
    {
        "id": "icgc",
        "label": "ICGC · carreteres, infraestructura ferroviària i relleu",
        "short": "ICGC · CC BY 4.0",
        "text": "Carreteres i infraestructura ferroviària derivades del Referencial Topogràfic Territorial, i relleu derivat del Model d’Elevacions del Terreny de l’Institut Cartogràfic i Geològic de Catalunya (ICGC), sota CC BY 4.0.",
        "url": "https://www.icgc.cat/ca/LICGC/Informacio-publica/Transparencia/Reutilitzacio-de-la-informacio",
        "license": "CC BY 4.0",
    },
    {
        "id": "renfe",
        "label": "Renfe",
        "short": "Renfe · CC BY 4.0",
        "text": "Dades de serveis Rodalies/Cercanías de Renfe Operadora, publicades a Renfe Data sota Creative Commons Attribution 4.0.",
        "url": "https://data.renfe.com/dataset?license_id=CC-BY-4.0&res_format=GTFS",
        "license": "CC BY 4.0",
    },
    {
        "id": "fgc",
        "label": "FGC",
        "short": "Dades Obertes FGC",
        "text": "GTFS publicat al portal Dades Obertes de Ferrocarrils de la Generalitat de Catalunya (FGC).",
        "url": "https://dadesobertes.fgc.cat/explore/dataset/gtfs_zip/",
        "license": "Dades Obertes FGC; comprovar el camp de llicència vigent del dataset abans de redistribuir el ZIP original.",
    },
    {
        "id": "cnig",
        "label": "IGR-RT CNIG/IGN",
        "short": "IGR-RT 2026 · CC BY 4.0",
        "text": "Obra derivada de IGR-RT 2026 CC-BY 4.0 scne.es. Utilitzat per a alta velocitat, metro i tramvia físics.",
        "url": "https://centrodedescargas.cnig.es/CentroDescargas/buscar.do?filtro.codFamilia=REDTR",
        "license": "Llicència compatible amb CC BY 4.0",
    },
]


def sess() -> requests.Session:
    s = getattr(_thread, "session", None)
    if s is None:
        s = requests.Session()
        retry = Retry(
            total=3, connect=3, read=3, status=3, backoff_factor=.8,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET"}), respect_retry_after_header=True,
        )
        s.mount("https://", HTTPAdapter(max_retries=retry))
        s.headers.update({"User-Agent": "Ferrocat/1.0 public-data-builder"})
        _thread.session = s
    return s


def request_json(url: str, params: dict, attempts: int = MAX_ATTEMPTS) -> dict:
    last = None
    for n in range(1, attempts + 1):
        try:
            r = sess().get(url, params=params, timeout=(CONNECT_TIMEOUT, READ_TIMEOUT))
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and "error" in data:
                raise RuntimeError(str(data["error"]))
            return data
        except Exception as exc:
            last = exc
            if n == attempts:
                break
            wait = min(20.0, 1.5 ** (n - 1) + random.random())
            print(f"[retry {n}/{attempts}] {type(exc).__name__}: {exc} · {wait:.1f}s")
            time.sleep(wait)
    raise last


def atomic_json(path: Path, obj, *, indent=None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    with tmp.open("w", encoding="utf-8", newline="") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))
    os.replace(tmp, path)


def clean(v) -> str:
    return str(v or "").strip()


def norm_name(v: str) -> str:
    v = unicodedata.normalize("NFD", v or "")
    v = "".join(ch for ch in v if unicodedata.category(ch) != "Mn")
    return " ".join("".join(ch if ch.isalnum() else " " for ch in v.lower()).split())


def iter_lines(g) -> Iterator[LineString]:
    if g is None or g.is_empty:
        return
    if isinstance(g, LineString):
        yield g
    elif isinstance(g, MultiLineString):
        for x in g.geoms:
            if not x.is_empty:
                yield x
    elif isinstance(g, GeometryCollection) or hasattr(g, "geoms"):
        for x in g.geoms:
            yield from iter_lines(x)


def simplify_lods(coords: list[list[float]]) -> list[list[list[float]]]:
    if len(coords) < 2:
        return []
    try:
        line = LineString(coords).intersection(CAT_BOX)
    except Exception:
        return []
    out = []
    for part in iter_lines(line):
        metric = shapely_transform(TO_UTM, part)
        lods = []
        for tol in RAIL_LOD_TOL:
            g = metric.simplify(tol, preserve_topology=False)
            ll = shapely_transform(TO_WGS, g)
            pts = [[round(float(x), 6), round(float(y), 6)] for x, y, *_ in ll.coords]
            if len(pts) < 2:
                pts = [[round(float(x), 6), round(float(y), 6)] for x, y, *_ in part.coords]
            lods.append(pts)
        out.append(lods)
    return out




# =============================================================================
# HELPERS GENERALS / MOBILITAT
# =============================================================================

def metadata_record(
    source: str,
    source_url: str,
    license_name: str,
    attribution: str,
    **extra,
) -> dict:
    return {
        "source": source,
        "source_url": source_url,
        "license": license_name,
        "attribution": attribution,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **extra,
    }


def run_mobility() -> None:
    """
    Executa el pipeline MITMS germà que viu al mateix paquet pipelines/.
    Manté la lògica de mobilitat separada, però l'entrada normal continua sent
    PREPARAR_FERROCAT.
    """
    from pipelines import download_mobility

    print("\n=== [1/6] MOBILITAT MITMS ===")
    download_mobility.run(DATA)


# =============================================================================
# INFRAESTRUCTURA FERROVIÀRIA RTT ICGC
# =============================================================================

def rail_infrastructure_complete() -> bool:
    return (
        (RAIL / "infrastructure.runtime.json").exists()
        and (RAIL / "infrastructure.geoparquet").exists()
        and (RAIL / "infrastructure.metadata.json").exists()
    )


def fetch_rail_infrastructure(refresh: bool) -> list[dict]:
    """
    IMPORTANT: ja NO descarrega tota la layer 25 (~1,5 M features).
    Demana només tipus ferroviaris.
    """
    cache = RAW / "icgc" / "rail_infrastructure.json"
    if cache.exists() and not refresh:
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                print(f"  cache RTT ferroviari: {len(data):,} features")
                return data
        except Exception:
            pass

    values = ",".join(f"'{x}'" for x in RAIL_INFRA_TYPES)
    where = f"tipus IN ({values})"

    count = request_json(
        RAIL_INFRA_QUERY,
        {"f": "json", "where": where, "returnCountOnly": "true"},
    )
    total = int(count.get("count") or 0)
    if total <= 0:
        raise RuntimeError("RTT no retorna cap infraestructura ferroviària")

    features: list[dict] = []
    page = 1800
    for offset in range(0, total, page):
        data = request_json(
            RAIL_INFRA_QUERY,
            {
                "f": "geojson",
                "where": where,
                "outFields": (
                    "OBJECTID,tipus,entorn,estat,terreny,xarxa,codivia,nom"
                ),
                "returnGeometry": "true",
                "outSR": "4326",
                "resultOffset": offset,
                "resultRecordCount": page,
                "orderByFields": "OBJECTID",
            },
        )
        rows = data.get("features") or []
        features.extend(rows)
        print(f"  RTT ferroviari: {len(features):,}/{total:,}")

    cache.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(cache, features)
    return features


def build_rail_infrastructure_runtime(features: list[dict]) -> list[dict]:
    runtime: list[dict] = []
    for idx, feature in enumerate(features):
        props = feature.get("properties") or {}
        tipus = clean(props.get("tipus")).lower()
        if tipus not in RAIL_INFRA_TYPES:
            continue
        gj = feature.get("geometry")
        if not gj:
            continue
        try:
            geom = shape(gj)
        except Exception:
            continue

        for part_index, part in enumerate(iter_lines(geom)):
            coords = [
                [round(float(lon), 6), round(float(lat), 6)]
                for lon, lat, *_ in part.coords
            ]
            if len(coords) < 2:
                continue
            runtime.append(
                {
                    "id": f"rtt-rail-{idx}-{part_index}",
                    "tipus": tipus,
                    "nom": clean(props.get("nom")),
                    "estat": clean(props.get("estat")),
                    "xarxa": clean(props.get("xarxa")),
                    "codivia": clean(props.get("codivia")),
                    "coords": coords,
                }
            )
    return runtime


def write_rail_geoparquet(features: list[dict], path: Path) -> None:
    try:
        import geopandas as gpd
    except ImportError as exc:
        raise RuntimeError(
            "Falta geopandas. Instal·la requirements-pipeline.txt"
        ) from exc

    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".geoparquet.part")
    gdf.to_parquet(tmp, index=False)
    _replace_file_retry(tmp, path)


def prepare_rail_infrastructure(refresh: bool) -> None:
    print("\n=== [3/6] INFRAESTRUCTURA FERROVIÀRIA RTT ===")
    if rail_infrastructure_complete() and not refresh:
        print("  cache: infraestructura ferroviària ja preparada")
        return

    features = fetch_rail_infrastructure(refresh)
    runtime = build_rail_infrastructure_runtime(features)
    if not runtime:
        raise RuntimeError("Infraestructura ferroviària RTT ha quedat buida")

    RAIL.mkdir(parents=True, exist_ok=True)
    write_rail_geoparquet(features, RAIL / "infrastructure.geoparquet")
    atomic_json(RAIL / "infrastructure.runtime.json", runtime)
    atomic_json(
        RAIL / "infrastructure.metadata.json",
        metadata_record(
            "ICGC Referencial Topogràfic Territorial (RTT)",
            RAIL_INFRA_LAYER,
            "CC BY 4.0",
            "Institut Cartogràfic i Geològic de Catalunya (ICGC)",
            rail_features=len(runtime),
            output_crs="EPSG:4326",
            tipus=sorted(RAIL_INFRA_TYPES),
        ),
        indent=2,
    )
    print(f"  OK: {len(runtime):,} trams ferroviaris RTT")


# =============================================================================
# TOPOGRAFIA ICGC + CORBES + HILLSHADE
# =============================================================================

def parse_arcgrid(text: str) -> tuple[np.ndarray, dict]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    header: dict[str, float] = {}
    idx = 0
    keys = {
        "ncols", "nrows", "xllcorner", "yllcorner",
        "xllcenter", "yllcenter", "cellsize", "nodata_value",
    }
    while idx < len(lines) and len(header) < 6:
        parts = lines[idx].split()
        if len(parts) >= 2 and parts[0].lower() in keys:
            header[parts[0].lower()] = float(parts[1])
            idx += 1
        else:
            break

    ncols = int(header["ncols"])
    nrows = int(header["nrows"])
    data = np.loadtxt(lines[idx:idx+nrows], dtype=float)
    if data.shape != (nrows, ncols):
        raise RuntimeError(
            f"ArcGRID inesperat: {data.shape}, esperat {(nrows, ncols)}"
        )
    return data, header


def fetch_terrain_tile(
    bbox: tuple[float, float, float, float],
    resolution_m: float,
) -> tuple[np.ndarray, dict]:
    minx, miny, maxx, maxy = bbox
    params = {
        "SERVICE": "WCS",
        "VERSION": "1.0.0",
        "REQUEST": "GetCoverage",
        "COVERAGE": "icc:met",
        "CRS": "EPSG:25831",
        "BBOX": f"{minx},{miny},{maxx},{maxy}",
        "RESX": str(resolution_m),
        "RESY": str(resolution_m),
        "FORMAT": "ArcGrid",
    }
    response = sess().get(
        TERRAIN_WCS_URL,
        params=params,
        timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
    )
    response.raise_for_status()
    return parse_arcgrid(response.text)


def build_coarse_terrain(
    bbox: tuple[float, float, float, float],
    resolution_m: float = 500.0,
    chunk_pixels: int = 150,
) -> dict:
    minx, miny, maxx, maxy = bbox
    width = int(math.ceil((maxx-minx)/resolution_m))
    height = int(math.ceil((maxy-miny)/resolution_m))
    grid = np.full((height, width), TERRAIN_NODATA, dtype=np.int16)

    for row0 in range(0, height, chunk_pixels):
        for col0 in range(0, width, chunk_pixels):
            rows = min(chunk_pixels, height-row0)
            cols = min(chunk_pixels, width-col0)
            x0 = minx + col0*resolution_m
            x1 = min(maxx, x0 + cols*resolution_m)
            y1 = maxy - row0*resolution_m
            y0 = max(miny, y1 - rows*resolution_m)

            arr, hdr = fetch_terrain_tile(
                (x0, y0, x1, y1),
                resolution_m,
            )
            nodata = hdr.get("nodata_value", -9999.0)
            valid = np.isfinite(arr) & (arr != nodata)
            compact = np.where(
                valid,
                np.rint(arr),
                TERRAIN_NODATA,
            ).astype(np.int16)

            rr = min(rows, compact.shape[0])
            cc = min(cols, compact.shape[1])
            grid[
                row0:row0+rr,
                col0:col0+cc,
            ] = compact[:rr, :cc]

    return {
        "crs": "EPSG:25831",
        "bbox": [minx, miny, maxx, maxy],
        "resolution_m": resolution_m,
        "width": width,
        "height": height,
        "nodata": TERRAIN_NODATA,
        "values": grid.reshape(-1).astype(int).tolist(),
    }


def terrain_core_complete() -> bool:
    required = (
        TERRAIN / "terrain_manifest.json",
        TERRAIN / "terrain_tiles.parquet",
        TERRAIN / "coarse.runtime.json",
        TERRAIN / "metadata.json",
    )
    if not all(p.exists() for p in required):
        return False
    try:
        manifest = json.loads(
            (TERRAIN / "terrain_manifest.json").read_text(encoding="utf-8")
        )
        tiles = manifest.get("tiles") or []
        return bool(tiles) and all((TERRAIN / x["file"]).exists() for x in tiles)
    except Exception:
        return False


def prepare_terrain_core(
    refresh: bool,
    resolution: float,
    tile_pixels: int,
    bbox: tuple[float, float, float, float],
) -> None:
    if terrain_core_complete() and not refresh:
        print("  cache: DEM i tiles ja preparats")
        return

    out_tiles = TERRAIN / "tiles"
    if refresh and out_tiles.exists():
        shutil.rmtree(out_tiles)
    out_tiles.mkdir(parents=True, exist_ok=True)

    minx, miny, maxx, maxy = map(float, bbox)
    tile_m = resolution * tile_pixels
    nx = math.ceil((maxx-minx)/tile_m)
    ny = math.ceil((maxy-miny)/tile_m)

    manifest = {
        "crs": "EPSG:25831",
        "resolution_m": resolution,
        "tile_pixels": tile_pixels,
        "bbox": [minx, miny, maxx, maxy],
        "tiles": [],
    }

    total = nx*ny
    done = 0

    for iy in range(ny):
        for ix in range(nx):
            done += 1
            x0 = minx + ix*tile_m
            y0 = miny + iy*tile_m
            x1 = min(maxx, x0+tile_m)
            y1 = min(maxy, y0+tile_m)
            print(f"  [{done}/{total}] WCS {ix},{iy}")

            arr, hdr = fetch_terrain_tile(
                (x0, y0, x1, y1),
                resolution,
            )
            nodata = hdr.get("nodata_value", -9999.0)
            valid = np.isfinite(arr) & (arr != nodata)
            if not valid.any():
                continue

            compact = np.where(
                valid,
                np.rint(arr),
                TERRAIN_NODATA,
            ).astype("<i2")

            name = f"{ix:03d}_{iy:03d}.bin"
            target = out_tiles / name
            staged = target.with_suffix(".bin.part")
            staged.write_bytes(compact.tobytes(order="C"))
            _replace_file_retry(staged, target)

            manifest["tiles"].append(
                {
                    "x": ix,
                    "y": iy,
                    "file": f"tiles/{name}",
                    "bbox": [x0, y0, x1, y1],
                    "rows": int(compact.shape[0]),
                    "cols": int(compact.shape[1]),
                    "min_m": float(np.min(arr[valid])),
                    "max_m": float(np.max(arr[valid])),
                    "nodata": TERRAIN_NODATA,
                }
            )

    if not manifest["tiles"]:
        raise RuntimeError("El WCS ICGC no ha produït cap tile de terreny")

    TERRAIN.mkdir(parents=True, exist_ok=True)
    atomic_json(TERRAIN / "terrain_manifest.json", manifest, indent=2)

    print("  [coarse] DEM runtime de 500 m...")
    coarse = build_coarse_terrain(
        (minx, miny, maxx, maxy),
        500.0,
    )
    atomic_json(TERRAIN / "coarse.runtime.json", coarse)

    pd.DataFrame(manifest["tiles"]).to_parquet(
        TERRAIN / "terrain_tiles.parquet",
        index=False,
    )

    atomic_json(
        TERRAIN / "metadata.json",
        metadata_record(
            "ICGC Model d'Elevacions del Terreny (WCS icc:met)",
            TERRAIN_WCS_URL,
            "CC BY 4.0",
            "Institut Cartogràfic i Geològic de Catalunya (ICGC)",
            runtime_resolution_m=resolution,
            coarse_resolution_m=500.0,
            output_crs="EPSG:25831",
            tile_count=len(manifest["tiles"]),
        ),
        indent=2,
    )
    print(f"  OK: {len(manifest['tiles'])} tiles DEM")


def prepare_terrain_visuals(
    interval: int = 100,
    simplify_deg: float = 0.001,
) -> None:
    source_path = TERRAIN / "coarse.runtime.json"
    if not source_path.exists():
        raise RuntimeError("Falta data/terrain/coarse.runtime.json")

    src = json.loads(source_path.read_text(encoding="utf-8"))
    width = int(src["width"])
    height = int(src["height"])
    nodata = float(src["nodata"])
    values = np.asarray(src["values"], dtype=float).reshape(height, width)

    values[values == nodata] = np.nan
    values[values < -100] = np.nan

    bbox = [float(x) for x in src["bbox"]]
    res = float(src["resolution_m"])
    transformer = Transformer.from_crs(
        src.get("crs", "EPSG:25831"),
        "EPSG:4326",
        always_xy=True,
    )

    finite = values[np.isfinite(values)]
    if finite.size == 0:
        raise RuntimeError("El DEM coarse no conté cotes vàlides")

    max_level = (
        int(np.ceil(max(0.0, float(np.nanmax(finite))) / interval))
        * interval
    )
    contours: list[dict] = []

    for level in range(0, max_level + interval, interval):
        for raw in measure.find_contours(
            values,
            level=level,
            fully_connected="low",
        ):
            if len(raw) < 3:
                continue

            pts = []
            for row, col in raw:
                x = bbox[0] + (float(col)+0.5)*res
                y = bbox[3] - (float(row)+0.5)*res
                lon, lat = transformer.transform(x, y)
                pts.append((lon, lat))

            line = LineString(pts).simplify(
                simplify_deg,
                preserve_topology=False,
            )
            if line.is_empty or len(line.coords) < 2:
                continue

            coords = [
                [round(float(x), 5), round(float(y), 5)]
                for x, y in line.coords
            ]
            xs = [p[0] for p in coords]
            ys = [p[1] for p in coords]
            contours.append(
                {
                    "e": level,
                    "b": [min(xs), min(ys), max(xs), max(ys)],
                    "c": coords,
                }
            )

    filled = values.copy()
    finite_mask = np.isfinite(filled)
    median = float(np.nanmedian(filled)) if finite_mask.any() else 0.0
    filled[~finite_mask] = median

    smooth = filled.copy()
    for _ in range(2):
        smooth = (
            smooth*4
            + np.roll(smooth, 1, axis=0)
            + np.roll(smooth, -1, axis=0)
            + np.roll(smooth, 1, axis=1)
            + np.roll(smooth, -1, axis=1)
        ) / 8.0

    dzdy, dzdx = np.gradient(smooth, res, res)
    nx = -dzdx
    ny = dzdy
    nz = np.ones_like(smooth)
    norm = np.sqrt(nx*nx + ny*ny + nz*nz)
    nx /= norm
    ny /= norm
    nz /= norm

    azimuth = np.deg2rad(315.0)
    altitude = np.deg2rad(45.0)
    lx = np.cos(altitude) * np.sin(azimuth)
    ly = np.cos(altitude) * np.cos(azimuth)
    lz = np.sin(altitude)

    shade = nx*lx + ny*ly + nz*lz
    shade = np.clip((shade+0.35)/1.35, 0.0, 1.0)
    gray = (55 + shade*190).astype(np.uint8)

    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    rgba[..., 0] = gray
    rgba[..., 1] = gray
    rgba[..., 2] = gray
    rgba[..., 3] = np.where(finite_mask, 165, 0).astype(np.uint8)

    STATIC_TERRAIN.mkdir(parents=True, exist_ok=True)

    hillshade = STATIC_TERRAIN / "hillshade.png"
    staged_png = hillshade.with_suffix(".png.part")
    Image.fromarray(rgba, "RGBA").save(
        staged_png,
        format="PNG",
        optimize=True,
    )
    _replace_file_retry(staged_png, hillshade)

    atomic_json(
        STATIC_TERRAIN / "contours.json",
        {
            "source": "ICGC terrain coarse runtime",
            "interval_m": interval,
            "contours": contours,
        },
    )

    print(f"  corbes: {len(contours):,}")
    print(f"  hillshade: {hillshade}")


def prepare_terrain(
    refresh: bool,
    resolution: float,
    tile_pixels: int,
    bbox: tuple[float, float, float, float],
    contour_interval: int,
) -> None:
    print("\n=== [5/6] TOPOGRAFIA ICGC ===")
    prepare_terrain_core(
        refresh,
        resolution,
        tile_pixels,
        bbox,
    )
    prepare_terrain_visuals(interval=contour_interval)

    # L'optimitzador de traçat treballa sobre la mateixa graella coarse del DEM.
    # Generem aquí els condicionants ICGC perquè l'execució normal del pipeline
    # deixi Ferrocat complet: hidrografia, sòl urbanitzat i carreteres.
    from pipelines import prepare_route_constraints

    prepare_route_constraints.build(refresh=refresh)


# =============================================================================
# CONFIGURACIÓ FRONTEND / PUBLICACIÓ SEGURA
# =============================================================================

def ensure_static_serving() -> None:
    """
    Integra la lògica de tools/enable_static_serving.py.

    Streamlit només serveix ./static a /app/static si enableStaticServing=true.
    Es modifica .streamlit/config.toml sense destruir la resta de configuració.
    """
    STATIC.mkdir(parents=True, exist_ok=True)

    cfg_dir = ROOT / ".streamlit"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    cfg = cfg_dir / "config.toml"

    text = cfg.read_text(encoding="utf-8") if cfg.exists() else ""
    lines = text.splitlines()

    server_start = None
    server_end = len(lines)

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped == "[server]":
            server_start = i
            continue
        if (
            server_start is not None
            and i > server_start
            and stripped.startswith("[")
            and stripped.endswith("]")
        ):
            server_end = i
            break

    setting = "enableStaticServing = true"

    if server_start is None:
        if lines and lines[-1].strip():
            lines.append("")
        lines.extend(["[server]", setting])
    else:
        found = False
        for i in range(server_start + 1, server_end):
            stripped = lines[i].strip()
            if stripped.startswith("enableStaticServing"):
                lines[i] = setting
                found = True
                break
        if not found:
            lines.insert(server_start + 1, setting)

    new_text = "\n".join(lines).rstrip() + "\n"
    if new_text != text:
        tmp = cfg.with_suffix(".toml.part")
        tmp.write_text(new_text, encoding="utf-8")
        os.replace(tmp, cfg)
        print("  static serving: activat a .streamlit/config.toml")
    else:
        print("  static serving: ja estava activat")


def _replace_file_retry(src: Path, dst: Path, attempts: int = 12) -> None:
    """
    os.replace de fitxers amb reintents curts per Windows.
    Evita intentar renombrar/substituir directoris sencers.
    """
    last = None
    for n in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError as exc:
            last = exc
            time.sleep(min(1.5, 0.08 * (n + 1)))
        except OSError as exc:
            last = exc
            time.sleep(min(1.5, 0.08 * (n + 1)))
    raise last


def _copy_publish_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    staged = dst.with_name(dst.name + ".publish.part")
    if staged.exists():
        staged.unlink()
    shutil.copy2(src, staged)
    _replace_file_retry(staged, dst)


def road_build_is_complete(build_dir: Path) -> bool:
    manifest_path = build_dir / "manifest.json"
    overview_path = build_dir / "overview.json"

    if not manifest_path.exists() or not overview_path.exists():
        return False

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return False

    lods = manifest.get("lods") or {}
    for lod in range(4):
        info = lods.get(str(lod)) or {}
        if int(info.get("segments") or 0) <= 0:
            return False

        available = info.get("available_tiles") or []
        if not available:
            return False

        lod_dir = build_dir / f"lod{lod}"
        for name in available:
            if not (lod_dir / f"{name}.json").exists():
                return False

    return True


def publish_roads_build(build_dir: Path) -> dict:
    """
    Publicació compatible amb Windows.

    No fa:
        os.replace(directori_nou, directori_actual)

    En canvi:
      1. publica les teseles individualment;
      2. publica overview.json;
      3. publica manifest.json AL FINAL.

    Això evita WinError 5 quan Streamlit/antivirus té static/roads obert.
    Els fitxers antics sobrants no són problemàtics perquè el manifest
    conté available_tiles i és l'índex autoritatiu.
    """
    manifest_path = build_dir / "manifest.json"
    if not road_build_is_complete(build_dir):
        raise RuntimeError(
            f"Build de carreteres incomplet: {build_dir}"
        )

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    ROADS_OUT.mkdir(parents=True, exist_ok=True)

    total_tiles = 0
    for lod in range(4):
        available = (
            manifest.get("lods", {})
            .get(str(lod), {})
            .get("available_tiles", [])
        )
        for name in available:
            src = build_dir / f"lod{lod}" / f"{name}.json"
            dst = ROADS_OUT / f"lod{lod}" / f"{name}.json"
            _copy_publish_file(src, dst)
            total_tiles += 1

    _copy_publish_file(build_dir / "overview.json", ROADS_OUT / "overview.json")

    # Manifest sempre l'últim: el frontend no veu una versió nova
    # fins que totes les teseles necessàries ja són publicades.
    _copy_publish_file(manifest_path, ROADS_OUT / "manifest.json")

    print(
        f"  publicació Windows-safe: {total_tiles:,} teseles + overview + manifest"
    )

    try:
        shutil.rmtree(build_dir)
    except OSError:
        # No invalida la publicació. Si queda, es pot netejar després.
        print(f"  avís: no s'ha pogut eliminar temporal {build_dir.name}")

    return manifest


def rebuild_road_overview_from_lod0() -> int:
    """
    Substitueix la utilitat antiga PREPARAR_RENDIMIENTO.bat /
    pipelines.prepare_road_overview.

    Reconstrueix overview.json a partir de static/roads/lod0 existent,
    sense tornar a descarregar ni reconstruir carreteres.
    """
    lod0 = ROADS_OUT / "lod0"
    files = sorted(lod0.glob("*.json")) if lod0.exists() else []
    if not files:
        raise RuntimeError(
            "No hi ha teseles LOD0. Executa primer "
            "python -m pipelines.PREPARAR_FERROCAT --only roads"
        )

    target = ROADS_OUT / "overview.json"
    tmp = target.with_suffix(".json.part")
    count = 0

    with tmp.open("w", encoding="utf-8", newline="") as out:
        out.write("[")
        first = True

        for file in files:
            try:
                rows = json.loads(file.read_text(encoding="utf-8"))
            except Exception as exc:
                raise RuntimeError(f"Tesela invàlida {file}: {exc}") from exc

            if not isinstance(rows, list):
                raise RuntimeError(f"Tesela no és una llista JSON: {file}")

            for row in rows:
                if not first:
                    out.write(",")
                json.dump(
                    row,
                    out,
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                first = False
                count += 1

        out.write("]")

    _replace_file_retry(tmp, target)
    print(f"  overview regenerat: {count:,} segments LOD0")
    return count


# =============================================================================
# CARRETERES ICGC RTT layer 23
# =============================================================================

def road_class(tipus: object, xarxa: object) -> str:
    t, x = clean(tipus).lower(), clean(xarxa).lower()
    if t == "aut" and x == "vxb": return "aub"
    if t == "aut" and x == "vfc": return "auf"
    if t in {"vpd", "vpu"} and x == "vxb": return "vpb"
    if t in {"vpd", "vpu"} and x == "vfc": return "vpf"
    if t in {"vcd", "vcu"} and x == "vxb": return "vcb"
    if t in {"vcd", "vcu"} and x == "vxc": return "vcc"
    if t in {"vcd", "vcu"} and x == "vxl": return "vcl"
    if t in {"vcd", "vcu"} and x == "vfc": return "vcf"
    return t


def road_ids(raw_type: str) -> list[int]:
    d = request_json(ICGC_QUERY, {"f":"json", "where":f"tipus='{raw_type}'", "returnIdsOnly":"true"})
    return sorted(map(int, d.get("objectIds") or []))


def groups(values: list[int], n: int):
    for i in range(0, len(values), n):
        yield values[i:i+n]


def road_cache(raw_type: str, ids: list[int]) -> Path:
    digest = hashlib.sha1(",".join(map(str, ids)).encode()).hexdigest()[:12]
    return RAW / "icgc_roads" / raw_type / f"{ids[0]:010d}_{ids[-1]:010d}_{digest}.json"


def validate_road_cache(path: Path, ids: list[int]) -> dict | None:
    if not path.exists(): return None
    try: d = json.loads(path.read_text(encoding="utf-8"))
    except Exception: return None
    feats = d.get("features") if isinstance(d, dict) else None
    if not isinstance(feats, list): return None
    got = {int((f.get("properties") or {}).get("OBJECTID")) for f in feats if (f.get("properties") or {}).get("OBJECTID") is not None}
    return d if got == set(ids) else None


def fetch_road_chunk(raw_type: str, ids: list[int], out_fields: str, refresh: bool):
    path = road_cache(raw_type, ids)
    if not refresh:
        d = validate_road_cache(path, ids)
        if d is not None: return len(d["features"]), True
    path.parent.mkdir(parents=True, exist_ok=True)
    d = request_json(ICGC_QUERY, {
        "f":"geojson", "objectIds":",".join(map(str, ids)), "outFields":out_fields,
        "returnGeometry":"true", "outSR":"4326",
    })
    feats = d.get("features") or []
    got = {int((f.get("properties") or {}).get("OBJECTID")) for f in feats if (f.get("properties") or {}).get("OBJECTID") is not None}
    if got != set(ids):
        raise RuntimeError(f"Chunk ICGC incomplet {raw_type}: falten {len(set(ids)-got)} OBJECTID")
    atomic_json(path, d)
    return len(feats), False


class Writers:
    def __init__(self, limit=64): self.limit, self.handles = limit, OrderedDict()
    def write(self, path: Path, line: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        fh = self.handles.pop(path, None)
        if fh is None:
            if len(self.handles) >= self.limit:
                _, old = self.handles.popitem(last=False); old.close()
            fh = path.open("a", encoding="utf-8", newline="\n")
        self.handles[path] = fh; fh.write(line + "\n")
    def close(self):
        for fh in self.handles.values(): fh.close()
        self.handles.clear()


def ndjson_to_array(src: Path, dst: Path) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True); n=0
    with src.open("r", encoding="utf-8") as inp, dst.open("w", encoding="utf-8") as out:
        out.write("["); first=True
        for line in inp:
            line=line.strip()
            if not line: continue
            if not first: out.write(",")
            out.write(line); first=False; n+=1
        out.write("]")
    return n


def prepare_roads(refresh: bool) -> dict:
    print("\n=== [2/6] CARRETERES ICGC ===")

    tmp = ROADS_OUT.with_name("roads.build.part")

    # Si una execució anterior va arribar a construir manifest + teseles
    # però va fallar publicant el directori a Windows, no repetim hores de feina.
    if not refresh and road_build_is_complete(tmp):
        print(
            "  [resume] build complet detectat a static/roads.build.part"
        )
        print(
            "  [resume] es publica directament; no es torna a descarregar "
            "ni reconstruir"
        )
        return publish_roads_build(tmp)

    meta = request_json(ICGC_LAYER, {"f":"json"})
    fields = {f["name"] for f in meta.get("fields", [])}
    selected = [x for x in ("OBJECTID","tipus","xarxa","estat","entorn","terreny","codivia","nom") if x in fields]
    if not {"OBJECTID","tipus","xarxa"} <= set(selected):
        raise RuntimeError(f"Esquema ICGC inesperat: {sorted(fields)}")
    out_fields = ",".join(selected)

    ids_by = {t: road_ids(t) for t in ROAD_RAW_TYPES}
    for t, ids in ids_by.items(): print(f"  {t}: {len(ids):,}")
    jobs = [(t, c) for t, ids in ids_by.items() for c in groups(ids, ROAD_CHUNK_IDS)]
    if not jobs: raise RuntimeError("ICGC no retorna eixos viaris")

    with ThreadPoolExecutor(max_workers=ROAD_WORKERS) as ex:
        futs={ex.submit(fetch_road_chunk,t,ids,out_fields,refresh):(t,ids) for t,ids in jobs}
        done=0
        for fut in as_completed(futs):
            n,cached=fut.result(); done+=n
            if done % 10000 < n: print(f"  cache/download: {done:,} features")

    extent=meta["extent"]
    ox=math.floor(float(extent["xmin"])/ROAD_TILE_M)*ROAD_TILE_M
    oy=math.floor(float(extent["ymin"])/ROAD_TILE_M)*ROAD_TILE_M
    nx=int(math.ceil((float(extent["xmax"])-ox)/ROAD_TILE_M))
    ny=int(math.ceil((float(extent["ymax"])-oy)/ROAD_TILE_M))

    if tmp.exists():
        shutil.rmtree(tmp)
    nd=tmp/"_ndjson"; nd.mkdir(parents=True)
    wr=Writers(); derived=Counter(); lod_counts=Counter(); processed=0
    overview_src=nd/"overview.ndjson"
    try:
        for raw_type, ids in jobs:
            d=validate_road_cache(road_cache(raw_type, ids), ids)
            if d is None: raise RuntimeError(f"Cache ICGC invàlida {raw_type}")
            for feat in d["features"]:
                processed+=1; p=feat.get("properties") or {}; cls=road_class(p.get("tipus"),p.get("xarxa")); derived[cls]+=1
                if cls not in ROAD_DERIVED: continue
                gj=feat.get("geometry")
                if not gj: continue
                try: geom=shapely_transform(TO_UTM, shape(gj))
                except Exception: continue
                if geom.is_empty: continue
                label=clean(p.get("codivia")) or clean(p.get("nom")) or clean(p.get("xarxa"))
                for lod in range(4):
                    if cls not in ROAD_LOD_TYPES[lod]: continue
                    sg=geom.simplify(ROAD_LOD_TOL[lod], preserve_topology=False)
                    if sg.is_empty: continue
                    x0,y0,x1,y1=sg.bounds
                    tx0=max(0,int(math.floor((x0-ox)/ROAD_TILE_M))); tx1=min(nx-1,int(math.floor((x1-ox)/ROAD_TILE_M)))
                    ty0=max(0,int(math.floor((y0-oy)/ROAD_TILE_M))); ty1=min(ny-1,int(math.floor((y1-oy)/ROAD_TILE_M)))
                    for tx in range(tx0,tx1+1):
                        for ty in range(ty0,ty1+1):
                            cell=box(ox+tx*ROAD_TILE_M, oy+ty*ROAD_TILE_M, ox+(tx+1)*ROAD_TILE_M, oy+(ty+1)*ROAD_TILE_M)
                            try: clipped=sg.intersection(cell)
                            except Exception: continue
                            for part in iter_lines(clipped):
                                if len(part.coords)<2: continue
                                ll=shapely_transform(TO_WGS, part)
                                coords=[[round(float(x),6),round(float(y),6)] for x,y,*_ in ll.coords]
                                row=json.dumps({"t":cls,"n":label,"c":coords},ensure_ascii=False,separators=(",",":"))
                                wr.write(nd/f"lod{lod}"/f"{tx}_{ty}.ndjson",row); lod_counts[lod]+=1
                                if lod==0: wr.write(overview_src,row)
                if processed % 20000 == 0: print(f"  build {processed:,} · LOD {dict(lod_counts)}")
    finally: wr.close()

    final_counts={}; tiles={}
    for lod in range(4):
        src=nd/f"lod{lod}"; dst=tmp/f"lod{lod}"; dst.mkdir(parents=True,exist_ok=True); names=[]; count=0
        if src.exists():
            for f in sorted(src.glob("*.ndjson")):
                n=ndjson_to_array(f,dst/f"{f.stem}.json")
                if n: names.append(f.stem); count+=n
        tiles[lod]=names; final_counts[lod]=count
    overview_n=ndjson_to_array(overview_src,tmp/"overview.json") if overview_src.exists() else 0
    if not (tmp/"overview.json").exists(): (tmp/"overview.json").write_text("[]",encoding="utf-8")
    shutil.rmtree(nd,ignore_errors=True)

    if any(final_counts[i] <= 0 for i in range(4)):
        raise RuntimeError(f"LOD de carreteres buit: {final_counts}")
    if derived["vcc"] + derived["vcl"] <= 0:
        raise RuntimeError("No s'han classificat carreteres comarcals/locals")

    manifest={
        "version":1,"source":"ICGC RTT 230_transports_eixos_l","license":"CC BY 4.0",
        "origin_x":ox,"origin_y":oy,"tile_size_m":ROAD_TILE_M,"nx":nx,"ny":ny,
        "classes":dict(derived),
        "lods":{str(i):{"types":sorted(ROAD_LOD_TYPES[i]),"simplify_m":ROAD_LOD_TOL[i],"segments":final_counts[i],"tile_count":len(tiles[i]),"available_tiles":tiles[i]} for i in range(4)},
    }
    atomic_json(tmp/"manifest.json",manifest,indent=2)
    manifest = publish_roads_build(tmp)
    print(f"  OK: LOD0/1/2/3 = {[final_counts[i] for i in range(4)]}")
    return manifest


# =============================================================================
# GTFS helpers: RENFE RODALIES + FGC
# =============================================================================

def valid_gtfs(path: Path) -> bool:
    if not path.exists() or path.stat().st_size < 100: return False
    try:
        with zipfile.ZipFile(path) as zf:
            names={Path(n).name.lower() for n in zf.namelist()}
            return {"routes.txt","trips.txt","stops.txt","stop_times.txt"} <= names
    except Exception: return False


def download(url: str, target: Path, refresh: bool) -> Path:
    if valid_gtfs(target) and not refresh:
        print(f"  cache: {target.name}"); return target
    target.parent.mkdir(parents=True,exist_ok=True); tmp=target.with_suffix(".zip.part")
    print(f"  descarregant {url}")
    with sess().get(url,timeout=(CONNECT_TIMEOUT,READ_TIMEOUT),stream=True) as r:
        r.raise_for_status()
        with tmp.open("wb") as fh:
            for chunk in r.iter_content(1024*1024):
                if chunk: fh.write(chunk)
    if not valid_gtfs(tmp):
        tmp.unlink(missing_ok=True); raise RuntimeError(f"No és un GTFS vàlid: {url}")
    os.replace(tmp,target); return target


def gtfs_table(zf: zipfile.ZipFile, name: str) -> pd.DataFrame:
    try: raw=zf.read(name)
    except KeyError: return pd.DataFrame()
    return pd.read_csv(io.BytesIO(raw),dtype=str)


def gtfs_shapes_and_stations(path: Path, agency: str, dataset: str, *, allow_stop_fallback: bool, route_filter=None):
    with zipfile.ZipFile(path) as zf:
        routes=gtfs_table(zf,"routes.txt"); trips=gtfs_table(zf,"trips.txt"); shapes=gtfs_table(zf,"shapes.txt"); stops=gtfs_table(zf,"stops.txt"); times=gtfs_table(zf,"stop_times.txt")
    if routes.empty or trips.empty: raise RuntimeError(f"{dataset}: GTFS sense routes/trips")
    for c in ("route_short_name","route_long_name","route_color","route_type"):
        if c not in routes: routes[c]=""
    routes["route_id"]=routes["route_id"].fillna("").str.strip()
    if route_filter is not None:
        routes=routes[routes.apply(route_filter,axis=1)].copy()
    route_ids=set(routes["route_id"])
    trips=trips[trips["route_id"].fillna("").str.strip().isin(route_ids)].copy()
    route_map=routes.drop_duplicates("route_id").set_index("route_id").to_dict("index")

    services=[]; mapped=set(); shape_to_routes=defaultdict(set)
    if "shape_id" in trips:
        for r in trips[["route_id","shape_id"]].fillna("").itertuples(index=False):
            rid, sid=str(r.route_id).strip(),str(r.shape_id).strip()
            if rid and sid: shape_to_routes[sid].add(rid)
    if not shapes.empty and {"shape_id","shape_pt_lat","shape_pt_lon","shape_pt_sequence"} <= set(shapes.columns):
        sh=shapes.copy(); sh["shape_id"]=sh["shape_id"].fillna("").str.strip()
        for c in ("shape_pt_lat","shape_pt_lon","shape_pt_sequence"): sh[c]=pd.to_numeric(sh[c],errors="coerce")
        sh=sh.dropna(subset=["shape_pt_lat","shape_pt_lon","shape_pt_sequence"])
        for sid,pts in sh.groupby("shape_id",sort=False):
            pts=pts.sort_values("shape_pt_sequence")
            coords=[[float(x),float(y)] for x,y in zip(pts["shape_pt_lon"],pts["shape_pt_lat"])]
            lod_parts=simplify_lods(coords)
            if not lod_parts: continue
            rids=shape_to_routes.get(str(sid)) or {""}
            for rid in rids:
                info=route_map.get(rid,{})
                short=clean(info.get("route_short_name")); longn=clean(info.get("route_long_name")); color=clean(info.get("route_color")).lstrip("#")
                color="#"+color if len(color)==6 else ("#f28c00" if agency=="renfe" else "#2a9d8f")
                for pi,lods in enumerate(lod_parts):
                    services.append({"id":f"{dataset}:{rid or sid}:{pi}","agency":agency,"dataset":dataset,"operator":"Renfe" if agency=="renfe" else "FGC","route_id":rid,"route_short_name":short,"route_long_name":longn,"name":short or longn or rid or sid,"color":color,"mode":"heavy_rail","min_zoom":0,"geometry_source":"gtfs_shape","lods":lods})
                if rid: mapped.add(rid)

    # Estacions/parades actives del feed.
    stations=[]
    used_stops=set(times["stop_id"].dropna().astype(str)) if not times.empty and "stop_id" in times else set()
    if not stops.empty and {"stop_id","stop_name","stop_lat","stop_lon"} <= set(stops.columns):
        for row in stops.itertuples(index=False):
            sid=str(getattr(row,"stop_id","")).strip()
            if used_stops and sid not in used_stops: continue
            try: lat=float(getattr(row,"stop_lat")); lon=float(getattr(row,"stop_lon"))
            except Exception: continue
            if not (CAT_BBOX[0] <= lon <= CAT_BBOX[2] and CAT_BBOX[1] <= lat <= CAT_BBOX[3]): continue
            stations.append({"raw_id":f"{dataset}:{sid}","name":str(getattr(row,"stop_name",sid)),"lon":round(lon,6),"lat":round(lat,6),"agency":agency,"dataset":dataset,"modes":["heavy_rail"],"location_type":0,"reusable_heavy_rail":True,"children":[]})

    if allow_stop_fallback and not times.empty and {"trip_id","stop_id","stop_sequence"} <= set(times.columns):
        # Manté el comportament antic de Rodalies només per rutes sense shape.
        stop_xy={x["raw_id"].split(":",1)[1]:(x["lon"],x["lat"]) for x in stations}
        tr=trips[["trip_id","route_id"]].fillna("").copy(); trip_route=dict(zip(tr["trip_id"],tr["route_id"]))
        candidate=set(tr.groupby("route_id",sort=False)["trip_id"].head(24))
        tt=times[times["trip_id"].isin(candidate)][["trip_id","stop_id","stop_sequence"]].copy(); tt["stop_sequence"]=pd.to_numeric(tt["stop_sequence"],errors="coerce"); tt=tt.dropna(subset=["stop_sequence"])
        best={}
        for tid,g in tt.groupby("trip_id",sort=False):
            rid=trip_route.get(tid)
            if not rid or rid in mapped: continue
            coords=[]
            for r in g.sort_values("stop_sequence").itertuples(index=False):
                p=stop_xy.get(str(r.stop_id))
                if p: coords.append([p[0],p[1]])
            if len(coords)>=2 and len(coords)>len(best.get(rid,[])): best[rid]=coords
        for rid,coords in best.items():
            info=route_map.get(rid,{}); short=clean(info.get("route_short_name")); longn=clean(info.get("route_long_name"))
            services.append({"id":f"{dataset}:{rid}:stops","agency":agency,"dataset":dataset,"operator":"Renfe","route_id":rid,"route_short_name":short,"route_long_name":longn,"name":short or longn or rid,"color":"#f28c00","mode":"heavy_rail","min_zoom":0,"geometry_source":"stop_sequence_fallback","coords":coords})

    return services,stations


def fgc_filter(row) -> bool:
    try: rt=int(str(row.get("route_type") or "-1"))
    except Exception: rt=-1
    return rt != 3  # exclou bus ordinari; conserva tren, cremallera i funicular.


# =============================================================================
# CNIG: AV UIC + METRO + TRAM físics
# =============================================================================

def arcgis_all(url: str, where: str, fields: str, cache_name: str, refresh: bool) -> list[dict]:
    cache=RAW/"cnig"/f"{cache_name}.json"
    if cache.exists() and not refresh:
        try:
            d=json.loads(cache.read_text(encoding="utf-8"));
            if isinstance(d,list): print(f"  cache CNIG {cache_name}: {len(d):,}"); return d
        except Exception: pass
    count=request_json(url,{"f":"json","where":where,"returnCountOnly":"true"}); total=int(count.get("count") or 0); feats=[]
    for off in range(0,total,CNIG_PAGE):
        d=request_json(url,{"f":"geojson","where":where,"outFields":fields,"returnGeometry":"true","outSR":"4326","resultOffset":off,"resultRecordCount":CNIG_PAGE,"orderByFields":"OBJECTID"})
        feats.extend(d.get("features") or []); print(f"  CNIG {cache_name}: {len(feats):,}/{total:,}")
    atomic_json(cache,feats); return feats


def route_code(name: str, default: str) -> str:
    text=clean(name).upper()
    import re
    m=re.search(r"\b(L(?:1|2|3|4|5|9N|9S|10N|10S|11)|FM|T[1-6])\b",text)
    return m.group(1) if m else default


def cnig_lines(features: list[dict], agency: str, dataset: str, mode: str, default_code: str, color: str, min_zoom: float):
    by=defaultdict(list); props={}
    for f in features:
        p=f.get("properties") or {}; gj=f.get("geometry")
        if not gj: continue
        try:g=shape(gj)
        except Exception: continue
        lid=clean(p.get("id_lineafc")) or clean(p.get("OBJECTID"))
        if not lid: continue
        by[lid].append(g); props.setdefault(lid,p)
    out=[]
    for lid,gs in by.items():
        try: merged=linemerge(unary_union(gs))
        except Exception: merged=unary_union(gs)
        name=clean(props[lid].get("Nom_lineafc")) or default_code
        code=route_code(name,default_code)
        c=TMB_COLORS.get(code,color) if agency=="tmb" else color
        for pi,part in enumerate(iter_lines(merged)):
            coords=[[float(x),float(y)] for x,y,*_ in part.coords]
            for pj,lods in enumerate(simplify_lods(coords)):
                out.append({"id":f"{dataset}:{lid}:{pi}:{pj}","agency":agency,"dataset":dataset,"operator":"TMB / IGR-RT" if agency=="tmb" else ("TRAM / IGR-RT" if agency=="tram" else "Renfe / IGR-RT"),"route_id":lid,"route_short_name":code,"route_long_name":name,"name":code if code!=default_code else name,"color":c,"mode":mode,"min_zoom":min_zoom,"geometry_source":"CNIG_IGR_RT","lods":lods})
    return out


def cnig_stations(features: list[dict], agency: str, dataset: str, mode: str):
    out=[]
    for f in features:
        p=f.get("properties") or {}; gj=f.get("geometry")
        if not gj:continue
        try:g=shape(gj);lon=float(g.x);lat=float(g.y)
        except Exception:continue
        if not(CAT_BBOX[0]<=lon<=CAT_BBOX[2] and CAT_BBOX[1]<=lat<=CAT_BBOX[3]):continue
        sid=clean(p.get("Cod_est")) or clean(p.get("OBJECTID")) or str(len(out)+1); name=clean(p.get("Nombre")) or sid
        out.append({"raw_id":f"{dataset}:{sid}","name":name,"lon":round(lon,6),"lat":round(lat,6),"agency":agency,"dataset":dataset,"modes":[mode],"location_type":1,"reusable_heavy_rail":False,"children":[]})
    return out


def prepare_cnig(refresh: bool):
    print("\n--- AV + METRO + TRAM · IGR-RT CNIG ---")
    av=arcgis_all(CNIG_UIC,"AnchoVia='UIC' AND TipoLinea='Tren' AND EstadoFis='En servicio'","OBJECTID,Provincia,id_lineafc,Nom_lineafc,AnchoVia,EstadoFis,TipoLinea,Titular,Fuente","av_uic",refresh)
    metro=arcgis_all(CNIG_LINE_TYPE,"TipoLinea='Metro' AND EstadoFis='En servicio' AND Provincia='Barcelona'","OBJECTID,Provincia,TipoLinea,id_lineafc,Nom_lineafc,EstadoFis,Titular,Fuente","metro_barcelona",refresh)
    tram=arcgis_all(CNIG_LINE_TYPE,"TipoLinea='Tranvía' AND EstadoFis='En servicio' AND Provincia='Barcelona'","OBJECTID,Provincia,TipoLinea,id_lineafc,Nom_lineafc,EstadoFis,Titular,Fuente","tram_barcelona",refresh)
    metro_st=arcgis_all(CNIG_STATIONS,"TipoEst='Estación de metro' AND Provincia='Barcelona' AND Estadofis='En servicio'","OBJECTID,Cod_est,Nombre,TipoEst,Provincia,Estadofis","metro_stations",refresh)
    tram_st=arcgis_all(CNIG_STATIONS,"TipoEst='Parada de tranvía, tren o metro ligero, funicular o tren cremallera' AND Provincia='Barcelona' AND Estadofis='En servicio'","OBJECTID,Cod_est,Nombre,TipoEst,Provincia,Estadofis","tram_stations",refresh)
    av_s=cnig_lines(av,"renfe","renfe_av_igr_rt","heavy_rail","AVE","#b07ad9",0)
    tmb_s=cnig_lines(metro,"tmb","cnig_igr_rt_metro_barcelona","metro","METRO","#d71920",3.0)
    tram_s=cnig_lines(tram,"tram","cnig_igr_rt_tram_barcelona","tram","TRAM","#159b59",3.8)
    st=cnig_stations(metro_st,"tmb","cnig_igr_rt_metro_barcelona","metro")+cnig_stations(tram_st,"tram","cnig_igr_rt_tram_barcelona","tram")
    if not av_s: raise RuntimeError("IGR-RT no ha produït cap via UIC/AV")
    if not tmb_s: raise RuntimeError("IGR-RT no ha produït cap geometria de Metro")
    if not tram_s: raise RuntimeError("IGR-RT no ha produït cap geometria de Tramvia")
    print(f"  AV={len(av_s):,} · Metro={len(tmb_s):,} · TRAM={len(tram_s):,}")
    return av_s+tmb_s+tram_s,st


# =============================================================================
# Estacions i sortida ferroviària
# =============================================================================

def hav(a,b):
    r=6371.0088; p1=math.radians(a["lat"]);p2=math.radians(b["lat"]);dp=math.radians(b["lat"]-a["lat"]);dl=math.radians(b["lon"]-a["lon"])
    q=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.asin(math.sqrt(q))


def merge_stations(rows: list[dict]) -> list[dict]:
    out=[]
    for row in rows:
        best=None;bd=1e9
        for i,x in enumerate(out):
            d=hav(row,x)
            if d<=.045 or (d<=.16 and norm_name(row["name"])==norm_name(x["name"])):
                if d<bd:best=i;bd=d
        if best is None:
            out.append({"id":f"station-{len(out)+1}","name":row["name"],"lon":row["lon"],"lat":row["lat"],"operators":[row["agency"]],"datasets":[row["dataset"]],"modes":list(row["modes"]),"reusable_heavy_rail":bool(row["reusable_heavy_rail"]),"raw_ids":[row["raw_id"]]})
        else:
            x=out[best];x["operators"]=sorted(set(x["operators"])|{row["agency"]});x["datasets"]=sorted(set(x["datasets"])|{row["dataset"]});x["modes"]=sorted(set(x["modes"])|set(row["modes"]));x["reusable_heavy_rail"]|=bool(row["reusable_heavy_rail"]);x["raw_ids"].append(row["raw_id"])
    return out


def prepare_rail(refresh: bool):
    print("\n=== [4/6] SERVEIS · RENFE RODALIES ===")
    renfe=download(RENFE_CER,RAW/"gtfs"/"renfe_cercanias.zip",refresh)
    renfe_s,renfe_st=gtfs_shapes_and_stations(renfe,"renfe","renfe_cercanias_legacy",allow_stop_fallback=True)
    if not renfe_s: raise RuntimeError("Rodalies ha quedat a 0")
    print(f"  Rodalies: {len(renfe_s):,} geometries")

    print("\n--- FGC ---")
    fgc=download(FGC_GTFS,RAW/"gtfs"/"fgc.zip",refresh)
    fgc_s,fgc_st=gtfs_shapes_and_stations(fgc,"fgc","fgc",allow_stop_fallback=False,route_filter=fgc_filter)
    if not fgc_s: raise RuntimeError("FGC ha quedat a 0")
    print(f"  FGC: {len(fgc_s):,} geometries")

    cnig_s,cnig_st=prepare_cnig(refresh)
    services=renfe_s+fgc_s+cnig_s
    stations=merge_stations(renfe_st+fgc_st+cnig_st)

    counts=Counter(x["agency"] for x in services)
    datasets=Counter(x["dataset"] for x in services)
    if any(counts[k]<=0 for k in ("renfe","fgc","tmb","tram")):
        raise RuntimeError(f"Runtime incomplet: {dict(counts)}")

    RAIL.mkdir(parents=True,exist_ok=True)
    atomic_json(RAIL/"services.runtime.json",services)
    atomic_json(RAIL/"stations.runtime.json",stations)
    atomic_json(RAIL/"services.metadata.json",{
        "generated_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
        "services_by_agency":dict(counts),"services_by_dataset":dict(datasets),"stations":len(stations),
        "sources":ATTRIBUTIONS,
        "public_mode":True,
        "note":"Metro i TRAM provenen d'IGR-RT CNIG/IGN, no dels feeds TMB/TRAM, per evitar condicions de reutilització específiques en una publicació oberta.",
    },indent=2)
    print(f"  Runtime: {dict(counts)} · estacions={len(stations):,}")


# =============================================================================
# Atribucions visibles
# =============================================================================

def write_attributions():
    print("\n=== [6/6] ATRIBUCIONS ===")
    obj={
        "generated_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
        "items":ATTRIBUTIONS,
        "osm":{
            "short":"© OpenStreetMap contributors · ODbL",
            "url":"https://www.openstreetmap.org/copyright",
        },
    }
    atomic_json(DATA/"attributions.json",obj,indent=2)
    print("  data/attributions.json")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Pipeline únic de Ferrocat: mobilitat, carreteres, "
            "infraestructura ferroviària, serveis i topografia"
        )
    )
    ap.add_argument(
        "--refresh",
        action="store_true",
        help="Força redescàrrega/reconstrucció de fonts cachejades",
    )
    ap.add_argument(
        "--skip-mobility",
        action="store_true",
        help="No actualitza MITMS",
    )
    ap.add_argument(
        "--skip-roads",
        action="store_true",
        help="No reconstrueix carreteres",
    )
    ap.add_argument(
        "--skip-infrastructure",
        action="store_true",
        help="No actualitza infraestructura ferroviària RTT",
    )
    ap.add_argument(
        "--skip-services",
        action="store_true",
        help="No actualitza Rodalies/FGC/AV/Metro/TRAM",
    )
    ap.add_argument(
        "--skip-terrain",
        action="store_true",
        help="No actualitza topografia",
    )
    ap.add_argument(
        "--only",
        choices=(
            "mobility",
            "roads",
            "infrastructure",
            "services",
            "terrain",
            "overview",
        ),
        help="Executa només un bloc concret",
    )
    ap.add_argument(
        "--terrain-resolution",
        type=float,
        default=100.0,
        help="Resolució dels tiles DEM en metres (default: 100)",
    )
    ap.add_argument(
        "--terrain-tile-pixels",
        type=int,
        default=160,
        help="Píxels màxims per petició WCS (default: 160)",
    )
    ap.add_argument(
        "--terrain-bbox",
        nargs=4,
        type=float,
        default=DEFAULT_TERRAIN_BBOX,
        metavar=("MINX", "MINY", "MAXX", "MAXY"),
    )
    ap.add_argument(
        "--contour-interval",
        type=int,
        default=100,
        help="Interval de corbes de nivell en metres",
    )
    args = ap.parse_args()

    print("="*78)
    print("FERROCAT · PIPELINE ÚNIC · MODE PUBLICACIÓ")
    print(
        "MITMS + carreteres + RTT ferroviari + Rodalies/FGC/AV/Metro/TRAM "
        "+ topografia"
    )
    print("="*78)

    print("\n=== [0/6] CONFIGURACIÓ STREAMLIT ===")
    ensure_static_serving()

    if args.only == "overview":
        rebuild_road_overview_from_lod0()
        write_attributions()
        print("\nOK. Overview regenerat.")
        return 0

    selected = args.only

    if selected in (None, "mobility") and not args.skip_mobility:
        run_mobility()

    if selected in (None, "roads") and not args.skip_roads:
        prepare_roads(args.refresh)

    if (
        selected in (None, "infrastructure")
        and not args.skip_infrastructure
    ):
        prepare_rail_infrastructure(args.refresh)

    if selected in (None, "services") and not args.skip_services:
        prepare_rail(args.refresh)

    if selected in (None, "terrain") and not args.skip_terrain:
        prepare_terrain(
            args.refresh,
            args.terrain_resolution,
            args.terrain_tile_pixels,
            tuple(map(float, args.terrain_bbox)),
            args.contour_interval,
        )

    write_attributions()

    print("\n"+"="*78)
    print("OK. Pipeline completat.")
    print("Reinicia Streamlit: python -m streamlit run app.py")
    print("="*78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
