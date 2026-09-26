import React from "react";
import { cn } from "@/shared/ui/utils";

export interface ContextDashboardTemplateProps {
  header: React.ReactNode;
  children?: React.ReactNode;
  heroCard?: React.ReactNode;
  className?: string;
}

export function ContextDashboardTemplate({
  header,
  children,
  heroCard,
  className,
}: ContextDashboardTemplateProps) {
  const content = children ?? heroCard;
  return (
    <div
      className={cn(
        "container mx-auto max-w-6xl space-y-6 p-4 sm:p-6 overflow-hidden",
        className,
      )}
    >
      <header className="space-y-4">{header}</header>

      <main className="space-y-6">
        <section aria-label="Active Context Telemetry">{content}</section>
      </main>
    </div>
  );
}
