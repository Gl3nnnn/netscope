import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from './ErrorState'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Catches render errors so a single broken view cannot blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('NetScope render error:', error, info)
    }
  }

  handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <ErrorState
          title="This view failed to render"
          description={this.state.error.message}
          action={
            <Button variant="outline" onClick={this.handleReset}>
              Try again
            </Button>
          }
        />
      )
    }
    return this.props.children
  }
}
