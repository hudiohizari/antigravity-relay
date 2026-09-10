import React, { Component, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface RootErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface RootErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

function sanitizeErrorDetails(error: Error | null): string {
  if (!error) return "";
  const raw = `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  return raw
    .replace(/(?:Bearer\s+)[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED]")
    .replace(/(?:ya29\.[a-zA-Z0-9_\-]+)/gi, "[REDACTED_OAUTH_TOKEN]");
}

interface RootErrorViewProps {
  error: Error | null;
  onReload?: () => void;
}

export function RootErrorView({ error, onReload }: RootErrorViewProps) {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);
  const errorDetails = sanitizeErrorDetails(error);

  const handleReload = () => {
    if (onReload) {
      onReload();
    } else {
      window.location.reload();
    }
  };

  const handleCopyDetails = async () => {
    if (!errorDetails) return;
    try {
      await navigator.clipboard.writeText(errorDetails);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Clipboard write fallback
    }
  };

  return (
    <div className="bg-background text-foreground flex min-h-screen min-h-[100dvh] w-full items-center justify-center p-4 sm:p-6 select-none">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="root-error-heading"
        aria-describedby="root-error-desc"
        className="bg-card text-card-foreground border-border flex w-full max-w-md flex-col items-center rounded-xl border p-6 text-center shadow-lg transition-all"
      >
        <div
          aria-hidden="true"
          className="bg-destructive/10 text-destructive border-destructive/20 mb-4 flex h-12 w-12 items-center justify-center rounded-full border shadow-xs"
        >
          <AlertTriangle className="h-6 w-6" />
        </div>

        <h1
          id="root-error-heading"
          className="text-foreground text-lg font-semibold tracking-tight sm:text-xl"
        >
          {t("error.rootBoundary.title")}
        </h1>
        <p
          id="root-error-desc"
          className="text-muted-foreground mt-2 text-sm leading-relaxed"
        >
          {t("error.rootBoundary.description")}
        </p>

        {errorDetails && (
          <details className="border-border bg-muted/40 group mt-4 w-full rounded-md border text-left text-xs">
            <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center justify-between p-2.5 font-medium select-none focus-visible:outline-ring/50 focus-visible:outline-2">
              <span>{t("error.rootBoundary.viewDetails")}</span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="border-border border-t p-2.5">
              <pre className="text-muted-foreground max-h-36 overflow-x-auto overflow-y-auto font-mono text-[11px] whitespace-pre-wrap break-all select-all">
                {errorDetails}
              </pre>
            </div>
          </details>
        )}

        <div className="mt-6 flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Button
            variant="default"
            onClick={handleReload}
            className="min-h-[44px] flex-1 cursor-pointer font-medium"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("error.rootBoundary.reload")}
          </Button>
          <Button
            variant="outline"
            onClick={handleCopyDetails}
            className="min-h-[44px] flex-1 cursor-pointer"
          >
            {isCopied ? (
              <>
                <Check className="mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                {t("error.rootBoundary.detailsCopied")}
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                {t("error.rootBoundary.copyDetails")}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  constructor(props: RootErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const electronBridge = window.electron as unknown as
      | {
          logError?: (message: string, details?: unknown) => void;
        }
      | undefined;
    if (electronBridge?.logError) {
      electronBridge.logError(
        "Unhandled React error caught in RootErrorBoundary",
        {
          error: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
        },
      );
    }
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <RootErrorView error={this.state.error} onReload={this.handleReload} />
      );
    }

    return this.props.children;
  }
}
