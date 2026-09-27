// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ProjectGroupAccordion,
  ChevronIcon,
} from "@/modules/antigravity-runtime/components/ProjectGroupAccordion";
import type { BrokenProjectGroup } from "@/modules/antigravity-runtime/conversation/conversationCleaner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        "settings.conversationCleaner.projectGroupsTitle": "Affected Projects",
        "settings.conversationCleaner.noWorkspaceGroup":
          "Global / No Workspace",
        "settings.conversationCleaner.untitledConversation":
          "Untitled Conversation",
        "settings.conversationCleaner.brokenCountBadge": `${options?.count ?? 0} broken`,
        "settings.conversationCleaner.showChats": "Show conversations",
        "settings.conversationCleaner.hideChats": "Hide conversations",
        "settings.conversationCleaner.toggleProjectAria": `Toggle conversation list for ${options?.project ?? ""}`,
      };
      return dict[key] || key;
    },
  }),
}));

describe("ChevronIcon", () => {
  it("renders with rotate-180 when expanded and rotate-0 when collapsed", () => {
    const { container, rerender } = render(
      <ChevronIcon expanded={true} className="custom-class" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeDefined();
    expect(svg?.classList.contains("rotate-180")).toBe(true);
    expect(svg?.classList.contains("custom-class")).toBe(true);

    rerender(<ChevronIcon expanded={false} />);
    expect(svg?.classList.contains("rotate-180")).toBe(false);
  });
});

describe("ProjectGroupAccordion", () => {
  const sampleGroupsTwo: BrokenProjectGroup[] = [
    {
      projectName: "auth-service",
      workspacePath: "/Users/***/Projects/auth-service",
      brokenCount: 2,
      conversations: [
        {
          conversationId: "conv-123456789",
          title: "Fix Token Expiry Bug",
          updatedAt: 1720000000000,
        },
        {
          conversationId: "short-id",
          title: "   ",
        },
      ],
    },
    {
      projectName: "Global / No Workspace",
      workspacePath: "",
      brokenCount: 1,
      conversations: [
        {
          conversationId: "conv-987654321",
          title: "Scratchpad Thread",
        },
      ],
    },
  ];

  const sampleGroupsFour: BrokenProjectGroup[] = [
    {
      projectName: "proj-1",
      workspacePath: "/path/1",
      brokenCount: 1,
      conversations: [{ conversationId: "c-111111111", title: "Chat 1" }],
    },
    {
      projectName: "proj-2",
      workspacePath: "/path/2",
      brokenCount: 1,
      conversations: [{ conversationId: "c-222222222", title: "Chat 2" }],
    },
    {
      projectName: "proj-3",
      workspacePath: "/path/3",
      brokenCount: 1,
      conversations: [{ conversationId: "c-333333333", title: "Chat 3" }],
    },
    {
      projectName: "proj-4",
      workspacePath: "/path/4",
      brokenCount: 1,
      conversations: [{ conversationId: "c-444444444", title: "Chat 4" }],
    },
  ];

  it("returns null when groups array is empty", () => {
    const { container } = render(<ProjectGroupAccordion groups={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("auto-expands all groups when groups count <= 2 (Adaptive Heuristic)", () => {
    render(
      <ProjectGroupAccordion
        groups={sampleGroupsTwo}
        className="extra-style"
      />,
    );

    expect(screen.getByText("Affected Projects")).toBeDefined();
    expect(screen.getByText("auth-service")).toBeDefined();
    expect(screen.getByText("2 broken")).toBeDefined();
    expect(screen.getByText("/Users/***/Projects/auth-service")).toBeDefined();

    // Since <= 2 groups, conversation titles should be visible immediately
    expect(screen.getByText("Fix Token Expiry Bug")).toBeDefined();
    expect(screen.getByText("conv-123...")).toBeDefined();

    // Untitled conversation fallback and short ID
    expect(screen.getByText("Untitled Conversation")).toBeDefined();
    expect(screen.getByText("short-id")).toBeDefined();

    // Second group fallback name for Global / No Workspace
    expect(screen.getByText("Scratchpad Thread")).toBeDefined();

    // Check ARIA attributes
    const headerBtns = screen.getAllByRole("button");
    expect(headerBtns[0].getAttribute("aria-expanded")).toBe("true");
    expect(headerBtns[0].getAttribute("aria-controls")).toBe("project-panel-0");

    const region = screen.getByRole("region", {
      name: "Toggle conversation list for auth-service",
    });
    expect(region).toBeDefined();
  });

  it("collapses all groups by default when groups count > 2 and toggles on click", () => {
    render(<ProjectGroupAccordion groups={sampleGroupsFour} />);

    // Titles should not be visible initially
    expect(screen.queryByText("Chat 1")).toBeNull();
    expect(screen.queryByText("Chat 2")).toBeNull();

    const headers = screen.getAllByRole("button");
    expect(headers).toHaveLength(4);
    expect(headers[0].getAttribute("aria-expanded")).toBe("false");

    // Click first header to expand
    fireEvent.click(headers[0]);
    expect(headers[0].getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Chat 1")).toBeDefined();

    // Click first header again to collapse
    fireEvent.click(headers[0]);
    expect(headers[0].getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Chat 1")).toBeNull();
  });

  it("toggles individual groups independently", () => {
    render(<ProjectGroupAccordion groups={sampleGroupsTwo} />);

    const headers = screen.getAllByRole("button");
    // Initially both expanded
    expect(headers[0].getAttribute("aria-expanded")).toBe("true");
    expect(headers[1].getAttribute("aria-expanded")).toBe("true");

    // Collapse first group
    fireEvent.click(headers[0]);
    expect(headers[0].getAttribute("aria-expanded")).toBe("false");
    expect(headers[1].getAttribute("aria-expanded")).toBe("true");

    // Expand first group again
    fireEvent.click(headers[0]);
    expect(headers[0].getAttribute("aria-expanded")).toBe("true");
  });
});
