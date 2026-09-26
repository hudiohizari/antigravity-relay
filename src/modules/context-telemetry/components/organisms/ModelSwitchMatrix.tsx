import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";
import { ModelSwitchCard } from "../molecules/ModelSwitchCard";
import { ArrowLeftRight } from "lucide-react";
import type { ModelCeilingInfo } from "../../ipc/router";

export interface ModelSwitchMatrixProps {
  availableModels: ModelCeilingInfo[];
  currentUsedTokens: number;
  currentModelId?: string;
  className?: string;
}

export function ModelSwitchMatrix({
  availableModels,
  currentUsedTokens,
  currentModelId,
  className,
}: ModelSwitchMatrixProps) {
  const { t } = useTranslation();

  if (!availableModels || availableModels.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="model-switch-title"
      className={cn("space-y-3.5", className)}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
        <div className="flex items-center gap-2">
          <ArrowLeftRight
            className="h-4 w-4 text-primary shrink-0"
            aria-hidden="true"
          />
          <h3
            id="model-switch-title"
            className="font-semibold text-sm sm:text-base text-foreground"
          >
            {t("context.switch_preview_title")}
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("context.switch_preview_subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {availableModels.map((model) => (
          <ModelSwitchCard
            key={model.id}
            modelId={model.id}
            displayName={model.displayName}
            maxTokens={model.maxTokens}
            currentTokens={currentUsedTokens}
            isCurrentModel={currentModelId === model.id}
            isAuthoritative={model.isAuthoritative}
          />
        ))}
      </div>
    </section>
  );
}
