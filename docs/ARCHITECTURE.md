# Ferrocat functional architecture

Ferrocat remains a **Streamlit application**. Streamlit loads prepared datasets and hosts a Components V2 client; ordinary map interaction, line editing, OD calculations and the coarse terrain pre-feasibility engine run in the browser without Streamlit reruns.

## Layers

1. **Offline pipelines** download/normalise official sources.
2. **Runtime data** are compact JSON/Parquet/GeoParquet/terrain tiles.
3. **Domain helpers** isolate rail geometry, costs and terrain planning.
4. **Components V2 frontend** owns state, SVG rendering and interaction.

The runtime intentionally distinguishes **physical infrastructure** from **services**. Several services can share one physical corridor and are rendered as stable parallel colour stripes rather than painting one path over another.

## Streamlit compatibility

Production needs no Node server. `python -m streamlit run app.py` remains the entry point. Geospatial build dependencies are isolated in `requirements-pipeline.txt` and are not required by Streamlit at runtime.
