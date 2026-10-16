import { z } from "zod";
export const positiveId = z.number().int().positive().safe();
export const strictIds = (limit: number) =>
  z
    .array(positiveId)
    .max(limit)
    .refine((ids) => new Set(ids).size === ids.length);
export const grantSchema = z
  .object({
    userIds: strictIds(500),
    departmentIds: strictIds(100),
    groupIds: strictIds(100),
    expectedVersion: positiveId,
  })
  .strict();
export const metadataSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    purposeCode: z.enum(["SHARED_QUERY", "DASHBOARD"]),
    sortOrder: z.number().int().min(0).max(10000),
    isActive: z.boolean(),
    expectedVersion: positiveId,
  })
  .strict();
export type Grants = Pick<
  z.infer<typeof grantSchema>,
  "userIds" | "departmentIds" | "groupIds"
>;
export type Audience = {
  id: number;
  kind: "DEPARTMENT" | "GROUP";
  isActive: boolean;
  userIds: number[];
};
export function effectiveWorkstationUsers(
  grants: Grants,
  audiences: Audience[],
  activeUserIds: number[],
): number[] {
  const active = new Set(activeUserIds);
  const ids = new Set(grants.userIds);
  for (const audience of audiences)
    if (
      audience.isActive &&
      (audience.kind === "DEPARTMENT"
        ? grants.departmentIds
        : grants.groupIds
      ).includes(audience.id)
    ) {
      for (const id of audience.userIds) ids.add(id);
    }
  return [...ids].filter((id) => active.has(id)).sort((a, b) => a - b);
}
export function canDeleteUnusedWorkstation(row: {
  isActive: boolean;
  retired: boolean;
  lastUsed: unknown;
  credentials: number;
  sessions: number;
  disclosures: number;
  devices: number;
}) {
  return (
    !row.isActive &&
    !row.retired &&
    !row.lastUsed &&
    row.credentials === 0 &&
    row.sessions === 0 &&
    row.disclosures === 0 &&
    row.devices === 0
  );
}
