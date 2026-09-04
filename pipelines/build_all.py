from __future__ import annotations

import argparse
import subprocess
import sys


def run(module: str, *args: str) -> None:
    cmd = [sys.executable, "-m", module, *args]
    print("\n>>", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="Construeix tots els datasets offline de Ferrocat")
    ap.add_argument("--skip-mobility", action="store_true")
    ap.add_argument("--skip-terrain", action="store_true")
    ap.add_argument("--skip-fgc", action="store_true")
    args = ap.parse_args()
    if not args.skip_mobility:
        # download_mobility remains the authoritative MITMS pipeline at repo root.
        print("\n>>", sys.executable, "download_mobility.py")
        subprocess.run([sys.executable, "download_mobility.py"], check=True)
    run("pipelines.download_rail_infrastructure")
    gtfs_args = ("--skip-fgc",) if args.skip_fgc else ()
    run("pipelines.download_rail_services", *gtfs_args)
    if not args.skip_terrain:
        run("pipelines.download_terrain")
    print("\nFerrocat datasets preparats.")


if __name__ == "__main__":
    main()
