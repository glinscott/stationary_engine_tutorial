CAD model from:
https://grabcad.com/library/horizontal-beam-engine-1

Actual model: https://www.ajreeves.com/model-engineer-beam-engine-me-beam.html

## Assets

1. Export the latest geometry and animation via the converter (`uv run python converter/converter.py`).
2. Copy the generated files from `out/` into `vite-engine/public/assets/`.
3. Commit the updated assets along with any code changes. `npm run build` will bundle them directly for GitHub Pages deployment.

All production builds now load from the repository-hosted files in `vite-engine/public/assets/`. You can still use `VITE_ASSET_BASE_URL` to point to a different host if you ever need an override.
