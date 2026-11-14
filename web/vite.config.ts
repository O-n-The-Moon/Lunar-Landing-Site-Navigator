import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Lets engine fixtures import binary contract files (`./ephemeris.bin?inline`).
  assetsInclude: ['**/*.bin'],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
