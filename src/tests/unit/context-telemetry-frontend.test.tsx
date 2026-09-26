import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ipc } from "@/ipc/manager";
import { TokenProgressGauge } from "@/modules/context-telemetry/components/atoms/TokenProgressGauge";
import { ContextPressureBadge } from "@/modules/context-telemetry/components/atoms/ContextPressureBadge";
import { TokenRatioDisplay } from "@/modules/context-telemetry/components/molecules/TokenRatioDisplay";
import { ModelSwitchCard } from "@/modules/context-telemetry/components/molecules/ModelSwitchCard";
import { SubagentRow } from "@/modules/context-telemetry/components/molecules/SubagentRow";
import { CompactionPill } from "@/modules/context-telemetry/components/molecules/CompactionPill";
import { SubagentsAccordion } from "@/modules/context-telemetry/components/organisms/SubagentsAccordion";
import { ConcurrentSessionSelector } from "@/modules/context-telemetry/components/organisms/ConcurrentSessionSelector";
import { ActiveTelemetryCard } from "@/modules/context-telemetry/components/organisms/ActiveTelemetryCard";
import { ModelSwitchMatrix } from "@/modules/context-telemetry/components/organisms/ModelSwitchMatrix";
import { ContextDashboardSkeleton } from "@/modules/context-telemetry/components/templates/ContextDashboardSkeleton";
import { ContextDashboardTemplate } from "@/modules/context-telemetry/components/templates/ContextDashboardTemplate";
import { ContextDashboard } from "@/modules/context-telemetry/components/ContextDashboard";
import * as contextHook from "@/modules/context-telemetry/hooks/useActiveContextTelemetry";
import type {
  ActiveChatTelemetrySnapshot,
  CompactionEvent,
  ModelCeilingInfo,
} from "@/modules/context-telemetry/ipc/router";

// Mock react-i18next with realistic string mappings
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (key === "context.step_count" && params) {
        return `${params.count} turns completed`;
      }
      if (key === "context.switch_overflow" && params) {
        return `Compaction Risk: Exceeds limit by ${params.count} tokens`;
      }
      if (key === "context.compaction_delta_pill" && params) {
        return `-${params.count} tokens`;
      }
      if (key === "context.subagents_active_count" && params) {
        return `${params.count} active`;
      }
      if (key === "context.subagents_total_tokens" && params) {
        return `${params.count} tokens`;
      }
      if (key === "context.subagent_tokens" && params) {
        return `${params.count} tokens`;
      }
      const dict: Record<string, string> = {
        "context.title": "Chat Context Telemetry",
        "context.subtitle":
          "Real-time context window usage, memory pressure, and compaction monitoring",
        "context.status_normal": "Normal",
        "context.status_high_pressure": "High Pressure",
        "context.status_critical": "Critical Compaction Risk",
        "context.tokens_unit": "tokens",
        "context.switch_fits": "Fits Comfortably",
        "context.switch_high_pressure": "High Memory Pressure",
        "context.cached_tokens": "Prompt Cached",
        "context.fresh_input_tokens": "Fresh Input",
        "context.thinking_tokens": "Thinking Tokens",
        "context.output_tokens": "Output Tokens",
        "context.active_session_title": "Active Cascade Session",
        "context.subagents_title": "Active Subagents",
        "context.subagents_toggle_aria": "Toggle active subagents list",
        "context.switch_preview_title": "Model Switch Compatibility",
        "context.switch_preview_subtitle":
          "Preview how your current conversation fits into alternative model context windows",
        "context.compaction_dismiss": "Dismiss Alert",
        "context.empty_title": "No Active Conversation",
        "context.empty_desc":
          "Start a prompt or cascade in Antigravity to view live context usage and window limits in real time.",
        "context.error_title": "Unable to Inspect Context Telemetry",
        "context.error_desc":
          "Could not read active session state from your local environment. Check if Antigravity is accessible.",
        "context.error_retry": "Retry Inspection",
        "context.badge_live": "Live",
        "context.badge_idle": "Idle",
        "action.retry": "Retry",
        "context.concurrent_title": "Concurrent Sessions",
        "context.session_id_label": "Session ID",
        "context.copy_session_id": "Copy Session ID",
        "context.session_id_copied": "Session ID copied to clipboard",
        "context.current_model": "Current",
        "context.stale_badge": "Stale",
        "context.compacting_badge": "Context compacting...",
        "context.refreshing_label": "Refreshing context...",
      };
      return dict[key] ?? key;
    },
  }),
}));

// Mock IPC manager
vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      context: {
        getActiveTelemetry: vi.fn(),
      },
    },
  },
}));

// Mock toast
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

const mockPrimarySnapshot: ActiveChatTelemetrySnapshot = {
  conversationId: "conv-1234567890abcdef",
  title: "Refactor Authentication Architecture",
  workspaceUris: ["/Users/developer/projects/antigravity"],
  status: "running",
  isCompacting: false,
  lastModifiedTime: "2026-09-27T00:00:00.000Z",
  model: {
    id: "gemini-flash",
    displayName: "Gemini 2.0 Flash",
    maxTokens: 1000000,
    isAuthoritative: true,
  },
  tokens: {
    usedTokens: 145000,
    cachedTokens: 120000,
    freshInputTokens: 25000,
    completionTokens: 800,
    thinkingTokens: 500,
    outputTokens: 300,
    ratioPct: 14.5,
    pressureState: "normal",
    isEstimated: false,
  },
  activeSubagents: [
    {
      conversationId: "sub-111122223333",
      agentName: "Code Reviewer",
      usedTokens: 32000,
      status: "running",
    },
    {
      conversationId: "sub-444455556666",
      agentName: "Test Runner",
      usedTokens: 12000,
      status: "idle",
    },
  ],
};

const mockAvailableModels: ModelCeilingInfo[] = [
  {
    id: "gemini-pro",
    displayName: "Gemini Pro",
    maxTokens: 2000000,
    isAuthoritative: true,
  },
  {
    id: "gemini-flash",
    displayName: "Gemini Flash",
    maxTokens: 1000000,
    isAuthoritative: true,
  },
  {
    id: "claude-family",
    displayName: "Claude 3.5 Sonnet",
    maxTokens: 200000,
    isAuthoritative: true,
  },
  {
    id: "gpt-4o",
    displayName: "GPT-4o",
    maxTokens: 128000,
    isAuthoritative: true,
  },
];

const mockCompactionEvent: CompactionEvent = {
  conversationId: "conv-1234567890abcdef",
  tokenDelta: -117000,
  previousTokens: 165000,
  currentTokens: 48000,
  timestamp: 1727339120000,
};

describe("Context Telemetry Atomic Frontend Components", () => {
  describe("Atom: TokenProgressGauge", () => {
    it("renders with correct accessibility attributes and clamped progress", () => {
      const { container } = render(
        <TokenProgressGauge
          percentage={45.2}
          pressureState="normal"
          ariaLabel="Context usage"
        />,
      );

      const progress = screen.getByRole("progressbar");
      expect(progress).toBeInTheDocument();
      expect(progress).toHaveAttribute("aria-valuenow", "45");
      expect(progress).toHaveAttribute("aria-valuemin", "0");
      expect(progress).toHaveAttribute("aria-valuemax", "100");
      expect(progress).toHaveAttribute("aria-valuetext", "45.2%");

      const bar = container.querySelector(".bg-context-normal-bar");
      expect(bar).toBeInTheDocument();
      expect(bar).toHaveStyle({ width: "45.2%" });
    });

    it("clamps percentages below 0 and above 100", () => {
      const { rerender, container } = render(
        <TokenProgressGauge percentage={-20} pressureState="normal" />,
      );
      let bar = container.querySelector(".bg-context-normal-bar");
      expect(bar).toHaveStyle({ width: "0%" });

      rerender(
        <TokenProgressGauge percentage={140} pressureState="critical_risk" />,
      );
      bar = container.querySelector(".bg-context-critical-bar");
      expect(bar).toHaveStyle({ width: "100%" });
    });

    it("applies warning color for high pressure and critical color for critical risk", () => {
      const { rerender, container } = render(
        <TokenProgressGauge percentage={75} pressureState="high_pressure" />,
      );
      expect(
        container.querySelector(".bg-context-warning-bar"),
      ).toBeInTheDocument();

      rerender(
        <TokenProgressGauge percentage={95} pressureState="critical_risk" />,
      );
      expect(
        container.querySelector(".bg-context-critical-bar"),
      ).toBeInTheDocument();
    });
  });

  describe("Atom: ContextPressureBadge", () => {
    it("renders semantic text and dot for all pressure states", () => {
      const { rerender } = render(
        <ContextPressureBadge pressureState="normal" />,
      );
      expect(screen.getByText("Normal")).toBeInTheDocument();

      rerender(<ContextPressureBadge pressureState="high_pressure" />);
      expect(screen.getByText("High Pressure")).toBeInTheDocument();

      rerender(<ContextPressureBadge pressureState="critical_risk" />);
      expect(screen.getByText("Critical Compaction Risk")).toBeInTheDocument();
    });

    it("supports custom label overrides", () => {
      render(
        <ContextPressureBadge pressureState="normal" label="75.0% Context" />,
      );
      expect(screen.getByText("75.0% Context")).toBeInTheDocument();
    });
  });

  describe("Molecule: TokenRatioDisplay", () => {
    it("formats token numbers with comma separators and ratio badge", () => {
      render(
        <TokenRatioDisplay
          usedTokens={45210}
          maxTokens={1000000}
          ratioPct={4.52}
          pressureState="normal"
        />,
      );

      expect(screen.getByText("45,210")).toBeInTheDocument();
      expect(screen.getByText("/ 1,000,000 tokens")).toBeInTheDocument();
      expect(screen.getByText(/4.5% Normal/)).toBeInTheDocument();
    });
  });

  describe("Molecule: ModelSwitchCard", () => {
    it("renders safe fit status when payload is within normal limits", () => {
      render(
        <ModelSwitchCard
          modelId="gemini-flash"
          displayName="Gemini Flash"
          maxTokens={1000000}
          currentTokens={150000}
        />,
      );

      expect(screen.getByText("Gemini Flash")).toBeInTheDocument();
      expect(screen.getByText("1,000,000 tokens")).toBeInTheDocument();
      expect(screen.getByText("15.0%")).toBeInTheDocument();
      expect(screen.getByText("Fits Comfortably")).toBeInTheDocument();
    });

    it("renders high pressure warning when payload reaches >= 70%", () => {
      render(
        <ModelSwitchCard
          modelId="claude-family"
          displayName="Claude 3.5 Sonnet"
          maxTokens={200000}
          currentTokens={150000}
        />,
      );

      expect(screen.getByText("75.0%")).toBeInTheDocument();
      expect(screen.getByText("High Memory Pressure")).toBeInTheDocument();
    });

    it("renders compaction risk overflow warning when payload exceeds model ceiling", () => {
      render(
        <ModelSwitchCard
          modelId="gpt-4o"
          displayName="GPT-4o"
          maxTokens={128000}
          currentTokens={150000}
        />,
      );

      expect(
        screen.getByText("Compaction Risk: Exceeds limit by 22,000 tokens"),
      ).toBeInTheDocument();
    });

    it("displays Current badge when marked as active model", () => {
      render(
        <ModelSwitchCard
          modelId="gemini-flash"
          displayName="Gemini Flash"
          maxTokens={1000000}
          currentTokens={150000}
          isCurrentModel={true}
        />,
      );

      expect(screen.getByText("Current")).toBeInTheDocument();
    });
  });

  describe("Molecule: SubagentRow", () => {
    it("renders agent name, shortened id, and formatted tokens", () => {
      render(
        <SubagentRow
          conversationId="subagent-cascade-abc1234567"
          agentName="Security Auditor"
          usedTokens={28400}
          status="running"
        />,
      );

      expect(screen.getByText("Security Auditor")).toBeInTheDocument();
      expect(screen.getByText("28,400 tokens")).toBeInTheDocument();
    });
  });

  describe("Molecule: CompactionPill", () => {
    it("renders compaction delta and triggers dismiss callback", () => {
      const handleDismiss = vi.fn();
      render(
        <CompactionPill
          tokenDelta={-117000}
          timestamp={Date.now()}
          onDismiss={handleDismiss}
        />,
      );

      expect(screen.getByText("-117,000 tokens")).toBeInTheDocument();
      const dismissBtn = screen.getByRole("button", { name: "Dismiss Alert" });
      fireEvent.click(dismissBtn);
      expect(handleDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("Organism: SubagentsAccordion", () => {
    it("renders collapsed by default and expands on click", () => {
      render(
        <SubagentsAccordion subagents={mockPrimarySnapshot.activeSubagents} />,
      );

      const trigger = screen.getByRole("button", {
        name: "Toggle active subagents list",
      });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("2 active")).toBeInTheDocument();
      expect(screen.getByText("Σ 44,000 tokens")).toBeInTheDocument();

      // Expand accordion
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Code Reviewer")).toBeInTheDocument();
      expect(screen.getByText("Test Runner")).toBeInTheDocument();
    });

    it("returns null if subagents array is empty", () => {
      const { container } = render(<SubagentsAccordion subagents={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("Organism: ConcurrentSessionSelector", () => {
    it("renders interactive tab buttons for concurrent chats", () => {
      const handleSelect = vi.fn();
      const concurrentChats = [
        {
          conversationId: "chat-1",
          title: "Frontend Refactor",
          usedTokens: 50000,
          maxTokens: 1000000,
          ratioPct: 5.0,
          pressureState: "normal" as const,
        },
        {
          conversationId: "chat-2",
          title: "Backend API Sync",
          usedTokens: 180000,
          maxTokens: 200000,
          ratioPct: 90.0,
          pressureState: "critical_risk" as const,
        },
      ];

      render(
        <ConcurrentSessionSelector
          concurrentChats={concurrentChats}
          activeSessionId="chat-1"
          onSelectSession={handleSelect}
        />,
      );

      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(2);
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(tabs[1]).toHaveAttribute("aria-selected", "false");

      fireEvent.click(tabs[1]);
      expect(handleSelect).toHaveBeenCalledWith("chat-2");
    });
  });

  describe("Organism: ActiveTelemetryCard", () => {
    it("renders active conversation details, supplementary micro-metrics, and subagents normally when isCompacting: false and tokens are valid", () => {
      render(
        <ActiveTelemetryCard
          snapshot={{ ...mockPrimarySnapshot, isCompacting: false }}
          compactionEvent={mockCompactionEvent}
        />,
      );

      expect(
        screen.getByText("Refactor Authentication Architecture"),
      ).toBeInTheDocument();
      expect(screen.getByText("Gemini 2.0 Flash")).toBeInTheDocument();
      expect(screen.getByText("-117,000 tokens")).toBeInTheDocument();
      expect(screen.getByText("145,000")).toBeInTheDocument();
      expect(screen.getByText("Prompt Cached")).toBeInTheDocument();
      expect(screen.getByText("120,000")).toBeInTheDocument();
      expect(screen.getByText("Fresh Input")).toBeInTheDocument();
      expect(screen.getByText("25,000")).toBeInTheDocument();
      expect(screen.getByText("Active Subagents")).toBeInTheDocument();
      expect(
        screen.queryByText("Context compacting..."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Refreshing context..."),
      ).not.toBeInTheDocument();
    });

    it("renders compacting badge and dims metrics when isCompacting: true", () => {
      render(
        <ActiveTelemetryCard
          snapshot={{ ...mockPrimarySnapshot, isCompacting: true }}
        />,
      );

      expect(screen.getByText("Context compacting...")).toBeInTheDocument();
      expect(
        screen.getByRole("status", { name: "Context compacting..." }),
      ).toBeInTheDocument();
    });

    it("renders 'Refreshing context...' and placeholder dashes when usedTokens === 0 && isEstimated === true", () => {
      const estimatedZeroSnapshot: ActiveChatTelemetrySnapshot = {
        ...mockPrimarySnapshot,
        tokens: {
          ...mockPrimarySnapshot.tokens,
          usedTokens: 0,
          cachedTokens: 0,
          freshInputTokens: 0,
          thinkingTokens: 0,
          outputTokens: 0,
          ratioPct: 0,
          isEstimated: true,
        },
      };

      render(<ActiveTelemetryCard snapshot={estimatedZeroSnapshot} />);

      expect(screen.getByText("Refreshing context...")).toBeInTheDocument();
      expect(
        screen.queryByText("0 / 1,000,000 tokens"),
      ).not.toBeInTheDocument();
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBe(4);
    });
  });

  describe("Organism: ModelSwitchMatrix", () => {
    it("renders grid of 4 model comparison cards", () => {
      render(
        <ModelSwitchMatrix
          availableModels={mockAvailableModels}
          currentUsedTokens={145000}
          currentModelId="gemini-flash"
        />,
      );

      expect(
        screen.getByText("Model Switch Compatibility"),
      ).toBeInTheDocument();
      expect(screen.getByText("Gemini Pro")).toBeInTheDocument();
      expect(screen.getByText("Gemini Flash")).toBeInTheDocument();
      expect(screen.getByText("Claude 3.5 Sonnet")).toBeInTheDocument();
      expect(screen.getByText("GPT-4o")).toBeInTheDocument();
    });
  });

  describe("Template: ContextDashboardSkeleton", () => {
    it("renders full geometric placeholder with aria-busy", () => {
      render(<ContextDashboardSkeleton />);
      const skeletonContainer = screen.getByRole("status");
      expect(skeletonContainer).toHaveAttribute("aria-busy", "true");
    });
  });

  describe("Template: ContextDashboardTemplate", () => {
    it("renders children and supports heroCard fallback slot", () => {
      const { rerender } = render(
        <ContextDashboardTemplate
          header={<div>Header Content</div>}
          children={<div>Children Slot Content</div>}
        />,
      );
      expect(screen.getByText("Children Slot Content")).toBeInTheDocument();

      rerender(
        <ContextDashboardTemplate
          header={<div>Header Content</div>}
          heroCard={<div>HeroCard Slot Content</div>}
        />,
      );
      expect(screen.getByText("HeroCard Slot Content")).toBeInTheDocument();
    });
  });

  describe("Container: ContextDashboard Complete 4-State Spectrum", () => {
    let queryClient: QueryClient;

    beforeEach(() => {
      vi.clearAllMocks();
      queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("State 1: renders ContextDashboardSkeleton when query is loading", () => {
      vi.spyOn(contextHook, "useActiveContextTelemetry").mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        isFetching: true,
        refetch: vi.fn(),
      } as any);

      render(
        <QueryClientProvider client={queryClient}>
          <ContextDashboard />
        </QueryClientProvider>,
      );

      expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    });

    it("State 2: renders Inline Recoverable Error card with retry button on IPC failure", () => {
      const mockRefetch = vi.fn();
      vi.spyOn(contextHook, "useActiveContextTelemetry").mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        isFetching: false,
        refetch: mockRefetch,
      } as any);

      render(
        <QueryClientProvider client={queryClient}>
          <ContextDashboard />
        </QueryClientProvider>,
      );

      expect(
        screen.getByText("Unable to Inspect Context Telemetry"),
      ).toBeInTheDocument();
      const retryBtn = screen.getByRole("button", { name: "Retry Inspection" });
      fireEvent.click(retryBtn);
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it("State 3: renders Purpose-Built Empty State card when no active cascade is running", () => {
      const mockRefetch = vi.fn();
      vi.spyOn(contextHook, "useActiveContextTelemetry").mockReturnValue({
        data: {
          runtimeState: "idle_no_active_chat",
          hasActiveChat: false,
          pollingIntervalMs: 15000,
          primaryChat: null,
          concurrentChats: [],
          recentCompactionEvent: null,
          availableModels: mockAvailableModels,
        },
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: mockRefetch,
      } as any);

      render(
        <QueryClientProvider client={queryClient}>
          <ContextDashboard />
        </QueryClientProvider>,
      );

      expect(screen.getByText("No Active Conversation")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Start a prompt or cascade in Antigravity to view live context usage and window limits in real time.",
        ),
      ).toBeInTheDocument();
    });

    it("State 4: renders Populated Active State with telemetry card and model matrix", () => {
      vi.spyOn(contextHook, "useActiveContextTelemetry").mockReturnValue({
        data: {
          runtimeState: "active",
          hasActiveChat: true,
          pollingIntervalMs: 3000,
          primaryChat: mockPrimarySnapshot,
          concurrentChats: [],
          recentCompactionEvent: mockCompactionEvent,
          availableModels: mockAvailableModels,
          isStale: false,
        },
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      } as any);

      render(
        <QueryClientProvider client={queryClient}>
          <ContextDashboard />
        </QueryClientProvider>,
      );

      expect(screen.getByText("Chat Context Telemetry")).toBeInTheDocument();
      expect(
        screen.getByText("Refactor Authentication Architecture"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Model Switch Compatibility"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("-117,000 tokens")).toBeInTheDocument();
    });

    it("displays stale badge when telemetry data is marked stale", () => {
      vi.spyOn(contextHook, "useActiveContextTelemetry").mockReturnValue({
        data: {
          runtimeState: "active",
          hasActiveChat: true,
          pollingIntervalMs: 3000,
          primaryChat: mockPrimarySnapshot,
          concurrentChats: [],
          recentCompactionEvent: null,
          availableModels: mockAvailableModels,
          isStale: true,
        },
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      } as any);

      render(
        <QueryClientProvider client={queryClient}>
          <ContextDashboard />
        </QueryClientProvider>,
      );

      expect(screen.getByText("Stale")).toBeInTheDocument();
    });

    it("renders multiple concurrent active sessions as cards without tabs", () => {
      const mockRefetch = vi.fn();
      vi.spyOn(contextHook, "useActiveContextTelemetry").mockReturnValue({
        data: {
          runtimeState: "active",
          hasActiveChat: true,
          pollingIntervalMs: 3000,
          primaryChat: mockPrimarySnapshot,
          concurrentChats: [
            {
              conversationId: "concurrent-999",
              title: "Secondary Cascade",
              usedTokens: 60000,
              maxTokens: 1000000,
              ratioPct: 6.0,
              pressureState: "normal" as const,
              workspaceUris: ["/workspace/secondary"],
              activeSubagents: [
                {
                  conversationId: "sub-conc-1",
                  agentName: "Dynamic Context Window Feature",
                  usedTokens: 12000,
                  status: "running",
                },
              ],
            },
            {
              conversationId: "concurrent-fallback-title",
              title: "",
              usedTokens: 10000,
              maxTokens: 1000000,
              ratioPct: 1.0,
              pressureState: "normal" as const,
            },
          ],
          recentCompactionEvent: mockCompactionEvent,
          availableModels: mockAvailableModels,
          isStale: false,
        },
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: mockRefetch,
      } as any);

      render(
        <QueryClientProvider client={queryClient}>
          <ContextDashboard />
        </QueryClientProvider>,
      );

      // 1. Header retry button
      const retryButtons = screen.getAllByRole("button", { name: "Retry" });
      fireEvent.click(retryButtons[0]);
      expect(mockRefetch).toHaveBeenCalled();

      // 2. Both primary and concurrent sessions render as cards directly in DOM
      expect(
        screen.getByText("Refactor Authentication Architecture"),
      ).toBeInTheDocument();
      expect(screen.getByText("Secondary Cascade")).toBeInTheDocument();
      expect(screen.getByText("Active Cascade Session")).toBeInTheDocument();
      expect(screen.getByText("/workspace/secondary")).toBeInTheDocument();

      // 3. Zero tabs exist
      expect(screen.queryAllByRole("tab")).toHaveLength(0);

      // 4. Dismiss compaction pill
      expect(screen.getByText("-117,000 tokens")).toBeInTheDocument();
      const dismissBtn = screen.getByRole("button", { name: "Dismiss Alert" });
      fireEvent.click(dismissBtn);
      expect(screen.queryByText("-117,000 tokens")).not.toBeInTheDocument();
    });

    it("renders concurrent sessions using snapshot when provided", () => {
      vi.spyOn(contextHook, "useActiveContextTelemetry").mockReturnValue({
        data: {
          runtimeState: "active",
          hasActiveChat: true,
          pollingIntervalMs: 3000,
          primaryChat: mockPrimarySnapshot,
          concurrentChats: [
            {
              conversationId: "concurrent-full",
              title: "Concurrent Full",
              usedTokens: 80000,
              maxTokens: 1000000,
              ratioPct: 8.0,
              pressureState: "normal" as const,
              snapshot: {
                ...mockPrimarySnapshot,
                conversationId: "concurrent-full",
                title: "Concurrent Full With Snapshot",
              },
            },
          ],
          recentCompactionEvent: null,
          availableModels: [],
          isStale: false,
        },
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      } as any);

      render(
        <QueryClientProvider client={queryClient}>
          <ContextDashboard />
        </QueryClientProvider>,
      );

      expect(
        screen.getByText("Concurrent Full With Snapshot"),
      ).toBeInTheDocument();
    });
  });

  describe("Branch & Edge Case Coverage", () => {
    it("TokenRatioDisplay handles showBadge=false and different pressure states", () => {
      const { rerender } = render(
        <TokenRatioDisplay
          usedTokens={85000}
          maxTokens={100000}
          ratioPct={85.0}
          pressureState="high_pressure"
          showBadge={false}
        />,
      );
      expect(screen.getByText("85.0%")).toBeInTheDocument();

      rerender(
        <TokenRatioDisplay
          usedTokens={NaN}
          maxTokens={NaN}
          ratioPct={NaN}
          pressureState="normal"
          showBadge={false}
        />,
      );
      expect(screen.getByText("0.0%")).toBeInTheDocument();

      rerender(
        <TokenRatioDisplay
          usedTokens={95000}
          maxTokens={100000}
          ratioPct={95.0}
          pressureState="critical_risk"
          showBadge={true}
        />,
      );
      expect(screen.getByText(/Critical Compaction Risk/)).toBeInTheDocument();

      rerender(
        <TokenRatioDisplay
          usedTokens={85000}
          maxTokens={100000}
          ratioPct={85.0}
          pressureState="high_pressure"
          showBadge={true}
        />,
      );
      expect(screen.getByText(/High Pressure/)).toBeInTheDocument();
    });

    it("TokenProgressGauge handles NaN and clamps properly", () => {
      render(<TokenProgressGauge percentage={NaN} pressureState="normal" />);
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "0",
      );
    });

    it("SubagentRow handles NaN usedTokens", () => {
      render(
        <SubagentRow
          conversationId="short-id"
          agentName="Planner"
          usedTokens={NaN}
          status="idle"
        />,
      );
      expect(screen.getByText("0 tokens")).toBeInTheDocument();
    });

    it("ModelSwitchCard handles NaN currentTokens and zero maxTokens", () => {
      render(
        <ModelSwitchCard
          modelId="test-fallback"
          displayName="Fallback Test"
          maxTokens={0}
          currentTokens={NaN}
        />,
      );
      expect(screen.getByText("Fallback Test")).toBeInTheDocument();
    });

    it("ActiveTelemetryCard handles clipboard write failure and short conversationId", async () => {
      const mockWriteText = vi
        .fn()
        .mockRejectedValue(new Error("Clipboard denied"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: mockWriteText },
        configurable: true,
        writable: true,
      });

      const shortSnapshot: ActiveChatTelemetrySnapshot = {
        ...mockPrimarySnapshot,
        conversationId: "short-conv-123",
      };

      render(
        <ActiveTelemetryCard snapshot={shortSnapshot} compactionEvent={null} />,
      );

      expect(screen.getByText("short-conv-123")).toBeInTheDocument();

      const copyBtn = screen.getByTitle("Copy Session ID");
      await act(async () => {
        fireEvent.click(copyBtn);
      });
      expect(mockWriteText).toHaveBeenCalledWith("short-conv-123");
    });

    it("ConcurrentSessionSelector and ModelSwitchMatrix handle empty or undefined lists", () => {
      const { container: container1 } = render(
        <ConcurrentSessionSelector
          concurrentChats={undefined as any}
          activeSessionId="123"
          onSelectSession={vi.fn()}
        />,
      );
      expect(container1.firstChild).toBeNull();

      const { container: container2 } = render(
        <ModelSwitchMatrix
          availableModels={undefined as any}
          currentUsedTokens={100}
          currentModelId="model-1"
        />,
      );
      expect(container2.firstChild).toBeNull();
    });

    it("SubagentsAccordion handles NaN in subagent tokens", () => {
      render(
        <SubagentsAccordion
          subagents={[
            {
              conversationId: "sub-nan",
              agentName: "NaN Agent",
              usedTokens: NaN,
              status: "idle",
            },
          ]}
        />,
      );
      expect(screen.getByText("Active Subagents")).toBeInTheDocument();
    });

    it("ContextDashboard renders without ModelSwitchMatrix", () => {
      vi.spyOn(contextHook, "useActiveContextTelemetry").mockReturnValue({
        data: {
          runtimeState: "active",
          hasActiveChat: true,
          pollingIntervalMs: 3000,
          primaryChat: mockPrimarySnapshot,
          concurrentChats: [],
          recentCompactionEvent: null,
          availableModels: [],
          isStale: false,
        },
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      } as any);

      const testQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      render(
        <QueryClientProvider client={testQueryClient}>
          <ContextDashboard />
        </QueryClientProvider>,
      );

      expect(
        screen.queryByText("Model Switch Compatibility"),
      ).not.toBeInTheDocument();
    });

    it("ContextDashboard handles isFetching: true and undefined concurrentChats", () => {
      vi.spyOn(contextHook, "useActiveContextTelemetry").mockReturnValue({
        data: {
          runtimeState: "active",
          hasActiveChat: true,
          pollingIntervalMs: 3000,
          primaryChat: mockPrimarySnapshot,
          concurrentChats: undefined as any,
          recentCompactionEvent: null,
          availableModels: [],
          isStale: false,
        },
        isLoading: false,
        isError: false,
        isFetching: true,
        refetch: vi.fn(),
      } as any);

      const testQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      render(
        <QueryClientProvider client={testQueryClient}>
          <ContextDashboard />
        </QueryClientProvider>,
      );

      const retryBtn = screen.getByRole("button", { name: "Retry" });
      expect(retryBtn).toBeDisabled();
      expect(
        screen.getByText("Refactor Authentication Architecture"),
      ).toBeInTheDocument();
    });

    it("ContextDashboard maps concurrent models across 2M, 200k, and custom ceilings", () => {
      vi.spyOn(contextHook, "useActiveContextTelemetry").mockReturnValue({
        data: {
          runtimeState: "active",
          hasActiveChat: true,
          pollingIntervalMs: 3000,
          primaryChat: mockPrimarySnapshot,
          concurrentChats: [
            {
              conversationId: "concurrent-2m",
              title: "Gemini 2M Session",
              usedTokens: 500000,
              maxTokens: 2000000,
              ratioPct: 25.0,
              pressureState: "normal" as const,
            },
            {
              conversationId: "concurrent-200k",
              title: "Claude Session",
              usedTokens: 150000,
              maxTokens: 200000,
              ratioPct: 75.0,
              pressureState: "high_pressure" as const,
            },
            {
              conversationId: "concurrent-custom",
              title: "Custom Session",
              usedTokens: 10000,
              maxTokens: 100000,
              ratioPct: 10.0,
              pressureState: "normal" as const,
            },
          ],
          recentCompactionEvent: null,
          availableModels: [],
          isStale: false,
        },
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      } as any);

      const testQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      render(
        <QueryClientProvider client={testQueryClient}>
          <ContextDashboard />
        </QueryClientProvider>,
      );

      expect(screen.getByText("Gemini 3.1 Pro")).toBeInTheDocument();
      expect(screen.getByText("Claude Sonnet")).toBeInTheDocument();
      expect(screen.getByText("Antigravity Model")).toBeInTheDocument();
    });

    it("ModelSwitchCard renders estimated asterisk when isAuthoritative=false", () => {
      render(
        <ModelSwitchCard
          modelId="custom-model"
          displayName="Custom LLM"
          maxTokens={128000}
          currentTokens={40000}
          isAuthoritative={false}
        />,
      );
      expect(screen.getByText("*")).toBeInTheDocument();
    });

    it("SubagentRow handles short IDs without truncation", () => {
      render(
        <SubagentRow
          conversationId="short-id"
          agentName="Planner"
          usedTokens={5000}
          status="idle"
        />,
      );
      expect(screen.getByText("short-id")).toBeInTheDocument();
    });

    it("ActiveTelemetryCard handles clipboard copying, idle status, and fallback title", async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: mockWriteText },
        configurable: true,
        writable: true,
      });

      const idleSnapshot: ActiveChatTelemetrySnapshot = {
        ...mockPrimarySnapshot,
        title: "",
        workspaceUris: [],
        status: "idle",
        activeSubagents: [],
      };

      render(
        <ActiveTelemetryCard snapshot={idleSnapshot} compactionEvent={null} />,
      );

      // Verify fallback title
      expect(screen.getByText("Active Cascade Session")).toBeInTheDocument();
      // Verify Idle status badge
      expect(screen.getByText("Idle")).toBeInTheDocument();

      // Test copy session id button
      const copyBtn = screen.getByTitle("Copy Session ID");
      await act(async () => {
        fireEvent.click(copyBtn);
      });
      expect(mockWriteText).toHaveBeenCalledWith(idleSnapshot.conversationId);
    });

    it("Barrel exports all components cleanly", async () => {
      const barrel = await import("@/modules/context-telemetry/components");
      expect(barrel.ContextDashboard).toBeDefined();
      expect(barrel.TokenProgressGauge).toBeDefined();
      expect(barrel.ContextPressureBadge).toBeDefined();
      expect(barrel.TokenRatioDisplay).toBeDefined();
      expect(barrel.SubagentRow).toBeDefined();
      expect(barrel.CompactionPill).toBeDefined();
      expect(barrel.ActiveTelemetryCard).toBeDefined();
      expect(barrel.SubagentsAccordion).toBeDefined();
      expect(barrel.ContextDashboardTemplate).toBeDefined();
      expect(barrel.ContextDashboardSkeleton).toBeDefined();
    });
  });

  describe("Hook: useActiveContextTelemetry & Dynamic Polling Lifecycle", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("respects explicit pollingIntervalMs from backend payload", () => {
      expect(
        contextHook.calculatePollingInterval({
          pollingIntervalMs: 3000,
        } as any),
      ).toBe(3000);

      expect(
        contextHook.calculatePollingInterval({
          pollingIntervalMs: 15000,
        } as any),
      ).toBe(15000);
    });

    it("calculates 3000ms polling when active chat turn is running", () => {
      expect(
        contextHook.calculatePollingInterval({
          primaryChat: { status: "running" },
        } as any),
      ).toBe(3000);
    });

    it("calculates 15000ms polling backoff when chat is idle or interrupted", () => {
      expect(
        contextHook.calculatePollingInterval({
          primaryChat: { status: "idle" },
        } as any),
      ).toBe(15000);

      expect(
        contextHook.calculatePollingInterval({
          primaryChat: { status: "interrupted" },
        } as any),
      ).toBe(15000);
    });

    it("calculates 15000ms polling when no active chat exists or data is undefined", () => {
      expect(
        contextHook.calculatePollingInterval({
          primaryChat: null,
          hasActiveChat: false,
        } as any),
      ).toBe(15000);

      expect(contextHook.calculatePollingInterval(undefined)).toBe(15000);
    });

    it("executes useActiveContextTelemetry hook and resolves active telemetry", async () => {
      vi.mocked(ipc.client.context.getActiveTelemetry).mockResolvedValue({
        runtimeState: "active",
        hasActiveChat: true,
        pollingIntervalMs: 3000,
        primaryChat: mockPrimarySnapshot,
        concurrentChats: [],
        recentCompactionEvent: null,
        availableModels: mockAvailableModels,
      } as any);

      const testQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      const { result } = renderHook(
        () => contextHook.useActiveContextTelemetry({ target: "app" }),
        {
          wrapper: ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={testQueryClient}>
              {children}
            </QueryClientProvider>
          ),
        },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.hasActiveChat).toBe(true);
      expect(result.current.data?.pollingIntervalMs).toBe(3000);
    });

    it("supports custom refetchInterval as number and function in useActiveContextTelemetry", async () => {
      vi.mocked(ipc.client.context.getActiveTelemetry).mockResolvedValue({
        runtimeState: "active",
        hasActiveChat: true,
        pollingIntervalMs: 3000,
        primaryChat: mockPrimarySnapshot,
        concurrentChats: [],
        recentCompactionEvent: null,
        availableModels: mockAvailableModels,
      } as any);

      const testQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      const { result: resNum } = renderHook(
        () => contextHook.useActiveContextTelemetry({ refetchInterval: 5000 }),
        {
          wrapper: ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={testQueryClient}>
              {children}
            </QueryClientProvider>
          ),
        },
      );
      await waitFor(() => expect(resNum.current.isSuccess).toBe(true));

      const mockIntervalFn = vi.fn().mockReturnValue(6000);
      const { result: resFn } = renderHook(
        () =>
          contextHook.useActiveContextTelemetry({
            refetchInterval: mockIntervalFn,
          }),
        {
          wrapper: ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={testQueryClient}>
              {children}
            </QueryClientProvider>
          ),
        },
      );
      await waitFor(() => expect(resFn.current.isSuccess).toBe(true));
    });
  });
});
