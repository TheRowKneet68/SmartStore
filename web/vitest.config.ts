import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The web workspace's unit tests. Vitest is already pinned at 5.0.1 for the server (ADR-31 tooling table), so this
// adds no dependency: npm workspaces hoist it to the root node_modules. The React plugin is what lets a .tsx test
// transform at all, and it is already a devDependency of this workspace.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 5_000,
    // happy-dom rather than jsdom: it is the faster of the two and 19 days past the 7-day release-age window,
    // where jsdom's current release is 9 days past it.
    environment: 'happy-dom',
    // Testing Library's automatic cleanup registers through a global afterEach, so this is what unmounts between
    // tests. Without it the second render would find the first test's elements still in the document.
    globals: true,
    // Building the DOM environment per file cost 19s of a 27s run. vmThreads builds it once per worker while keeping
    // per-file isolation, which is what makes `isolate: false` (the other option vitest suggests) safe enough to
    // avoid: a leaf-level unit suite should not be able to leak state from one file into the next.
    pool: 'vmThreads',
  },
});
