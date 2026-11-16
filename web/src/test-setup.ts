import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Pin a fixed non-UTC zone (UTC+12/13, with DST) so a test that parses a UTC date as local
// time fails here and in CI. GitHub Actions runners are UTC and would hide that bug.
// vi.stubEnv sets process.env.TZ without needing Node types in the app tsconfig.
vi.stubEnv('TZ', 'Pacific/Auckland')

// jsdom has no WebGL: by default every test sees "no WebGL", so the 3D views take their 2D fallback without probing a
// canvas. Suites that exercise the 3D views mock this module themselves (see terrain-view.test.tsx).
vi.mock('./app/scene/webgl', () => ({ hasWebGL: () => false }))
