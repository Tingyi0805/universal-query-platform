import {useEffect,useState} from "react";
import {Link} from "react-router-dom";
import {apiRequest} from "../api/client";
import {templateSuggestion,type MaskTemplate} from "../dashboard/maskTemplates";
export function DatasetMaskTemplateSuggestion({column,accessToken,disabled,onApply}:{column:string;accessToken:string|null;disabled:boolean;onApply:(t:MaskTemplate)=>void}){
 const [templates,setTemplates]=useState<MaskTemplate[]>([]),[message,setMessage]=useState("");
 useEffect(()=>{let active=true;void apiRequest<{templates:MaskTemplate[]}>("/dataset-mask-templates",{},accessToken).then(r=>{if(!Array.isArray(r.templates))throw new Error("TEMPLATES_INVALID");if(active)setTemplates(r.templates);}).catch(()=>{if(active)setMessage("範本未啟用或尚無可用 Schema；仍可手動設定，不會自動套用預設範本。");});return()=>{active=false;};},[accessToken]);
 const match=templateSuggestion(column,templates);
 return <div aria-label="敏感欄位範本建議">{match&&<><p>系統建議：{match.template.name}（{match.kind==="EXACT"?"名稱完全符合":"明確別名"}，僅建議，未儲存／未公開）</p><button type="button" disabled={disabled} onClick={()=>onApply(match.template)}>使用建議遮蔽</button></>}
  {column&&!match&&templates.length>0&&<p>沒有唯一精確建議；相似欄名僅供人工檢查，不自動分類或核准。</p>}
  <label>選擇範本<select value="" disabled={disabled||!column} onChange={e=>{const t=templates.find(t=>t.id===e.target.value);if(t?.isActive)onApply(t);}}><option value="">手動選擇後套用至草稿</option>{templates.filter(t=>t.isActive).map(t=><option key={t.id} value={t.id}>{t.name}（版本 {t.revision}）</option>)}</select></label>
  {message&&<p role="status">{message}</p>}<Link to="/admin/mask-templates">敏感欄位範本管理</Link>
 </div>;
}
