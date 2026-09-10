import React from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export interface RouteErrorFallbackProps {
  error?: unknown;
  reset?: () => void;
}

export function RouteErrorFallback({
  error: _error,
  reset,
}: RouteErrorFallbackProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleReset = () => {
    if (reset) {
      reset();
    } else {
      window.location.reload();
    }
  };

  return (
    <div className="container mx-auto flex min-h-[360px] items-center justify-center p-4 sm:p-6">
      <div
        role="alert"
        aria-live="polite"
        className="border-border bg-card/60 flex w-full max-w-md flex-col items-center rounded-xl border border-dashed p-6 text-center shadow-xs"
      >
        <div
          aria-hidden="true"
          className="bg-muted text-muted-foreground mb-3 flex h-10 w-10 items-center justify-center rounded-full"
        >
          <AlertCircle className="h-5 w-5" />
        </div>
        <h2 className="text-foreground text-base font-semibold">
          {t("error.routeFallback.title")}
        </h2>
        <p className="text-muted-foreground mt-1.5 text-xs sm:text-sm leading-normal">
          {t("error.routeFallback.description")}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="min-h-[40px] cursor-pointer px-4 text-xs font-medium"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t("error.routeFallback.retry")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: "/" })}
            className="min-h-[40px] cursor-pointer px-4 text-xs"
          >
            <Home className="mr-1.5 h-3.5 w-3.5" />
            {t("error.routeFallback.goHome")}
          </Button>
        </div>
      </div>
    </div>
  );
}
