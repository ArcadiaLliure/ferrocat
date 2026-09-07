# Rail matching

The runtime preserves two concepts:

- **PhysicalRailEdge**: real physical railway geometry from RTT (and later optional IGR-RT enrichment).
- **Service**: a Renfe/FGC GTFS route/shape.

Existing-infrastructure inference is spatial and deliberately conservative in the browser. The offline architecture is prepared for graph-based GTFS map matching; a future enrichment step can use IGR-RT attributes such as physical status, gauge, electrification and track count without changing the frontend domain model.

Shared services are rendered as screen-space parallel stripes with deterministic service ordering. Scenario lines that share the same geometric segment use the same multicolour rule.
