import { defineConfig } from 'vite';

// Use repo name as base when building on GitHub Actions.
// Locally during dev, BASE_URL will be '/'.
const repoBase = process.env.GITHUB_REPOSITORY
  ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
  : '/';

export default defineConfig({
  base: repoBase,
});

