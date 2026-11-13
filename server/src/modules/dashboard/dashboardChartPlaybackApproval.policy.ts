// Gate 3: exact-version administrator playback approval policy.
// Pure fail-closed predicate; the server must supply these facts from trusted
// repositories, never from widget ConfigJson or an HTTP request body.
export type ChartPlaybackApproval = Readonly<{
  widgetId: number;
  widgetRevision: string;
  configDigest: string;
  reviewerUserId: number;
  auditLogId: string;
  status: "APPROVED" | "REVOKED";
}>;

export function isChartPlaybackApproved(
  approval: ChartPlaybackApproval | null,
  widgetId: number,
  widgetRevision: string,
  configDigest: string,
): boolean {
  return approval !== null &&
    approval.status === "APPROVED" &&
    Number.isSafeInteger(widgetId) && widgetId > 0 &&
    approval.widgetId === widgetId &&
    /^[a-f0-9]{16}$/.test(widgetRevision) &&
    approval.widgetRevision === widgetRevision &&
    /^[a-f0-9]{64}$/.test(configDigest) &&
    approval.configDigest === configDigest &&
    Number.isSafeInteger(approval.reviewerUserId) &&
    approval.reviewerUserId > 0 &&
    /^(?:[1-9][0-9]{0,18})$/.test(approval.auditLogId);
}
