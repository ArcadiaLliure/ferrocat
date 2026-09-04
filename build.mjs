// build.mjs
// -----------------------------------------------------------------------
// Bundleja frontend/src/app.js -> frontend/dist/ferrocat.bundle.js amb
// esbuild. Node/npm només fan falta en DESENVOLUPAMENT; el bundle es
// versiona al repositori, així que `python -m streamlit run app.py` mai
// necessita npm ni node en producció (Streamlit Community Cloud inclòs).
// -----------------------------------------------------------------------
import { build } from 'esbuild';

await build({
  entryPoints: ['frontend/src/app.js'],
  bundle: true,
  outfile: 'frontend/dist/ferrocat.bundle.js',
  format: 'iife',
  target: ['es2020'],
  minify: false,
  sourcemap: false,
});

console.log('✔ frontend/dist/ferrocat.bundle.js generat');
