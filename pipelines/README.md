# Pipelines Ferrocat

Aquesta carpeta conté els punts de preparació de dades de Ferrocat:

- `PREPARAR_FERROCAT.py`: orquestrador principal de mobilitat, carreteres, ferrocarril i topografia. El bloc `terrain` genera també els condicionants de traçat.
- `download_mobility.py`: implementació MITMS, cridada automàticament per l'orquestrador.
- `prepare_route_constraints.py`: genera el raster lleuger de condicionants de traçat (hidrografia, sòl urbanitzat i carreteres) sobre la mateixa graella del DEM; també es pot executar de forma independent.

## Execució normal, des de l'arrel del repositori

```bat
python -m pipelines.PREPARAR_FERROCAT
```

Aquesta execució ja deixa preparat `data/terrain/constraints.runtime.json` juntament amb el DEM i la resta de dades necessàries.

## Blocs individuals

```bat
python -m pipelines.PREPARAR_FERROCAT --only mobility
python -m pipelines.PREPARAR_FERROCAT --only roads
python -m pipelines.PREPARAR_FERROCAT --only infrastructure
python -m pipelines.PREPARAR_FERROCAT --only services
python -m pipelines.PREPARAR_FERROCAT --only terrain
python -m pipelines.PREPARAR_FERROCAT --only overview
```

`--only terrain` genera el DEM, les visuals topogràfiques i `constraints.runtime.json`.

Si només cal regenerar els condicionants sobre un DEM coarse ja existent:

```bat
python -m pipelines.prepare_route_constraints
```

Per forçar-ne la redescàrrega des de l'ICGC:

```bat
python -m pipelines.prepare_route_constraints --refresh
```

La mobilitat també es pot executar directament:

```bat
python -m pipelines.download_mobility
```

Totes les rutes es resolen respecte de l'arrel del repositori, encara que els
scripts visquin dins de `pipelines/`.
