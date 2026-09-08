import { logger } from "@/shared/logging/logger";

type TimingTraceStatus = "success" | "failure";
type TimingTraceAttributes = Record<string, unknown>;

export interface TimingTraceFinishOptions {
  status?: TimingTraceStatus;
  error?: unknown;
  attributes?: TimingTraceAttributes;
}

export type TimingTraceFinishAttributes =
  | TimingTraceAttributes
  | ((result: {
      status: TimingTraceStatus;
      error?: unknown;
    }) => TimingTraceAttributes);

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.round(nowMs() - startedAt);
}

function getErrorAttributes(error: unknown): TimingTraceAttributes {
  if (!error) {
    return {};
  }

  if (error instanceof Error) {
    return {
      errorType: error.name,
      errorMessage: error.message,
    };
  }

  return {
    errorType: typeof error,
    errorMessage: String(error),
  };
}

/**
 * Records one operation as an observable timing trace with named phases.
 */
export class TimingTrace {
  private readonly startedAt = nowMs();
  private readonly phaseDurations: Record<string, number> = {};
  private readonly attributes: TimingTraceAttributes;

  constructor(
    private readonly name: string,
    attributes: TimingTraceAttributes = {},
  ) {
    this.attributes = { ...attributes };
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
  }

  setAttributes(attributes: TimingTraceAttributes): void {
    Object.assign(this.attributes, attributes);
  }

  async phase<T>(name: string, action: () => Promise<T>): Promise<T> {
    const startedAt = nowMs();
    try {
      return await action();
    } finally {
      this.phaseDurations[name] = elapsedMs(startedAt);
    }
  }

  phaseSync<T>(name: string, action: () => T): T {
    const startedAt = nowMs();
    try {
      return action();
    } finally {
      this.phaseDurations[name] = elapsedMs(startedAt);
    }
  }

  finish(options: TimingTraceFinishOptions = {}): void {
    const { status = "success", error, attributes = {} } = options;
    const totalMs = elapsedMs(this.startedAt);
    const finalAttributes = {
      ...this.attributes,
      ...attributes,
      status,
    };

    logger.info(`[timing] ${this.name}`, {
      ...finalAttributes,
      totalMs,
      ...getErrorAttributes(error),
      ...this.phaseDurations,
    });
  }
}

export function createTimingTrace(
  name: string,
  attributes: TimingTraceAttributes = {},
): TimingTrace {
  return new TimingTrace(name, attributes);
}

export async function withTimingTrace<T>(
  name: string,
  attributes: TimingTraceAttributes,
  action: (trace: TimingTrace) => Promise<T>,
  finishAttributes: TimingTraceFinishAttributes = {},
): Promise<T> {
  const traceInstance = createTimingTrace(name, attributes);
  let status: TimingTraceStatus = "failure";
  let error: unknown;

  try {
    const result = await action(traceInstance);
    status = "success";
    return result;
  } catch (caughtError) {
    error = caughtError;
    throw caughtError;
  } finally {
    traceInstance.finish({
      status,
      error,
      attributes:
        typeof finishAttributes === "function"
          ? finishAttributes({ status, error })
          : finishAttributes,
    });
  }
}
