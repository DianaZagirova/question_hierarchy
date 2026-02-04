import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-2xl w-full bg-card border-2 border-red-500/50 rounded-lg p-8 shadow-2xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-red-500">Application Error</h1>
                <p className="text-muted-foreground">Something went wrong while rendering the app</p>
              </div>
            </div>

            <div className="bg-secondary/30 rounded-lg p-4 mb-6 border border-border/30">
              <p className="text-sm font-semibold text-foreground mb-2">Error Details:</p>
              <p className="text-sm text-red-400 font-mono mb-3">
                {this.state.error?.message || 'Unknown error'}
              </p>
              
              {this.state.errorInfo && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground mb-2">
                    Stack Trace (click to expand)
                  </summary>
                  <pre className="bg-secondary/50 p-3 rounded overflow-auto max-h-64 border border-border/30">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                onClick={this.handleReset}
                className="bg-gradient-to-r from-primary to-accent hover:shadow-[0_0_20px_rgba(59,130,246,0.4)]"
              >
                Try Again
              </Button>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
                className="border-border/50"
              >
                Reload Page
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  localStorage.removeItem('omega-point-storage');
                  window.location.reload();
                }}
                className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
              >
                Clear Cache & Reload
              </Button>
            </div>

            <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-400">
                <strong>Tip:</strong> If this error persists, try clearing your browser cache or clicking "Clear Cache & Reload" above.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
