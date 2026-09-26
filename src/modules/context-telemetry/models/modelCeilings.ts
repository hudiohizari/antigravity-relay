export type ContextPressureState = "normal" | "high_pressure" | "critical_risk";

export interface ModelCeilingDefinition {
  id: string;
  displayName: string;
  pattern: RegExp;
  maxTokens: number;
  isAuthoritative: boolean;
}

export interface ModelCeilingInfo {
  id: string;
  displayName: string;
  maxTokens: number;
  isAuthoritative: boolean;
}

export const KNOWN_MODEL_CEILINGS: ModelCeilingDefinition[] = [
  // Claude 4.6 Opus (Thinking)
  {
    id: "claude-4.6-opus-thinking",
    displayName: "Claude 4.6 Opus (Thinking)",
    pattern: /(?:claude-opus-4-6-thinking|claude-opus-4-6)/i,
    maxTokens: 200_000,
    isAuthoritative: true,
  },
  // Claude 4.6 Sonnet (Thinking)
  {
    id: "claude-4.6-sonnet-thinking",
    displayName: "Claude 4.6 Sonnet (Thinking)",
    pattern:
      /(?:claude-sonnet-4-6-thinking|claude-sonnet-4-6|claude-3-7-sonnet)/i,
    maxTokens: 200_000,
    isAuthoritative: true,
  },
  // Claude 4.5 Opus (Thinking)
  {
    id: "claude-4.5-opus-thinking",
    displayName: "Claude 4.5 Opus (Thinking)",
    pattern: /(?:claude-opus-4-5-thinking|claude-opus-4-5)/i,
    maxTokens: 200_000,
    isAuthoritative: true,
  },
  // Claude 4.5 Sonnet (Thinking)
  {
    id: "claude-4.5-sonnet-thinking",
    displayName: "Claude 4.5 Sonnet (Thinking)",
    pattern: /(?:claude-sonnet-4-5-thinking|claude-sonnet-4-5)/i,
    maxTokens: 200_000,
    isAuthoritative: true,
  },
  // Claude 3.5 Sonnet
  {
    id: "claude-3.5-sonnet",
    displayName: "Claude 3.5 Sonnet",
    pattern:
      /(?:claude-(?:3-5|3\.5)-sonnet|MODEL_PLACEHOLDER_M26|MODEL_PLACEHOLDER_M34)/i,
    maxTokens: 200_000,
    isAuthoritative: true,
  },
  // Gemini 3.8 Flash (High)
  {
    id: "gemini-3.8-flash-high",
    displayName: "Gemini 3.8 Flash (High)",
    pattern: /(?:gemini-(?:3\.8|3\.5)-flash-high)/i,
    maxTokens: 1_000_000,
    isAuthoritative: true,
  },
  // Gemini 3.8 Flash
  {
    id: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    pattern:
      /(?:gemini-(?:3\.8|3\.5|3\.1|3|2\.5|2\.0)-flash|gemini-flash|MODEL_PLACEHOLDER_M318)/i,
    maxTokens: 1_000_000,
    isAuthoritative: true,
  },
  // Gemini 3.1 Pro
  {
    id: "gemini-3.1-pro",
    displayName: "Gemini 3.1 Pro",
    pattern:
      /(?:gemini-(?:3\.1|3|2\.5|2\.0)-pro|gemini-pro|MODEL_PLACEHOLDER_M29)/i,
    maxTokens: 2_000_000,
    isAuthoritative: true,
  },
];

export const FALLBACK_MODEL_CEILING: ModelCeilingDefinition = {
  id: "unknown-model",
  displayName: "Unknown Model",
  pattern: /.*/,
  maxTokens: 128_000,
  isAuthoritative: false,
};

/**
 * Resolves the maximum context window ceiling from a model identifier or proto enum.
 */
export function resolveModelContextWindow(rawModel?: string): ModelCeilingInfo {
  if (!rawModel || typeof rawModel !== "string") {
    return {
      id: FALLBACK_MODEL_CEILING.id,
      displayName: FALLBACK_MODEL_CEILING.displayName,
      maxTokens: FALLBACK_MODEL_CEILING.maxTokens,
      isAuthoritative: FALLBACK_MODEL_CEILING.isAuthoritative,
    };
  }

  const trimmed = rawModel.trim();
  for (const def of KNOWN_MODEL_CEILINGS) {
    if (def.pattern.test(trimmed)) {
      return {
        id: def.id,
        displayName: def.displayName,
        maxTokens: def.maxTokens,
        isAuthoritative: def.isAuthoritative,
      };
    }
  }

  return {
    id: FALLBACK_MODEL_CEILING.id,
    displayName: trimmed || FALLBACK_MODEL_CEILING.displayName,
    maxTokens: FALLBACK_MODEL_CEILING.maxTokens,
    isAuthoritative: FALLBACK_MODEL_CEILING.isAuthoritative,
  };
}

/**
 * Evaluates context pressure based on exact percentage boundaries:
 * - < 70.0%: normal
 * - 70.0% - 89.9%: high_pressure
 * - >= 90.0%: critical_risk
 */
export function calculatePressureState(ratioPct: number): ContextPressureState {
  if (ratioPct >= 90.0) {
    return "critical_risk";
  }
  if (ratioPct >= 70.0) {
    return "high_pressure";
  }
  return "normal";
}

/**
 * Returns canonical list of available models for client-side switch preview calculations.
 * Empty since preview was removed per user request.
 */
export function getAvailableModelCeilings(): ModelCeilingInfo[] {
  return [];
}
