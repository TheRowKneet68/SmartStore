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
  },
});
