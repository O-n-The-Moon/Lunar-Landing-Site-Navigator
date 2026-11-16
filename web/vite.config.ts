import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Lets engine fixtures import binary contract files (`./ephemeris.bin?inline`).
  assetsInclude: ['**/*.bin'],
  // Tests read `../docs/demo.md` (`?raw`) to keep the demo presets in step with the generated doc.
  server: { fs: { allow: ['.', '../docs'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
