// Catches anything the lazy 3D scene throws (no WebGL2, a lost GPU, a bad mesh) so the app shows the 2D fallback
// instead of a blank page. Error boundaries have to be class components; this is the only one in the app.
import { Component, type ReactNode } from 'react'

interface Props {
  /** Shown in place of the children after a crash. */
  fallback: ReactNode
  children: ReactNode
}

export class SceneErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('3D scene failed, showing the 2D fallback:', error)
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
