# Pipelines Ferrocat

Aquesta carpeta conté els punts de preparació de dades de Ferrocat:

- `PREPARAR_FERROCAT.py`: orquestrador principal de mobilitat, carreteres, ferrocarril i topografia.
- `download_mobility.py`: implementació MITMS, cridada automàticament per l'orquestrador.
- `prepare_route_constraints.py`: genera el raster lleuger de condicionants de traçat (hidrografia, sòl urbanitzat i carreteres) sobre la mateixa graella del DEM.

## Execució normal, des de l'arrel del repositori

```bat
python -m pipelines.PREPARAR_FERROCAT
python -m pipelines.prepare_route_constraints
```

El segon pas només s'ha de repetir quan canviï el DEM o es vulguin refrescar els condicionants ICGC. El fitxer resultant és `data/terrain/constraints.runtime.json` i és el que utilitza l'optimitzador econòmic de traçat al navegador.

## Blocs individuals

```bat
python -m pipelines.PREPARAR_FERROCAT --only mobility
python -m pipelines.PREPARAR_FERROCAT --only roads
python -m pipelines.PREPARAR_FERROCAT --only infrastructure
python -m pipelines.PREPARAR_FERROCAT --only services
python -m pipelines.PREPARAR_FERROCAT --only terrain
python -m pipelines.PREPARAR_FERROCAT --only overview
python -m pipelines.prepare_route_constraints
```

Per forçar la redescàrrega dels condicionants ICGC:

```bat
python -m pipelines.prepare_route_constraints --refresh
```

La mobilitat també es pot executar directament:

```bat
python -m pipelines.download_mobility
```

Totes les rutes es resolen respecte de l'arrel del repositori, encara que els
scripts visquin dins de `pipelines/`.
