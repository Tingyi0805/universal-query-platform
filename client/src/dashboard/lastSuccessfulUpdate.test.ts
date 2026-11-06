import test from "node:test";
import assert from "node:assert/strict";
import {deliveryTime,formatDeliveryTime,updatePositions,updateSettings} from "./lastSuccessfulUpdate";
test("delivery time uses server UTC in Taipei including cross-day; invalid or absent evidence never invents browser time",()=>{
 assert.equal(formatDeliveryTime("2026-11-02T16:01:02.000Z","DATE_TIME"),"2026-11-03 00:01:02");
 assert.equal(formatDeliveryTime("2026-11-02T16:01:02Z","TIME"),"00:01:02");
 for(const value of [null,undefined,"bad","2026-02-30T00:00:00Z","2026-11-03 12:01:02",Date.now()]){assert.equal(deliveryTime(value),null);assert.equal(formatDeliveryTime(value,"TIME"),"尚無後端交付時間");}
});
test("backward-compatible defaults, four positions and safe format",()=>{
 assert.deepEqual(updateSettings(),{position:"BOTTOM_RIGHT",format:"TIME"});
 for(const position of Object.keys(updatePositions))assert.equal(updateSettings({lastSuccessPosition:position}).position,position);
 assert.deepEqual(updateSettings({lastSuccessPosition:"<script>",lastSuccessFormat:"bad"}),{position:"BOTTOM_RIGHT",format:"TIME"});
});
