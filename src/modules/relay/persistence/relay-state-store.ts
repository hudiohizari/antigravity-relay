import { z } from "zod";
import { CloudAccountSettingsStore } from "@/modules/cloud-account/persistence/cloud-account-settings-store";

const RELAY_LAST_STATUS_KEY = "relay.last_running_status";
const BooleanSettingSchema = z.boolean();

export class RelayStateStore {
  public static getLastStatus(): boolean {
    return CloudAccountSettingsStore.getSetting(
      RELAY_LAST_STATUS_KEY,
      false,
      BooleanSettingSchema,
    );
  }

  public static setLastStatus(running: boolean): void {
    CloudAccountSettingsStore.setSetting(RELAY_LAST_STATUS_KEY, running);
  }
}
