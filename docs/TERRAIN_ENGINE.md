# Terrain pre-feasibility engine

This is explicitly a **pre-feasibility** tool, not a construction design.

The planner follows two phases:

1. Search inside a corridor around the user's intended alignment for a surface route satisfying the configured exceptional gradient.
2. Only if no surface route is found, rerun the search with mountain-crossing penalties enabled. A grade-bounded vertical profile is then created and sustained positive terrain cover over that profile is classified as tunnel; sustained rail elevation above terrain is classified as viaduct.

The browser uses the compact 500 m DEM for immediate interaction. `ferrocat.terrain.planner` provides a more testable Python implementation for offline validation and future higher-resolution analysis.

Tunnel intervals are merged/filtered to avoid dozens of tiny tunnels caused by DEM noise. Tunnel and viaduct kilometres feed separate cost rates, so a mountain crossing increases estimated capital cost substantially.

Limitations include geology, geotechnics, groundwater, protected areas, expropriation, drainage, detailed curve transition design, tunnel methods and detailed structures.
