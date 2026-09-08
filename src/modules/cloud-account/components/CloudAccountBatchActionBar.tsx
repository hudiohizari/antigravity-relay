import { RefreshCw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

interface CloudAccountBatchActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onRefreshSelected: () => void;
  onDeleteSelected: () => void;
}

export function CloudAccountBatchActionBar({
  selectedCount,
  onClearSelection,
  onRefreshSelected,
  onDeleteSelected,
}: CloudAccountBatchActionBarProps) {
  const { t } = useTranslation();

  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="bg-card animate-in fade-in slide-in-from-bottom-4 fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full border px-6 py-2 shadow-lg">
      <div className="flex items-center gap-2 border-r pr-4">
        <span className="text-sm font-semibold">
          {t('cloud.batch.selected', { count: selectedCount })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full"
          onClick={onClearSelection}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onRefreshSelected}>
          <RefreshCw className="mr-2 h-3 w-3" />
          {t('cloud.batch.refresh')}
        </Button>
        <Button variant="destructive" size="sm" onClick={onDeleteSelected}>
          <Trash2 className="mr-2 h-3 w-3" />
          {t('cloud.batch.delete')}
        </Button>
      </div>
    </div>
  );
}
