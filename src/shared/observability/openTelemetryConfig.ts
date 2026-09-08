export const OPEN_TELEMETRY_EXPORTERS = ['none', 'console', 'otlp'] as const;

export type OpenTelemetryExporter = (typeof OPEN_TELEMETRY_EXPORTERS)[number];

export interface OpenTelemetryBuildEnv {
  AGM_OTEL_DEBUG?: string;
  NODE_ENV?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  OTEL_METRICS_EXPORTER?: string;
  OTEL_RESOURCE_ATTRIBUTES?: string;
  OTEL_SDK_DISABLED?: string;
  OTEL_SERVICE_NAME?: string;
  OTEL_TRACES_EXPORTER?: string;
}

export interface OpenTelemetryBuildConfig {
  debug: boolean;
  deploymentEnvironment: string;
  enabled: boolean;
  metricsExporters: OpenTelemetryExporter[];
  otlpEndpoint: string;
  otlpHeaders: Record<string, string>;
  resourceAttributes: Record<string, string>;
  sdkDisabled: boolean;
  serviceName: string;
  tracesExporters: OpenTelemetryExporter[];
}
function parseBooleanFlag(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isOpenTelemetryExporter(value: string): value is OpenTelemetryExporter {
  return OPEN_TELEMETRY_EXPORTERS.includes(value as OpenTelemetryExporter);
}

function parseExporterList(value: string | undefined): OpenTelemetryExporter[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter(isOpenTelemetryExporter);
}

function hasActiveExporter(exporters: OpenTelemetryExporter[]): boolean {
  return exporters.some((exporter) => exporter !== 'none');
}

function parseKeyValueList(value: string | undefined): Record<string, string> {
  const items: Record<string, string> = {};

  for (const item of (value || '').split(',')) {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = item.slice(0, separatorIndex).trim();
    const itemValue = item.slice(separatorIndex + 1).trim();
    if (!key || !itemValue) {
      continue;
    }

    items[key] = decodeURIComponent(itemValue);
  }

  return items;
}

export function createOpenTelemetryBuildConfig(
  env: OpenTelemetryBuildEnv,
): OpenTelemetryBuildConfig {
  const tracesExporters = parseExporterList(env.OTEL_TRACES_EXPORTER);
  const metricsExporters = parseExporterList(env.OTEL_METRICS_EXPORTER);
  const otlpEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT!;
  const sdkDisabled = parseBooleanFlag(env.OTEL_SDK_DISABLED);
  const hasEndpoint = Boolean(otlpEndpoint);
  const hasConfiguredSignal =
    hasEndpoint || hasActiveExporter(tracesExporters) || hasActiveExporter(metricsExporters);
  const enabled = !sdkDisabled && hasConfiguredSignal;

  return {
    debug: env.AGM_OTEL_DEBUG === 'true',
    deploymentEnvironment: env.NODE_ENV || 'production',
    enabled,
    metricsExporters,
    otlpEndpoint,
    otlpHeaders: parseKeyValueList(env.OTEL_EXPORTER_OTLP_HEADERS),
    resourceAttributes: parseKeyValueList(env.OTEL_RESOURCE_ATTRIBUTES),
    sdkDisabled,
    serviceName: env.OTEL_SERVICE_NAME!,
    tracesExporters,
  };
}
