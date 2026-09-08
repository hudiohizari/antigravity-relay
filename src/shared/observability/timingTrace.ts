import {
  SpanKind,
  SpanStatusCode,
  metrics,
  trace,
  type Attributes,
  type AttributeValue,
  type Span,
} from "@opentelemetry/api";
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

function toOtelAttributes(attributes: TimingTraceAttributes): Attributes {
  const otelAttributes: Attributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("accountid") ||
      normalizedKey.includes("email") ||
      normalizedKey.includes("token") ||
      normalizedKey.includes("path")
    ) {
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      otelAttributes[key] = value;
      continue;
    }

    if (
      Array.isArray(value) &&
      value.every(
        (item) =>
          item === null ||
          item === undefined ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      )
    ) {
      otelAttributes[key] = value as AttributeValue;
    }
  }

  return otelAttributes;
}

const tracer = trace.getTracer("antigravity-relay");
const meter = metrics.getMeter("antigravity-relay");
const operationDuration = meter.createHistogram("agm.operation.duration", {
  description: "Duration of application operations",
  unit: "ms",
});
const operationPhaseDuration = meter.createHistogram(
  "agm.operation.phase.duration",
  {
    description: "Duration of named application operation phases",
    unit: "ms",
  },
);

/**
 * Records one operation as an observable timing trace with named phases.
 *
 * The structure intentionally mirrors common tracing conventions: one operation/span,
 * stable attributes, phase durations, final status, and error metadata.
 */
export class TimingTrace {
  private readonly startedAt = nowMs();
  private readonly phaseDurations: Record<string, number> = {};
  private readonly attributes: TimingTraceAttributes;
  private readonly span: Span;

  constructor(
    private readonly name: string,
    attributes: TimingTraceAttributes = {},
  ) {
    this.attributes = { ...attributes };
    this.span = tracer.startSpan(name, {
      kind: SpanKind.INTERNAL,
      attributes: toOtelAttributes(this.attributes),
    });
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
    this.span.setAttributes(toOtelAttributes({ [key]: value }));
  }

  setAttributes(attributes: TimingTraceAttributes): void {
    Object.assign(this.attributes, attributes);
    this.span.setAttributes(toOtelAttributes(attributes));
  }

  async phase<T>(name: string, action: () => Promise<T>): Promise<T> {
    const startedAt = nowMs();
    const phaseSpan = tracer.startSpan(`${this.name}.${name}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        ...toOtelAttributes(this.attributes),
        "agm.operation.name": this.name,
        "agm.operation.phase": name,
      },
    });
    try {
      const result = await action();
      phaseSpan.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      phaseSpan.recordException(error as Error);
      phaseSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      const durationMs = elapsedMs(startedAt);
      this.phaseDurations[name] = durationMs;
      this.span.setAttribute(name, durationMs);
      operationPhaseDuration.record(durationMs, {
        ...toOtelAttributes(this.attributes),
        "agm.operation.name": this.name,
        "agm.operation.phase": name,
      });
      phaseSpan.end();
    }
  }

  phaseSync<T>(name: string, action: () => T): T {
    const startedAt = nowMs();
    const phaseSpan = tracer.startSpan(`${this.name}.${name}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        ...toOtelAttributes(this.attributes),
        "agm.operation.name": this.name,
        "agm.operation.phase": name,
      },
    });
    try {
      const result = action();
      phaseSpan.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      phaseSpan.recordException(error as Error);
      phaseSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      const durationMs = elapsedMs(startedAt);
      this.phaseDurations[name] = durationMs;
      this.span.setAttribute(name, durationMs);
      operationPhaseDuration.record(durationMs, {
        ...toOtelAttributes(this.attributes),
        "agm.operation.name": this.name,
        "agm.operation.phase": name,
      });
      phaseSpan.end();
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

    this.span.setAttributes(toOtelAttributes(finalAttributes));
    this.span.setAttribute("agm.operation.duration_ms", totalMs);
    if (error) {
      this.span.recordException(error as Error);
    }
    this.span.setStatus({
      code: status === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : undefined,
    });
    operationDuration.record(totalMs, {
      ...toOtelAttributes(finalAttributes),
      "agm.operation.name": this.name,
    });

    logger.info(`[timing] ${this.name}`, {
      ...finalAttributes,
      totalMs,
      ...getErrorAttributes(error),
      ...this.phaseDurations,
    });
    this.span.end();
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
