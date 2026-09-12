import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import type { DeviceProfile } from "@/modules/identity-profile/types";
import { logger } from "@/shared/logging/logger";
import {
  getAntigravityExecutablePath,
  refreshAntigravityProcessCache,
  rememberRunningExecutablePath,
} from "@/shared/platform/paths";
import {
  closeAntigravity,
  isProcessRunning,
  startAntigravity,
  _waitForProcessExit,
} from "@/modules/antigravity-runtime/ipc/handler";
import {
  applyDeviceProfile,
  syncTelemetryServiceMachineIdValue,
} from "@/modules/identity-profile/ipc/handler";
import {
  type SwitchFailureReason,
  recordSwitchFailure,
  recordSwitchSuccess,
} from "@/modules/antigravity-runtime/switch/switchMetrics";
import { withTimingTrace } from "@/shared/observability/timingTrace";
import { ConfigManager } from "@/modules/config/ipc/manager";
import { checkpointStateDatabases } from "@/modules/chat-resume/walCheckpoint";
import { captureAndBufferActiveTurn } from "@/modules/chat-resume/activeTurnDetector";
import { chatResumeDispatcher } from "@/modules/chat-resume/ChatResumeDispatcher";
import type {
  ActiveTurnSnapshot,
  ChatResumeSwitchSource,
} from "@/modules/chat-resume/types";

export interface SwitchFlowOptions {
  scope: "local" | "cloud";
  targetProfile: DeviceProfile | null;
  appTarget?: AntigravityAppTarget;
  applyFingerprint: boolean;
  useCredentialStore: boolean;
  processExitTimeoutMs: number;
  skipRefreshProcessCache?: boolean;
  performSwitch: () => Promise<void>;
  afterSwitchSuccess?: () => Promise<void>;
  accountEmail?: string;
  source?: ChatResumeSwitchSource;
  activeTurnDetector?: (
    target: AntigravityAppTarget,
  ) => Promise<ActiveTurnSnapshot | null>;
  walCheckpoint?: (target: AntigravityAppTarget) => Promise<unknown>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function applyDeviceProfileBestEffort(
  profile: DeviceProfile | null,
  appTarget: AntigravityAppTarget | undefined,
): void {
  if (!profile) {
    return;
  }

  try {
    applyDeviceProfile(profile, appTarget);
  } catch (error) {
    logger.warn(
      "Skipping device profile apply because credential-store-backed targets do not require storage.json",
      error,
    );
  }
}

function syncTelemetryServiceMachineIdBestEffort(
  profile: DeviceProfile | null,
  appTarget: AntigravityAppTarget | undefined,
): void {
  if (!profile) {
    return;
  }

  try {
    syncTelemetryServiceMachineIdValue(
      profile.macMachineId,
      undefined,
      appTarget,
    );
  } catch (error) {
    logger.warn(
      "Skipping telemetry.serviceMachineId sync after SQLite token injection",
      error,
    );
  }
}

function toSwitchFailureReason(
  stage: string,
  error: unknown,
): SwitchFailureReason {
  if (stage === "close") {
    return "process_close_failed";
  }
  if (stage === "missing_profile") {
    return "missing_bound_profile";
  }
  if (stage === "apply") {
    return "apply_device_profile_failed";
  }
  if (stage === "switch") {
    return "perform_switch_failed";
  }
  if (stage === "start") {
    return "start_process_failed";
  }

  // Keep legacy compatibility with reason encoded in thrown errors.
  if (
    error instanceof Error &&
    error.message.includes("missing bound device profile")
  ) {
    return "missing_bound_profile";
  }
  if (error instanceof Error && error.message.includes("device_apply_failed")) {
    return "apply_device_profile_failed";
  }
  return "unknown";
}

export interface SwitchFlowResult {
  target: AntigravityAppTarget;
  wasRunning: boolean;
  restarted: boolean;
}

export async function executeSwitchFlow(
  options: SwitchFlowOptions,
): Promise<SwitchFlowResult> {
  const {
    scope,
    appTarget,
    targetProfile,
    applyFingerprint,
    useCredentialStore,
    processExitTimeoutMs,
    skipRefreshProcessCache = false,
    performSwitch,
    afterSwitchSuccess,
  } = options;

  let failureReason: SwitchFailureReason | null = null;
  let waitExitTimedOut = false;
  let stage = "close";
  const isCliTarget = appTarget === "cli" || appTarget === "agy";
  let flowResult: SwitchFlowResult = {
    target: appTarget || "app",
    wasRunning: false,
    restarted: false,
  };

  await withTimingTrace(
    "switch.execute",
    {
      scope,
      appTarget: appTarget || "app",
      processExitTimeoutMs,
    },
    async (trace) => {
      try {
        if (isCliTarget) {
          logger.info("Skipping GUI process steps for CLI switch");
          stage = "switch";
          await trace.phase("performSwitchMs", performSwitch);
          if (applyFingerprint) {
            stage = "apply";
            trace.phaseSync("applyProfileMs", () => {
              applyDeviceProfileBestEffort(targetProfile, appTarget);
            });
          }
          if (afterSwitchSuccess) {
            stage = "after_success";
            await trace.phase("afterSwitchSuccessMs", afterSwitchSuccess);
          }
          recordSwitchSuccess(scope);
          flowResult = {
            target: appTarget || "cli",
            wasRunning: false,
            restarted: false,
          };
          return;
        }

        if (!skipRefreshProcessCache) {
          await trace.phase("refreshProcessCacheMs", async () => {
            await refreshAntigravityProcessCache(appTarget);
          });
        }

        const isRunning = await trace.phase("isProcessRunningMs", async () =>
          isProcessRunning(appTarget),
        );
        const wasRunning = Boolean(isRunning);
        if (wasRunning) {
          const preResolvedExecutablePath =
            getAntigravityExecutablePath(appTarget);
          if (preResolvedExecutablePath) {
            rememberRunningExecutablePath(appTarget, preResolvedExecutablePath);
          }

          if (!isCliTarget) {
            let autoResumeEnabled = true;
            try {
              const config = ConfigManager.loadConfig();
              autoResumeEnabled = config.auto_resume_active_chat !== false;
            } catch (cfgErr) {
              logger.warn(
                "Failed to read auto_resume_active_chat config, defaulting to true",
                cfgErr,
              );
            }

            try {
              await trace.phase("walCheckpointMs", async () => {
                if (options.walCheckpoint) {
                  await options.walCheckpoint(appTarget || "app");
                } else {
                  await checkpointStateDatabases(appTarget);
                }
              });
            } catch (walErr) {
              logger.warn(
                "Pre-kill WAL checkpoint encountered an error, proceeding with switch",
                walErr,
              );
            }

            if (autoResumeEnabled) {
              try {
                await trace.phase("captureActiveTurnMs", async () => {
                  const switchSource =
                    options.source === "auto_switch"
                      ? "auto_switch"
                      : "manual_switch";

                  await captureAndBufferActiveTurn(appTarget, {
                    source: switchSource,
                    accountEmail: options.accountEmail,
                    customDetector: options.activeTurnDetector,
                  });
                });
              } catch (snapErr) {
                logger.warn(
                  "Pre-kill active turn capture encountered an error, proceeding with switch",
                  snapErr,
                );
              }
            }
          }

          await trace.phase("closeMs", async () => {
            await closeAntigravity(appTarget);
          });
          try {
            await trace.phase("waitExitMs", async () => {
              await _waitForProcessExit(processExitTimeoutMs, 100, appTarget);
            });
          } catch (error) {
            waitExitTimedOut = true;
            logger.warn(
              "Process did not exit cleanly within timeout, but proceeding...",
              error,
            );
          }
        }

        if (useCredentialStore) {
          stage = "switch";
          await trace.phase("performSwitchMs", performSwitch);
          if (applyFingerprint) {
            stage = "apply";
            if (!targetProfile) {
              stage = "missing_profile";
              throw new Error("Account has no bound identity profile");
            }
            trace.phaseSync("applyProfileMs", () => {
              applyDeviceProfile(targetProfile, appTarget);
            });
          }
        } else {
          if (applyFingerprint) {
            stage = "apply";
            if (!targetProfile) {
              stage = "missing_profile";
              throw new Error("Account has no bound identity profile");
            }
            trace.phaseSync("applyProfileMs", () => {
              applyDeviceProfile(targetProfile, appTarget);
            });
          } else if (!applyFingerprint) {
            logger.warn(
              "Identity profile apply is disabled by CRACK_IDENTITY_PROFILE_APPLY_ENABLED / CRACK_DEVICE_FINGERPRINT_ENABLED",
            );
          }

          stage = "switch";
          await trace.phase("performSwitchMs", performSwitch);
          if (applyFingerprint) {
            trace.phaseSync("syncTelemetryServiceMachineIdMs", () => {
              syncTelemetryServiceMachineIdBestEffort(targetProfile, appTarget);
            });
          }
        }

        if (wasRunning) {
          stage = "start";
          await trace.phase("startMs", async () => {
            await startAntigravity(appTarget);
          });

          if (!isCliTarget) {
            try {
              const config = ConfigManager.loadConfig();
              if (config.auto_resume_active_chat !== false) {
                chatResumeDispatcher
                  .triggerResumptionForTarget(appTarget || "app", {
                    accountEmail: options.accountEmail,
                  })
                  .catch((dispatchErr) => {
                    logger.warn(
                      "Autonomous chat resumption failed in background",
                      dispatchErr,
                    );
                  });
              }
            } catch (err) {
              logger.warn(
                "Failed to check chat resumption config after restart",
                err,
              );
            }
          }
        } else {
          logger.info(
            `Skipping process launch for ${appTarget}: application was not running prior to switch`,
          );
        }

        if (afterSwitchSuccess) {
          stage = "after_success";
          await trace.phase("afterSwitchSuccessMs", afterSwitchSuccess);
        }
        recordSwitchSuccess(scope);
        flowResult = {
          target: appTarget || "classic",
          wasRunning,
          restarted: wasRunning,
        };
      } catch (error) {
        const reason = toSwitchFailureReason(stage, error);
        const message = getErrorMessage(error);
        failureReason = reason;
        recordSwitchFailure(scope, reason, message);
        throw error;
      }
    },
    () => ({
      stage,
      waitExitTimedOut,
      failureReason,
    }),
  );

  return flowResult;
}
