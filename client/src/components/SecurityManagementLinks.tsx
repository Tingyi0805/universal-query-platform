import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
export function SecurityManagementLinks({ datasetId, dashboardId }: { datasetId?: number | null; dashboardId?: number | null }) {
  const { hasPermission } = useAuth();
  if (!hasPermission("DESIGN_QUERY")) return null;
  return <nav aria-label="安全設定入口">
    <Link to={datasetId ? `/designer/datasets?datasetId=${datasetId}#patient-audit-settings` : "/designer/datasets#patient-audit-settings"}>Dataset 稽核設定</Link>
    {" · "}<Link to={dashboardId ? `/designer/dashboards?dashboardId=${dashboardId}#column-approvals` : "/designer/dashboards#column-approvals"}>Dashboard 核准管理</Link>
  </nav>;
}
