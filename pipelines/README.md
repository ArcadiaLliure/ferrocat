# Pipelines Ferrocat

Aquesta carpeta conté els dos únics punts de codi de preparació de dades:

- `PREPARAR_FERROCAT.py`: orquestrador únic principal.
- `download_mobility.py`: implementació MITMS, cridada automàticament per l'orquestrador.

## Execució normal, des de l'arrel del repositori

```bat
python -m pipelines.PREPARAR_FERROCAT
```

## Blocs individuals

```bat
python -m pipelines.PREPARAR_FERROCAT --only mobility
python -m pipelines.PREPARAR_FERROCAT --only roads
python -m pipelines.PREPARAR_FERROCAT --only infrastructure
python -m pipelines.PREPARAR_FERROCAT --only services
python -m pipelines.PREPARAR_FERROCAT --only terrain
python -m pipelines.PREPARAR_FERROCAT --only overview
```

La mobilitat també es pot executar directament:

```bat
python -m pipelines.download_mobility
```

Totes les rutes es resolen respecte de l'arrel del repositori, encara que els
scripts visquin dins de `pipelines/`.
