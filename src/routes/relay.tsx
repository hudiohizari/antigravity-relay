import { createFileRoute } from "@tanstack/react-router";
import { RelayDashboard } from "@/modules/relay/components/RelayDashboard";
import { RouteErrorFallback } from "@/components/layout/RouteErrorFallback";

export const Route = createFileRoute("/relay")({
  component: RelayDashboard,
  errorComponent: RouteErrorFallback,
});
