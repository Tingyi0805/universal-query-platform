import test from "node:test";
import assert from "node:assert/strict";
import {coerceRuntimeParameters} from "../dataset/parameter.service.js";
import type {DatasetParameterRecord} from "../dataset/parameter.repository.js";
import {compileQuery} from "../../query/queryCompiler.js";
import {dashboardQueryParameters} from "./dashboardDeviceMasking.js";
// Synthetic OR_001-shaped SQL only; never accesses a hospital or Oracle connection.
for(const [calendar,format,expected] of [["ROC","yyyMMdd","1151010"],["GREGORIAN","yyyyMMdd","20261010"]] as const)test(`OR_001 EXAM_DATE follows saved ${calendar}/${format}, Chinese aliases and named Oracle binds`,()=>{
 const d={name:"EXAM_DATE",label:"手術日期",dataType:"DATE",controlType:"DATE",isRequired:true,defaultValue:null,dateOutputMode:"STRING",dateCalendar:calendar,dateFormat:format} as DatasetParameterRecord;
 const parameters=dashboardQueryParameters({EXAM_DATE:"2026-10-10",deviceColumnMasks:{MRN:"NONE"}});
 const values=coerceRuntimeParameters([d],parameters);
 const query=compileQuery('SELECT 姓名,病歷號 FROM SYNTHETIC_OPERATIONS WHERE 手術日期={{EXAM_DATE}}',"ORACLE",values);
 assert.equal(query.binds.EXAM_DATE,expected);assert.match(query.sql,/:EXAM_DATE/);assert.deepEqual(query.parameterNames,["EXAM_DATE"]);assert.ok(!query.sql.includes(expected));assert.deepEqual(Object.keys(query.binds),["EXAM_DATE"]);
});
