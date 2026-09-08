import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  trace,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import {
  ConsoleMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { logger } from "@/shared/logging/logger";
import {
  createOpenTelemetryBuildConfig,
  type OpenTelemetryBuildConfig,
} from "./openTelemetryConfig";

interface OpenTelemetryInitOptions {
  enabled?: boolean;
  serviceVersion: string;
}

let sdk: NodeSDK | null = null;

function getOpenTelemetryConfig(): OpenTelemetryBuildConfig {
  if (typeof OPEN_TELEMETRY_BUILD_CONFIG === "undefined") {
    return createOpenTelemetryBuildConfig({});
  }

  return OPEN_TELEMETRY_BUILD_CONFIG;
}

function shouldUseOtlpTraceExporter(config: OpenTelemetryBuildConfig): boolean {
  const exporters = config.tracesExporters;
  if (exporters.includes("none")) {
    return false;
  }

  return (
    exporters.includes("otlp") ||
    exporters.length === 0 ||
    Boolean(config.otlpEndpoint)
  );
}

function shouldUseOtlpMetricExporter(
  config: OpenTelemetryBuildConfig,
): boolean {
  const exporters = config.metricsExporters;
  if (exporters.includes("none")) {
    return false;
  }

  return (
    exporters.includes("otlp") ||
    exporters.length === 0 ||
    Boolean(config.otlpEndpoint)
  );
}

function appendOtlpSignalPath(
  endpoint: string,
  signal: "traces" | "metrics",
): string {
  if (!endpoint) {
    return "";
  }

  const trimmed = endpoint.replace(/\/+$/, "");
  if (trimmed.endsWith(`/v1/${signal}`)) {
    return trimmed;
  }

  return `${trimmed}/v1/${signal}`;
}

export function initializeOpenTelemetry(
  options: OpenTelemetryInitOptions,
): void {
  const config = getOpenTelemetryConfig();
  if (sdk || !options.enabled || !config.enabled || config.sdkDisabled) {
    return;
  }

  if (config.debug) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const spanProcessors = [];

  if (config.tracesExporters.includes("console")) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }
  if (shouldUseOtlpTraceExporter(config)) {
    const traceUrl = appendOtlpSignalPath(config.otlpEndpoint, "traces");
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          ...(traceUrl ? { url: traceUrl } : {}),
          headers: config.otlpHeaders,
        }),
      ),
    );
  }

  const metricReaders = [];

  if (config.metricsExporters.includes("console")) {
    metricReaders.push(
      new PeriodicExportingMetricReader({
        exporter: new ConsoleMetricExporter(),
        exportIntervalMillis: 30_000,
      }),
    );
  }
  if (shouldUseOtlpMetricExporter(config)) {
    const metricUrl = appendOtlpSignalPath(config.otlpEndpoint, "metrics");
    metricReaders.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          ...(metricUrl ? { url: metricUrl } : {}),
          headers: config.otlpHeaders,
        }),
        exportIntervalMillis: 30_000,
      }),
    );
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      ...config.resourceAttributes,
      "deployment.environment":
        config.resourceAttributes["deployment.environment"] ||
        config.deploymentEnvironment,
      "process.runtime.name": "electron-main",
      "service.name": config.serviceName,
      "service.version": options.serviceVersion,
    }),
    spanProcessors,
    metricReaders,
  });

  sdk.start();

  const startupSpan = trace
    .getTracer("antigravity-relay")
    .startSpan("observability.startup");
  startupSpan.setAttribute("app.version", options.serviceVersion);
  startupSpan.setAttribute(
    "deployment.environment",
    config.deploymentEnvironment,
  );
  startupSpan.end();

  logger.info("OpenTelemetry initialized", {
    tracesExporters:
      config.tracesExporters.length > 0 ? config.tracesExporters : ["otlp"],
    metricsExporters:
      config.metricsExporters.length > 0 ? config.metricsExporters : ["otlp"],
    otlpEndpoint: config.otlpEndpoint || "default",
  });
}

export async function shutdownOpenTelemetry(): Promise<void> {
  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
  } catch (error) {
    logger.warn("OpenTelemetry shutdown failed", error);
  } finally {
    sdk = null;
  }
}
