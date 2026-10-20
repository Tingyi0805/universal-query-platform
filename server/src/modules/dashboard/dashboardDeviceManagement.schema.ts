import { z } from "zod";
import { isIP } from "node:net";
import { isValidIpOrCidr } from "./dashboardDeviceIp.js";

export const deviceExpectedVersion = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const fields = {
  deviceName: z.string().trim().min(1).max(200),
  enforceIpRestriction: z.boolean(),
  allowedIp: z.string().trim().max(64).nullable(),
  allowedCidr: z.string().trim().max(64).nullable(),
  expiresAtUtc: z.string().datetime().refine(v => Date.parse(v) > Date.now() && Number.isFinite(Date.parse(v))).nullable(),
};
export const deviceMetadataSchema = z.object(fields).strict().superRefine((value, ctx) => {
  if ((value.allowedIp !== null && !isIP(value.allowedIp)) ||
    (value.allowedCidr !== null && (!/^\d+\.\d+\.\d+\.\d+\/\d{1,2}$/.test(value.allowedCidr) || !isValidIpOrCidr(value.allowedCidr))) ||
    (value.enforceIpRestriction ? !value.allowedIp && !value.allowedCidr : value.allowedIp !== null || value.allowedCidr !== null))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "INVALID_IP_BINDING" });
});
export type DeviceMetadata = z.infer<typeof deviceMetadataSchema>;
export const devicePlacementSchema = z.object({
  browser: z.enum(["chrome", "edge"]), screenNumber: z.number().int().min(1).max(16), fullscreen: z.boolean(),
  windowX: z.number().int().min(-32768).max(32768), windowY: z.number().int().min(-32768).max(32768),
  windowWidth: z.number().int().min(200).max(7680), windowHeight: z.number().int().min(200).max(4320),
}).strict();
export type DevicePlacement = z.infer<typeof devicePlacementSchema>;
