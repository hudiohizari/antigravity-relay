import { z } from "zod";

export const CanonicalAntigravityAppTargetSchema = z.enum([
  "app",
  "ide",
  "cli",
]);
export type CanonicalAntigravityAppTarget = z.infer<
  typeof CanonicalAntigravityAppTargetSchema
>;

export const AntigravityAppTargetSchema = Object.assign(
  z.preprocess((val) => {
    if (val === "classic") return "app";
    if (val === "agy") return "cli";
    return val;
  }, CanonicalAntigravityAppTargetSchema),
  {
    options: CanonicalAntigravityAppTargetSchema.options,
  },
);

export type LegacyAntigravityAppTarget = "classic" | "agy";
export type AntigravityAppTarget =
  CanonicalAntigravityAppTarget | LegacyAntigravityAppTarget;

export function resolveAntigravityAppTarget(
  target?: AntigravityAppTarget | string | null,
): CanonicalAntigravityAppTarget {
  const parsed = AntigravityAppTargetSchema.safeParse(target);
  if (parsed.success) {
    return parsed.data;
  }
  return "app";
}
