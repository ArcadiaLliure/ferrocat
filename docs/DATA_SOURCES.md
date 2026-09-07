# Data sources

## Mobility
MITMS municipal OD (`Viajes_municipios`), processed by the existing `download_mobility.py`. Population remains a territorial/catchment attribute; it does not generate demand.

## Physical railway and roads
ICGC **Referencial Topogràfic Territorial (RTT)**, ArcGIS REST layer `250_transports_l`. The pipeline requests GeoJSON in EPSG:4326, separates known rail type codes (`ave`, `fvc`, `fer`, `cre`, `tra`, `met`, `fun`, `prj`) and writes GeoParquet plus compact runtime JSON. RTT is published by ICGC under CC BY 4.0; verify current terms before redistribution.

## Real services
- Renfe Cercanías/Rodalies official GTFS: `https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip` (catalogued by Renfe Data as CC BY 4.0).
- FGC official static GTFS: `https://www.fgc.cat/google/google_transit.zip`. The pipeline records a warning to verify the current FGC open-data licence before redistributing derived files.

Service names and colours come from GTFS fields (`route_short_name`, `route_long_name`, `route_color`), never from a hard-coded RL/R list.

## Terrain
ICGC elevation WCS `https://geoserveis.icgc.cat/icc_mdt/wcs/service`, coverage `icc:met`. Runtime tiles are generated in EPSG:25831; an additional 500 m coarse grid is generated for interactive pre-feasibility routing. The source MET-15/WCS is ICGC geoinformation under CC BY 4.0; verify the current licence page when publishing derived products.
