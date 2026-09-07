# Ferrocat — fonts i llicències per a publicació

Aquest paquet aplica un criteri conservador per a publicar el mapa.

- **Carreteres — ICGC RTT**: CC BY 4.0; cal citar la font.
- **Renfe Rodalies/Cercanías — Renfe Data**: els GTFS consten sota CC BY 4.0.
- **Alta velocitat, Metro i TRAM físics — IGR-RT CNIG/IGN**: llicència compatible amb CC BY 4.0. En ser obra derivada es mostra `Obra derivada de IGR-RT 2026 CC-BY 4.0 scne.es`.
- **FGC**: GTFS publicat al portal Dades Obertes FGC i també catalogat al NAP com a gratuït. La barra visible acredita FGC. Abans de redistribuir el **ZIP original** en un paquet comercial, comprova el camp de llicència vigent del mateix asset GTFS del portal.
- **TMB**: el mode públic **no utilitza el GTFS/API de TMB**. Les condicions generals del web i l'autenticació del feed no ofereixen una base prou clara per redistribuir-lo automàticament. S'utilitza IGR-RT per a la geometria física del Metro.
- **TRAM**: el mode públic **no utilitza Open Data TRAM** perquè les seves condicions imposen, entre altres coses, `Powered by TRAM Barcelona`, manteniment d'actualització i condicions contractuals específiques. S'utilitza IGR-RT per a la geometria física del tramvia.
- **OpenStreetMap**: si l'usuari activa la capa OSM, la UI manté visible `© OpenStreetMap contributors · ODbL`.

## Execució

```bat
python PREPARAR_TOTES_LES_VIES.py
```

Per forçar redescàrrega de tot:

```bat
python PREPARAR_TOTES_LES_VIES.py --refresh
```

El script genera carreteres amb LOD 0–3, serveis ferroviaris, estacions i `data/attributions.json`.
