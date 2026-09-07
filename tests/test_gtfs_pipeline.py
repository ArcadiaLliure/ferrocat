from __future__ import annotations

import io
import zipfile
from pathlib import Path

from pipelines.download_rail_services import parse_gtfs


def test_route_name_comes_from_gtfs(tmp_path: Path) -> None:
    p=tmp_path/'gtfs.zip'
    with zipfile.ZipFile(p,'w') as z:
        z.writestr('routes.txt','route_id,route_short_name,route_long_name,route_color\nr1,RL3,Lleida - Cervera,ff0000\n')
        z.writestr('trips.txt','route_id,service_id,trip_id,shape_id\nr1,s,t,sh1\n')
        z.writestr('shapes.txt','shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nsh1,41.6,0.6,1\nsh1,41.7,0.7,2\n')
    routes,runtime,stats=parse_gtfs(p,'renfe')
    assert routes.iloc[0]['display_name']=='RL3'
    assert runtime[0]['name']=='RL3'
    assert runtime[0]['color']=='#ff0000'
