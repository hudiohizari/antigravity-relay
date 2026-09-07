import { AccountStore } from "../account-store/account-store";
import { ProcessController } from "../process/process-controller";
import { ServiceTarget, GoogleAccount, TokenData } from "../../shared/types";
import {
  AutoSwitchConfig,
  DEFAULT_AUTO_SWITCH_CONFIG,
  SwitchReason,
  SwitchResult,
} from "./types";

export interface SwitchFlowOptions {
  accountStore: AccountStore;
  processController: ProcessController;
  config?: AutoSwitchConfig | (() => AutoSwitchConfig);
  credentialsWriter?: (
    tokens: TokenData,
    account: GoogleAccount,
  ) => Promise<void>;
}

export class SwitchFlow {
  private readonly accountStore: AccountStore;
  private readonly processController: ProcessController;
  private readonly configSupplier: () => AutoSwitchConfig;
  private readonly credentialsWriter?: (
    tokens: TokenData,
    account: GoogleAccount,
  ) => Promise<void>;

  private isSwitching = false;
  private listeners: Set<(result: SwitchResult) => void> = new Set();
  private startListeners: Set<
    (info: { targetAccountId: string; reason: SwitchReason }) => void
  > = new Set();

  constructor(options: SwitchFlowOptions) {
    this.accountStore = options.accountStore;
    this.processController = options.processController;

    if (typeof options.config === "function") {
      this.configSupplier = options.config;
    } else if (options.config) {
      const fixedConfig = options.config;
      this.configSupplier = () => fixedConfig;
    } else {
      this.configSupplier = () => DEFAULT_AUTO_SWITCH_CONFIG;
    }

    this.credentialsWriter = options.credentialsWriter;
  }

  public isInProgress(): boolean {
    return this.isSwitching;
  }

  public onSwitchStart(
    callback: (info: { targetAccountId: string; reason: SwitchReason }) => void,
  ): () => void {
    this.startListeners.add(callback);
    return () => {
      this.startListeners.delete(callback);
    };
  }

  public onSwitchEvent(callback: (result: SwitchResult) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(result: SwitchResult): void {
    for (const listener of this.listeners) {
      try {
        listener(result);
      } catch {
        // Suppress listener error
      }
    }
  }

  private notifyStartListeners(info: {
    targetAccountId: string;
    reason: SwitchReason;
  }): void {
    for (const listener of this.startListeners) {
      try {
        listener(info);
      } catch {
        // Suppress listener error
      }
    }
  }

  public async executeSwitch(
    targetAccountId: string,
    reason: SwitchReason,
  ): Promise<SwitchResult> {
    if (this.isSwitching) {
      throw new Error(
        "ALREADY_IN_PROGRESS: Another account switch is currently executing",
      );
    }

    this.isSwitching = true;
    const startTime = Date.now();
    let previousAccountId: string | null = null;
    const restartedProcesses: ServiceTarget[] = [];
    this.notifyStartListeners({ targetAccountId, reason });

    try {
      const currentActive = await this.accountStore.getActive();
      previousAccountId = currentActive?.id ?? null;

      const targetAccount = await this.accountStore.get(targetAccountId);
      if (!targetAccount) {
        throw new Error(`Target account not found with ID ${targetAccountId}`);
      }

      const statusBefore = await this.processController.getStatus();
      const daemonWasRunning =
        statusBefore.services.antigravity_daemon.state === "running";
      const ideWasRunning =
        statusBefore.services.antigravity_ide.state === "running";

      // 1. Gracefully stop running processes
      if (daemonWasRunning) {
        const stopDaemon =
          await this.processController.stopService("antigravity_daemon");
        if (stopDaemon.state === "error") {
          throw new Error(
            `Failed to stop antigravity_daemon: ${stopDaemon.errorMessage}`,
          );
        }
      }

      if (ideWasRunning) {
        const stopIde =
          await this.processController.stopService("antigravity_ide");
        if (stopIde.state === "error") {
          throw new Error(
            `Failed to stop antigravity_ide: ${stopIde.errorMessage}`,
          );
        }
      }

      // 2. Swap active account in AccountStore
      await this.accountStore.setActive(targetAccountId);

      // 3. Optional credentials writer for local Antigravity config
      if (this.credentialsWriter) {
        await this.credentialsWriter(targetAccount.tokens, targetAccount);
      }

      // 4. Relaunch previously running services if auto-relaunch is enabled
      const config = this.configSupplier();
      if (config.autoRelaunchProcesses) {
        if (daemonWasRunning) {
          const startDaemon =
            await this.processController.startService("antigravity_daemon");
          if (startDaemon.state === "running") {
            restartedProcesses.push("antigravity_daemon");
          } else {
            throw new Error(
              `Failed to relaunch antigravity_daemon: ${startDaemon.errorMessage}`,
            );
          }
        }

        if (ideWasRunning) {
          const startIde =
            await this.processController.startService("antigravity_ide");
          if (startIde.state === "running") {
            restartedProcesses.push("antigravity_ide");
          } else {
            throw new Error(
              `Failed to relaunch antigravity_ide: ${startIde.errorMessage}`,
            );
          }
        }
      }

      const result: SwitchResult = {
        success: true,
        previousAccountId,
        newAccountId: targetAccountId,
        newAccountEmail: targetAccount.email,
        reason,
        restartedProcesses,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      };

      this.notifyListeners(result);
      return result;
    } catch (err) {
      // Rollback to previous active account if possible
      if (previousAccountId) {
        try {
          await this.accountStore.setActive(previousAccountId);
        } catch {
          // Suppress rollback error
        }
      }

      const failureResult: SwitchResult = {
        success: false,
        previousAccountId,
        newAccountId: targetAccountId,
        newAccountEmail: "",
        reason,
        restartedProcesses,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        error: (err as Error).message,
      };

      this.notifyListeners(failureResult);
      throw err;
    } finally {
      this.isSwitching = false;
    }
  }
}
