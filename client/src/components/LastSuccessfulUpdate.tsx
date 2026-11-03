import { formatDeliveryTime, updateSettings } from "../dashboard/lastSuccessfulUpdate";
import "./LastSuccessfulUpdate.css";
export function LastSuccessfulUpdate({at,config}:{at:unknown;config?:Record<string,unknown>}) {
 const settings=updateSettings(config);
 return <div className="uqp-last-success" role="status" data-position={settings.position}>PRIMARY 最後成功更新：{formatDeliveryTime(at,settings.format)}（Asia/Taipei）</div>;
}
