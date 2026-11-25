import { DatasetDeliverySnapshotError, type ConfirmedDatasetDeliverySnapshot } from "./datasetDeliveryPolicy.repository.js";

/** Advisory display state only; never grants preview authority or changes policy. */
export type DatasetPreviewSafetyState = Readonly<{
  status: "BLOCKED" | "POLICY_CONFIRMED";
  code: "USAGE_NOT_APPROVED" | "POLICY_UNCONFIRMED" | "POLICY_INVALID" | "POLICY_UNAVAILABLE"
    | "PATIENT_AUDIT_UNCONFIRMED" | "POLICY_CONFIRMED";
  message: string;
}>;

export async function resolveDatasetPreviewSafety(
  active: boolean,
  load: () => Promise<ConfirmedDatasetDeliverySnapshot>,
): Promise<DatasetPreviewSafetyState> {
  if (!active) return {
    status: "BLOCKED", code: "USAGE_NOT_APPROVED",
    message: "尚未核准使用，不能執行資料預覽；欄位候選探索不受此限制。",
  };
  try {
    // Existing Server-side SERIALIZABLE snapshot verification is authoritative.
    // A policy version here is *not* a patient classification, a playback grant,
    // or evidence that the next execution has already passed its live checks.
    const snapshot = await load();
    if (snapshot.patientAudit.enabled && !snapshot.patientAudit.configured) {
      return { status: "BLOCKED", code: "PATIENT_AUDIT_UNCONFIRMED",
        message: "患者揭露稽核尚未確認，預覽維持禁止；請由管理者完成可信欄位與稽核審查。" };
    }
    return { status: "POLICY_CONFIRMED", code: "POLICY_CONFIRMED",
      message: "欄位保護政策已確認。預覽仍須在執行時重新驗證權限、資料來源、患者稽核、版本與操作紀錄，不能保證交付成功。" };
  } catch (e) {
    if (e instanceof DatasetDeliverySnapshotError) {
      if (e.code === "DATASET_DELIVERY_POLICY_UNCONFIRMED") {
        return { status: "BLOCKED", code: "POLICY_UNCONFIRMED",
          message: "系統尚未確認有效的資料保護政策，預覽維持禁止；管理者僅核准使用，不必逐欄設定。安全條件未就緒時不交付資料。" };
      }
      if (e.code === "DATASET_DELIVERY_POLICY_INVALID" || e.code === "DATASET_DELIVERY_VERSION_CONFLICT") {
        return { status: "BLOCKED", code: "POLICY_INVALID",
          message: "欄位政策無效或版本已異動，須重新完成安全審查；不得以空政策自動放行。" };
      }
    }
    return { status: "BLOCKED", code: "POLICY_UNAVAILABLE",
      message: "尚無法完成預覽政策安全檢查，資料維持拒絕；請管理者依 Request ID 查核服務。" };
  }
}
