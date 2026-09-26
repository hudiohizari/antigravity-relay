import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { cn } from "@/shared/ui/utils";

export interface ContextDashboardSkeletonProps {
  className?: string;
}

export function ContextDashboardSkeleton({
  className,
}: ContextDashboardSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading context telemetry..."
      className={cn(
        "container mx-auto max-w-6xl space-y-6 p-4 sm:p-6 overflow-hidden",
        className,
      )}
    >
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-8 w-48 sm:w-64 rounded-md" />
          </div>
          <Skeleton className="h-4 w-64 sm:w-96 rounded-md" />
        </div>
        <Skeleton className="h-9 w-24 rounded-md shrink-0" />
      </div>

      {/* Hero Card Skeleton (1:1 geometry with ActiveTelemetryCard) */}
      <Card className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <CardHeader className="p-4 sm:p-5 pb-3 sm:pb-4 space-y-3 border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-44 sm:w-60 rounded-md" />
                <Skeleton className="h-3.5 w-32 sm:w-48 rounded-md" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-24 rounded-md" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-5 space-y-5">
          <div className="space-y-3">
            <div className="flex items-baseline gap-2.5">
              <Skeleton className="h-8 sm:h-9 w-32 sm:w-44 rounded-md" />
              <Skeleton className="h-4 w-28 sm:w-36 rounded-md" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="p-2.5 rounded-lg border border-border/40 bg-muted/20 space-y-2"
              >
                <Skeleton className="h-3 w-20 rounded-md" />
                <Skeleton className="h-5 w-16 rounded-md" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
