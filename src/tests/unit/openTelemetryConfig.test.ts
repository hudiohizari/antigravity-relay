import { describe, expect, it } from 'vitest';
import { createOpenTelemetryBuildConfig } from '@/shared/observability/openTelemetryConfig';

describe('createOpenTelemetryBuildConfig', () => {
  it('enables otlp exporters when a release endpoint is configured', () => {
    const config = createOpenTelemetryBuildConfig({
      NODE_ENV: 'production',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_TRACES_EXPORTER: 'otlp',
    });

    expect(config).toMatchObject({
      deploymentEnvironment: 'production',
      enabled: true,
      metricsExporters: ['otlp'],
      otlpEndpoint: 'https://otel.example.com',
      tracesExporters: ['otlp'],
    });
  });

  it('lets OTEL_SDK_DISABLED override other enablement signals', () => {
    const config = createOpenTelemetryBuildConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com',
      OTEL_SDK_DISABLED: 'true',
    });

    expect(config.enabled).toBe(false);
    expect(config.sdkDisabled).toBe(true);
  });

  it('drops unknown exporter names instead of passing raw strings to runtime setup', () => {
    const config = createOpenTelemetryBuildConfig({
      OTEL_METRICS_EXPORTER: 'console,unknown',
      OTEL_TRACES_EXPORTER: 'bad,otlp',
    });

    expect(config.metricsExporters).toEqual(['console']);
    expect(config.tracesExporters).toEqual(['otlp']);
    expect(config.enabled).toBe(true);
  });

  it('parses OTLP headers for cloud observability vendors', () => {
    const config = createOpenTelemetryBuildConfig({
      OTEL_EXPORTER_OTLP_HEADERS:
        'api-key=abc,x-honeycomb-team=def,Authorization=Basic%20token,invalid',
    });

    expect(config.otlpHeaders).toEqual({
      Authorization: 'Basic token',
      'api-key': 'abc',
      'x-honeycomb-team': 'def',
    });
  });

  it('parses Grafana onboarding resource attributes', () => {
    const config = createOpenTelemetryBuildConfig({
      OTEL_RESOURCE_ATTRIBUTES:
        'service.namespace=my-application-group,deployment.environment=production',
      OTEL_SERVICE_NAME: 'my-app',
    });

    expect(config.serviceName).toBe('my-app');
    expect(config.resourceAttributes).toEqual({
      'deployment.environment': 'production',
      'service.namespace': 'my-application-group',
    });
  });
});
