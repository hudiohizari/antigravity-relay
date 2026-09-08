import { useEffect } from 'react';

import { useAppConfig } from '@/modules/config/hooks/useAppConfig';
import { syncClarity } from '@/shared/analytics/clarity';

export function ClarityBootstrap() {
  const { config } = useAppConfig();

  useEffect(() => {
    if (!config) {
      return;
    }

    syncClarity(config);
  }, [config]);

  return null;
}
