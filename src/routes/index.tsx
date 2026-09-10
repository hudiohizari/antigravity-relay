import { createFileRoute } from "@tanstack/react-router";
import { CloudAccountList } from "@/modules/cloud-account/components/CloudAccountList";
import { RouteErrorFallback } from "@/components/layout/RouteErrorFallback";

function HomePage() {
  return (
    <div className="container mx-auto p-6">
      <CloudAccountList />
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: HomePage,
  errorComponent: RouteErrorFallback,
});
