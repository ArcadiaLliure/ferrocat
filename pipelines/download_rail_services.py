from __future__ import annotations

import argparse
import io
import zipfile
from pathlib import Path

import pandas as pd

from pipelines.common import download_atomic, metadata, write_json_atomic

RENFE_GTFS = "https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip"
FGC_GTFS = "https://www.fgc.cat/google/google_transit.zip"

SOURCES = {
    "renfe": {
        "url": RENFE_GTFS,
        "hosts": {"ssl.renfe.com"},
        "license": "CC BY 4.0",
        "attribution": "Renfe Operadora",
    },
    "fgc": {
        "url": FGC_GTFS,
        "hosts": {"www.fgc.cat", "fgc.cat"},
        "license": "Verificar al portal Dades Obertes FGC abans de redistribuir",
        "attribution": "Ferrocarrils de la Generalitat de Catalunya (FGC)",
    },
}


def _read_gtfs_table(zf: zipfile.ZipFile, name: str) -> pd.DataFrame:
    try:
        raw = zf.read(name)
    except KeyError:
        return pd.DataFrame()
    return pd.read_csv(io.BytesIO(raw), dtype=str)


def parse_gtfs(path: Path, agency_key: str) -> tuple[pd.DataFrame, list[dict], dict]:
    with zipfile.ZipFile(path) as zf:
        routes = _read_gtfs_table(zf, "routes.txt")
        trips = _read_gtfs_table(zf, "trips.txt")
        shapes = _read_gtfs_table(zf, "shapes.txt")
        stops = _read_gtfs_table(zf, "stops.txt")
        stop_times = _read_gtfs_table(zf, "stop_times.txt")

    if routes.empty or trips.empty:
        raise RuntimeError(f"GTFS {agency_key}: falten routes.txt o trips.txt")

    routes = routes.copy()
    routes["agency_key"] = agency_key
    for col in ["route_short_name", "route_long_name", "route_color", "route_text_color"]:
        if col not in routes:
            routes[col] = ""
    routes["display_name"] = routes["route_short_name"].fillna("").where(
        routes["route_short_name"].fillna("").str.strip().ne(""), routes["route_long_name"].fillna("")
    )

    runtime: list[dict] = []
    if not shapes.empty and {"shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"}.issubset(shapes.columns):
        sh = shapes.copy()
        sh["shape_pt_sequence"] = pd.to_numeric(sh["shape_pt_sequence"], errors="coerce")
        sh["shape_pt_lat"] = pd.to_numeric(sh["shape_pt_lat"], errors="coerce")
        sh["shape_pt_lon"] = pd.to_numeric(sh["shape_pt_lon"], errors="coerce")
        sh = sh.dropna(subset=["shape_pt_sequence", "shape_pt_lat", "shape_pt_lon"])
        trip_shape = trips[["route_id", "shape_id"]].dropna().drop_duplicates() if "shape_id" in trips else pd.DataFrame()
        route_map = routes.set_index("route_id").to_dict("index")
        if not trip_shape.empty:
            for (route_id, shape_id), _ in trip_shape.groupby(["route_id", "shape_id"]):
                pts = sh[sh["shape_id"] == shape_id].sort_values("shape_pt_sequence")
                if len(pts) < 2:
                    continue
                info = route_map.get(route_id, {})
                runtime.append({
                    "id": f"{agency_key}:{route_id}:{shape_id}",
                    "route_id": f"{agency_key}:{route_id}",
                    "name": str(info.get("display_name") or route_id),
                    "long_name": str(info.get("route_long_name") or ""),
                    "color": "#" + str(info.get("route_color") or "4a90e2").lstrip("#"),
                    "text_color": "#" + str(info.get("route_text_color") or "ffffff").lstrip("#"),
                    "agency": agency_key,
                    "shape_id": str(shape_id),
                    "coords": [[round(float(r.shape_pt_lon), 6), round(float(r.shape_pt_lat), 6)] for r in pts.itertuples(index=False)],
                })

    stats = {
        "routes": int(len(routes)),
        "trips": int(len(trips)),
        "shapes": int(shapes["shape_id"].nunique()) if "shape_id" in shapes else 0,
        "stops": int(len(stops)),
        "stop_times": int(len(stop_times)),
    }
    return routes, runtime, stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("data/rail"))
    ap.add_argument("--raw", type=Path, default=Path("data/raw/gtfs"))
    ap.add_argument("--skip-fgc", action="store_true", help="No descarrega FGC si la redistribució no s'ha verificat")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    all_routes: list[pd.DataFrame] = []
    runtime: list[dict] = []
    source_meta: list[dict] = []
    for key, cfg in SOURCES.items():
        if key == "fgc" and args.skip_fgc:
            continue
        print(f"[{key}] descarregant GTFS...")
        zip_path = download_atomic(cfg["url"], args.raw / f"{key}.zip", allowed_hosts=cfg["hosts"], max_bytes=250*1024**2)
        routes, shapes, stats = parse_gtfs(zip_path, key)
        all_routes.append(routes)
        runtime.extend(shapes)
        source_meta.append(metadata(key.upper(), cfg["url"], cfg["license"], cfg["attribution"], **stats))
    if not all_routes:
        raise RuntimeError("No s'ha processat cap GTFS")
    routes = pd.concat(all_routes, ignore_index=True, sort=False)
    routes.to_parquet(args.out / "services.parquet", index=False)
    write_json_atomic(args.out / "services.runtime.json", runtime)
    write_json_atomic(args.out / "services.metadata.json", {"sources": source_meta, "runtime_shapes": len(runtime)})
    print(f"OK: {len(routes):,} rutes; {len(runtime):,} shapes runtime")


if __name__ == "__main__":
    main()
