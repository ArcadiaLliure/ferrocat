from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import pandas as pd

from pipelines.common import metadata, session, write_json_atomic

WCS_URL = "https://geoserveis.icgc.cat/icc_mdt/wcs/service"
# Catalunya approximate ETRS89 / UTM 31N extent, padded. The pipeline clips
# empty/no-data tiles rather than assuming every tile contains Catalan land.
DEFAULT_BBOX = (255000.0, 4485000.0, 530000.0, 4755000.0)


def _parse_arcgrid(text: str) -> tuple[np.ndarray, dict]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    header: dict[str, float] = {}
    idx = 0
    while idx < len(lines) and len(header) < 6:
        parts = lines[idx].split()
        if len(parts) >= 2 and parts[0].lower() in {"ncols","nrows","xllcorner","yllcorner","xllcenter","yllcenter","cellsize","nodata_value"}:
            header[parts[0].lower()] = float(parts[1]); idx += 1
        else:
            break
    ncols = int(header["ncols"]); nrows = int(header["nrows"])
    data = np.loadtxt(lines[idx:idx+nrows], dtype=float)
    if data.shape != (nrows, ncols):
        raise RuntimeError(f"ArcGRID inesperat: {data.shape}, esperat {(nrows,ncols)}")
    return data, header


def fetch_tile(bbox: tuple[float,float,float,float], resolution_m: float) -> tuple[np.ndarray, dict]:
    minx,miny,maxx,maxy = bbox
    params = {
        "SERVICE":"WCS", "VERSION":"1.0.0", "REQUEST":"GetCoverage",
        "COVERAGE":"icc:met", "CRS":"EPSG:25831", "BBOX":f"{minx},{miny},{maxx},{maxy}",
        "RESX":str(resolution_m), "RESY":str(resolution_m), "FORMAT":"ArcGrid",
    }
    r = session().get(WCS_URL, params=params, timeout=(20,180))
    r.raise_for_status()
    return _parse_arcgrid(r.text)



def build_coarse_runtime(bbox: tuple[float,float,float,float], resolution_m: float = 500.0, chunk_pixels: int = 150) -> dict:
    minx,miny,maxx,maxy = bbox
    width = int(math.ceil((maxx-minx)/resolution_m))
    height = int(math.ceil((maxy-miny)/resolution_m))
    grid = np.full((height, width), -32768, dtype=np.int16)
    for row0 in range(0, height, chunk_pixels):
        for col0 in range(0, width, chunk_pixels):
            rows=min(chunk_pixels,height-row0); cols=min(chunk_pixels,width-col0)
            x0=minx+col0*resolution_m; x1=min(maxx,x0+cols*resolution_m)
            # ArcGrid rows are north->south, while our runtime grid is also stored north->south.
            y1=maxy-row0*resolution_m; y0=max(miny,y1-rows*resolution_m)
            arr,hdr=fetch_tile((x0,y0,x1,y1),resolution_m)
            nodata=hdr.get("nodata_value",-9999.0)
            valid=np.isfinite(arr)&(arr!=nodata)
            compact=np.where(valid,np.rint(arr),-32768).astype(np.int16)
            rr=min(rows,compact.shape[0]); cc=min(cols,compact.shape[1])
            grid[row0:row0+rr,col0:col0+cc]=compact[:rr,:cc]
    return {
        "crs":"EPSG:25831","bbox":[minx,miny,maxx,maxy],"resolution_m":resolution_m,
        "width":width,"height":height,"nodata":-32768,"values":grid.reshape(-1).astype(int).tolist(),
    }

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("data/terrain"))
    ap.add_argument("--resolution", type=float, default=100.0, help="Resolució runtime en metres")
    ap.add_argument("--tile-pixels", type=int, default=160, help="WCS limita el nombre de píxels per petició")
    ap.add_argument("--bbox", nargs=4, type=float, default=DEFAULT_BBOX)
    args = ap.parse_args()
    out_tiles = args.out / "tiles"; out_tiles.mkdir(parents=True, exist_ok=True)
    minx,miny,maxx,maxy = map(float,args.bbox)
    tile_m = args.resolution * args.tile_pixels
    nx = math.ceil((maxx-minx)/tile_m); ny = math.ceil((maxy-miny)/tile_m)
    manifest = {"crs":"EPSG:25831", "resolution_m":args.resolution, "tile_pixels":args.tile_pixels, "bbox":[minx,miny,maxx,maxy], "tiles":[]}
    total = nx*ny; done = 0
    for iy in range(ny):
        for ix in range(nx):
            done += 1
            x0=minx+ix*tile_m; y0=miny+iy*tile_m; x1=min(maxx,x0+tile_m); y1=min(maxy,y0+tile_m)
            print(f"[{done}/{total}] WCS {ix},{iy}")
            arr, hdr = fetch_tile((x0,y0,x1,y1), args.resolution)
            nodata = hdr.get("nodata_value", -9999.0)
            valid = np.isfinite(arr) & (arr != nodata)
            if not valid.any():
                continue
            # Compact signed 16-bit metres. Catalunya fits comfortably.
            compact = np.where(valid, np.rint(arr), -32768).astype("<i2")
            name=f"{ix:03d}_{iy:03d}.bin"
            (out_tiles/name).write_bytes(compact.tobytes(order="C"))
            manifest["tiles"].append({
                "x":ix,"y":iy,"file":f"tiles/{name}","bbox":[x0,y0,x1,y1],
                "rows":int(compact.shape[0]),"cols":int(compact.shape[1]),
                "min_m":float(np.min(arr[valid])),"max_m":float(np.max(arr[valid])),
                "nodata":-32768,
            })
    write_json_atomic(args.out/"terrain_manifest.json", manifest)
    print("[coarse] Construint DEM runtime de 500 m per a anàlisi interactiva...")
    coarse=build_coarse_runtime((minx,miny,maxx,maxy),500.0)
    write_json_atomic(args.out/"coarse.runtime.json",coarse)
    write_json_atomic(args.out/"metadata.json", metadata(
        "ICGC Model d'Elevacions del Terreny (WCS icc:met)", WCS_URL,
        "CC BY 4.0", "Institut Cartogràfic i Geològic de Catalunya (ICGC)",
        runtime_resolution_m=args.resolution, output_crs="EPSG:25831", tile_count=len(manifest["tiles"]),
    ))
    # Tiny tile index is convenient to inspect without opening binaries.
    pd.DataFrame(manifest["tiles"]).to_parquet(args.out/"terrain_tiles.parquet", index=False)
    print(f"OK: {len(manifest['tiles'])} tiles")


if __name__ == "__main__":
    main()
