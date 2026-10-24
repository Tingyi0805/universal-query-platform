import {applyDatasetDeliveryPolicy,DatasetDeliveryPolicyError} from "./datasetDeliveryPolicy.js";
import type {DatasetSensitiveColumn} from "./datasetSensitiveColumn.repository.js";
/** Reuse Query/Excel's invariant: an explicitly configured audit-only key stays OMIT. */
export function assertDatasetAuditOnlyPolicy(sensitivity:{version:number;columns:DatasetSensitiveColumn[]},patientKey:unknown){
 if(patientKey!=null&&(typeof patientKey!=="string"||!patientKey||patientKey.trim()!==patientKey))throw new DatasetDeliveryPolicyError("DATASET_DELIVERY_POLICY_INVALID");
 applyDatasetDeliveryPolicy({policy:{state:"CONFIRMED",version:String(sensitivity.version),rules:sensitivity.columns.map(r=>({columnName:r.columnName,mode:r.deviceMaskMode,customMask:r.customMask})),patientAuditOnlyColumns:patientKey?[patientKey as string]:[]},columns:[],rows:[]});
}
