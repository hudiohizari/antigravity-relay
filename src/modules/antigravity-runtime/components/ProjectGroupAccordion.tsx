import { useState } from "react";
import { Folder, MessageSquareX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";
import {
  type BrokenProjectGroup,
  CONVERSATION_CLEANER_CONSTANTS,
} from "@/modules/antigravity-runtime/conversation/types";

export interface ProjectGroupAccordionProps {
  groups: BrokenProjectGroup[];
  className?: string;
}

interface ChevronIconProps {
  expanded: boolean;
  className?: string;
}

export function ChevronIcon({ expanded, className }: ChevronIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200",
        expanded && "rotate-180",
        className,
      )}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function ProjectGroupAccordion({
  groups,
  className,
}: ProjectGroupAccordionProps) {
  const { t } = useTranslation();

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    if (
      groups.length <= CONVERSATION_CLEANER_CONSTANTS.ACCORDION_EXPAND_THRESHOLD
    ) {
      return new Set(
        groups.map((g) => `${g.projectName}:::${g.workspacePath}`),
      );
    }
    return new Set<string>();
  });

  const toggleGroup = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (groups.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2 dark:bg-muted/10",
        className,
      )}
      data-testid="project-group-accordion"
    >
      <div className="px-1.5 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("settings.conversationCleaner.projectGroupsTitle")}
      </div>

      <div className="space-y-1.5">
        {groups.map((group, index) => {
          const groupKey = `${group.projectName}:::${group.workspacePath}`;
          const isExpanded = expandedKeys.has(groupKey);
          const headerId = `project-header-${index}`;
          const panelId = `project-panel-${index}`;
          const displayProjectName =
            group.projectName ===
            CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME
              ? t("settings.conversationCleaner.noWorkspaceGroup")
              : group.projectName;

          return (
            <div
              key={groupKey}
              className="overflow-hidden rounded-md border border-border/50 bg-background transition-all dark:bg-card/70"
            >
              <button
                type="button"
                id={headerId}
                aria-expanded={isExpanded}
                aria-controls={panelId}
                aria-label={t(
                  "settings.conversationCleaner.toggleProjectAria",
                  {
                    project: displayProjectName,
                  },
                )}
                onClick={() => toggleGroup(groupKey)}
                className="flex min-h-[50px] w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <div className="flex min-w-0 items-center space-x-2.5 pr-2">
                  <div className="flex-shrink-0 rounded-sm bg-muted/60 p-1 text-muted-foreground">
                    <Folder className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {displayProjectName}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                        {t("settings.conversationCleaner.brokenCountBadge", {
                          count: group.brokenCount,
                        })}
                      </span>
                    </div>
                    {group.workspacePath ? (
                      <p
                        className="truncate font-mono text-[11px] text-muted-foreground"
                        title={group.workspacePath}
                      >
                        {group.workspacePath}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-shrink-0 items-center space-x-1 pl-2">
                  <span className="sr-only text-[11px] text-muted-foreground sm:not-sr-only">
                    {isExpanded
                      ? t("settings.conversationCleaner.hideChats")
                      : t("settings.conversationCleaner.showChats")}
                  </span>
                  <ChevronIcon expanded={isExpanded} />
                </div>
              </button>

              {isExpanded && (
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={headerId}
                  className="divide-y divide-border/20 border-t border-border/40 bg-muted/30 dark:bg-muted/10"
                >
                  {group.conversations.map((conv) => {
                    const title =
                      conv.title?.trim() ||
                      t("settings.conversationCleaner.untitledConversation");
                    const truncatedId =
                      conv.conversationId.length > 8
                        ? `${conv.conversationId.slice(0, 8)}...`
                        : conv.conversationId;
                    const formattedTimestamp = conv.updatedAt
                      ? new Intl.DateTimeFormat(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(conv.updatedAt))
                      : null;

                    return (
                      <div
                        key={conv.conversationId}
                        className="flex items-center justify-between px-3.5 py-2 text-xs transition-colors hover:bg-muted/50"
                      >
                        <div className="flex min-w-0 items-center space-x-2 pr-2">
                          <MessageSquareX className="h-3.5 w-3.5 flex-shrink-0 text-rose-500/70" />
                          <span
                            className="max-w-[260px] truncate font-medium text-foreground sm:max-w-[340px]"
                            title={title}
                          >
                            {title}
                          </span>
                        </div>
                        <div className="flex flex-shrink-0 items-center space-x-2">
                          {formattedTimestamp ? (
                            <span className="hidden text-[10px] text-muted-foreground sm:inline">
                              {formattedTimestamp}
                            </span>
                          ) : null}
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {truncatedId}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
