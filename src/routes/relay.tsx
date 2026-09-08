import { createFileRoute } from '@tanstack/react-router';
import { RelayDashboard } from '@/modules/relay/components/RelayDashboard';

export const Route = createFileRoute('/relay')({
  component: RelayDashboard,
});
