/** Managed-source Dashboards must pass conversion and policy review before activation. */
export function canCreateDashboardInMode(managementEnabled: boolean, isActive: boolean): boolean {
  return !managementEnabled || !isActive;
}
