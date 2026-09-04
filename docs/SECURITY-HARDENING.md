# Security hardening notes

This document records security-sensitive implementation choices that should be preserved during future refactors.

## Browser state trust boundary

`sessionStorage` is client-controlled input. `frontend/app.js` uses a versioned state key and sanitizes persisted data before assigning it to live application state.

Validation includes:

- line ID format and uniqueness;
- maximum number of lines;
- line colors against `COLORS_LINIA`;
- station IDs against `MUNICIPI_PER_ID`;
- duplicate station removal and station count cap;
- maximum line-name length;
- finite non-negative `existingKm`;
- allowed map layers (`procedural`, `osm`);
- finite `viewBox` values and zoom width constraints;
- strict booleans;
- finite model parameters restricted to the same ranges as the UI sliders.

Invalid JSON or an invalid top-level object is ignored without failing the component.

## Dynamic HTML/SVG classification

The frontend retains string-based SVG/HTML rendering in performance-sensitive paths. This is intentional to avoid a large visual refactor. Every use of `innerHTML` belongs to one of these classes:

| Renderer | Class | Variable input | Mitigation |
| --- | --- | --- | --- |
| Empty-state messages | A — static | None | Literal markup only |
| Comarca paths | B/C | projected numeric geometry; comarca name | Geometry is numeric; name passes `esc()` |
| Hover ring | B | projected numeric municipality coordinates | Municipality IDs come from the internal map; attributes are numeric |
| OSM tiles | B | numeric tile coordinates | Host is a fixed literal `tile.openstreetmap.org`; URL pieces are calculated integers |
| Captured-flow SVG | B | calculated numeric values; line color | Restored colors are allowlisted; new colors come from `COLORS_LINIA` |
| Rail-line SVG | B | calculated coordinates; line color | Same color allowlist; coordinates derive from known municipalities |
| Municipality labels | C | municipality name | Name passes `esc()` |
| Per-line cards | C | line name, route, metadata label | Text passes `esc()`; line IDs follow `^linia-\d+$`; colors are allowlisted |
| Global summary | A/B | calculated numeric values | Labels are static; values are numeric/formatted |

Rules for future code:

1. Prefer `textContent`, `createElement()` and `createElementNS()` for new dynamic text/components.
2. If a string template is retained, variable text must pass through `esc()`.
3. Non-text attributes influenced by persisted state must be type-checked or allowlisted before rendering.
4. Never pass raw `sessionStorage`, URL parameters, external metadata or secrets directly to `innerHTML`.

## MITMS downloader trust boundary

Only the official HTTPS host is allowed. Every redirect is validated before following it. The downloader limits bytes, redirects, retries and decompressed row count, and removes partial files after failures.

The default `MAX_ROWS_PER_DATASET` is deliberately generous. It is a denial-of-service guard, not a statement about the expected row count. If the official dataset legitimately grows beyond it, review the upstream format and resource requirements before raising the limit.

## Streamlit payload

Everything in `rail_app(data=...)` is public to the browser. Keep the payload restricted to public municipalities, comarca geometry, public OD pairs and public metadata.

## Deployment controls outside the repository

GitHub branch rules, GitHub-native secret scanning/push protection, Code Security settings and HTTPS reverse-proxy configuration are deployment/platform controls. Committing this repository does not enable those account settings automatically.
