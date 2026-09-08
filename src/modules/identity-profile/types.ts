import { z } from 'zod';

export interface DeviceProfile {
  machineId: string;
  macMachineId: string;
  devDeviceId: string;
  sqmId: string;
}

export interface DeviceProfileVersion {
  id: string;
  createdAt: number;
  label: string;
  profile: DeviceProfile;
  isCurrent: boolean;
}

export interface DeviceProfilesSnapshot {
  currentStorage?: DeviceProfile;
  boundProfile?: DeviceProfile;
  history: DeviceProfileVersion[];
  baseline?: DeviceProfile;
}

export const DeviceProfileSchema = z.object({
  machineId: z.string(),
  macMachineId: z.string(),
  devDeviceId: z.string(),
  sqmId: z.string(),
});

export const DeviceProfileVersionSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  label: z.string(),
  profile: DeviceProfileSchema,
  isCurrent: z.boolean(),
});

export const DeviceProfilesSnapshotSchema = z.object({
  currentStorage: DeviceProfileSchema.optional(),
  boundProfile: DeviceProfileSchema.optional(),
  history: z.array(DeviceProfileVersionSchema),
  baseline: DeviceProfileSchema.optional(),
});
