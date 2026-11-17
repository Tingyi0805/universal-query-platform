// Targeted CI applies ONLY to this isolated branch and frozen successful PR83 baseline.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const baseline='846483f6b1151eb12468d60369745fe77f0249b7';
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
git('merge-base','--is-ancestor',baseline,'HEAD');
const allow=[/^server\/src\/modules\/queryDefinition\/queryHierarchy[.].*\.ts$/,/^server\/src\/modules\/dataset\/datasetPaging[.].*\.ts$/,
 /^client\/src\/queryHierarchy\//,/^client\/e2e\/query-hierarchy\.spec\.ts$/,/^docs\/mobile-query-phase2\.md$/,
 /^database\/review\/929_query_hierarchy\.sql\.txt$/,/^tools\/validate-mobile-query-phase2-scope\.mjs$/,
 /^\.github\/workflows\/(?:ci|mobile-query-phase2)\.yml$/];
const exact=new Set(['server/src/app.ts','client/src/api/client.ts','client/src/pages/QueryRuntimePage.tsx','client/src/pages/QueryPublisherPage.tsx']);
const files=git('diff','--name-only',baseline,'HEAD').split('\n').filter(Boolean);
if(files.some(p=>!exact.has(p)&&!allow.some(r=>r.test(p))))throw Error('PHASE2_SCOPE_REQUIRES_REVIEW');
const frozen=['server/src/modules/queryDefinition/queryDelivery.ts','server/src/modules/auth/auth.middleware.ts',
 'server/src/modules/auth/workstationSession.repository.ts','server/src/modules/auth/workstationPin.routes.ts','server/src/modules/auth/workstationPinState.repository.ts',
 'server/src/modules/auth/workstationQuery.routes.ts','server/src/modules/queryDefinition/pinQueryPolicy.ts','server/src/modules/dataset/datasetDeliveryPolicy.ts',
 'server/src/modules/dataset/datasetDeliveryPolicy.repository.ts','server/src/query/queryCompiler.ts','server/src/modules/dataset/parameter.service.ts',
 'server/src/modules/audit/audit.repository.ts','database/migrations/927_workstation_pin_runtime.sql','server/src/config/env.ts',
 'server/package.json','server/package-lock.json','client/package.json','client/package-lock.json'];
git('diff','--exit-code',baseline,'HEAD','--',...frozen);
if(!/WORKSTATION_PIN_RUNTIME: envBoolean\(false\)/.test(readFileSync('server/src/config/env.ts','utf8')))throw Error('PIN_RUNTIME_DEFAULT_MUST_STAY_OFF');
if(files.some(p=>p.startsWith('database/migrations/')||/928|CHART|Chart/.test(p)))throw Error('PHASE2_NO_CHART_OR_AUTOMATIC_MIGRATION');
console.log('PHASE2_FROZEN_PR83_BASELINE_AND_TARGETED_SCOPE_PASS:'+baseline+':files='+files.length);
