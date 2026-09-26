import { createFileRoute } from "@tanstack/react-router";
import { ContextDashboard } from "@/modules/context-telemetry/components/ContextDashboard";
import { RouteErrorFallback } from "@/components/layout/RouteErrorFallback";

export const Route = createFileRoute("/context")({
  component: ContextDashboard,
  errorComponent: RouteErrorFallback,
});
