CAD model from:
https://grabcad.com/library/horizontal-beam-engine-1

Actual model: https://www.ajreeves.com/model-engineer-beam-engine-me-beam.html

## Releasing Assets

1. Export the latest geometry and animation via the converter (`uv run python converter/converter.py`).
2. Copy the generated files from `out/` into `vite-engine/public/assets/` for local testing (keep both `motion.json` and `motion.json.gz` locally—this directory is the source of truth).
3. When ready to publish, upload the assets to a GitHub release (only the gzipped motion file is published):

   ```bash
   scripts/publish_release_assets.sh v0.1.0 --notes "Beam engine tutorial assets"
   ```

   The script will create the release if needed and upload `edges.glb`, `occ2node.json`, and `motion.json.gz` from `out/`.
4. Deploy the site (e.g., `cd vite-engine && npm run build`) and push the static bundle to GitHub Pages. Production builds automatically stream assets from the latest GitHub release; development builds continue to use the local copies in `vite-engine/public/assets/`.

### Customising Asset Hosting

- Override the release owner, repo, or tag at build time with `VITE_GITHUB_OWNER`, `VITE_GITHUB_REPO`, and `VITE_ASSET_TAG`.
- Set `VITE_ASSET_BASE_URL` if you need an explicit asset base (skips the automatic GitHub release URL).
