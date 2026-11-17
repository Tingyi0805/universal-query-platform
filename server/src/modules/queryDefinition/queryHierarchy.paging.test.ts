import test from 'node:test';
import assert from 'node:assert/strict';
import {hierarchyFixture} from './queryHierarchy.testFixture.js';
test('unchanged page uses the original source witness; undeclared source drift clears the context',async()=>{
 const f=hierarchyFixture(),first=await f.service.create(1,'actor',{},f.identity,f.meta) as any;
 const original=f.deps.page;f.deps.page=async(...args)=>({...await original(...args),sourceWitness:'4:'+'e'.repeat(64)});
 await assert.rejects(f.service.act(1,first.contextId,'actor',f.identity,{kind:'PAGE',controls:{page:2,search:null,sort:null}},f.meta),/SOURCE_PAGE_CHANGED/);
 await assert.rejects(f.service.act(1,first.contextId,'actor',f.identity,{kind:'BACK'},f.meta),/CONTEXT_NOT_FOUND/);
});
test('unsupported/absent source witness cannot produce a hierarchical delivery',async()=>{
 const f=hierarchyFixture(),original=f.deps.page;f.deps.page=async(...args)=>({...await original(...args),sourceWitness:undefined as any});
 await assert.rejects(f.service.create(1,'actor',{},f.identity,f.meta),/PAGING_WITNESS_REQUIRED/);
 assert.equal(f.state.successes,0);
});
