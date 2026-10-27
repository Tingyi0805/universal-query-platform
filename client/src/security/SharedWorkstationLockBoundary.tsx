import React, { useSyncExternalStore, type ReactNode } from "react";
import type { SharedWorkstationSafetyController } from "./sharedWorkstationSession";

export function SharedWorkstationLockBoundary({
  controller,
  children,
}: Readonly<{ controller: SharedWorkstationSafetyController; children: ReactNode }>) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  if (state.status === "OPERATOR_ACTIVE") return <>{children}</>;
  return (
    <section role="alert" aria-live="assertive" data-workstation-state={state.status}>
      <h1>{state.status === "DEVICE_REVOKED" ? "工作站已停用" : "工作站已鎖定"}</h1>
      <p>畫面中的操作員資料已清除。請使用正式重新驗證流程後繼續。</p>
    </section>
  );
}
