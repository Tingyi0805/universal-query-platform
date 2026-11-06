// Windows CI/staging smoke only: no app config, .env, DB connections or OCI initialization.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const runtime={node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch};
assert.deepEqual(runtime,{node:'v24.22.1',abi:'137',platform:'win32',arch:'x64'},'D7_WINDOWS_RUNTIME_REQUIRED');
assert.equal(process.argv.length,3,'EXPLICIT_SERVER_PACKAGE_PATH_REQUIRED');
const require=createRequire(path.resolve(process.argv[2],'package.json'));
assert.equal(typeof require('odbc').connect,'function'); // Loads the real Windows Node-API addon.
const oracle=require('oracledb');
assert.equal(typeof oracle.getConnection,'function');
const native=path.join(path.dirname(require.resolve('oracledb/package.json')),'build','Release',`oracledb-${oracle.versionString}-win32-x64.node`);
assert.equal(typeof require(native).initOracleClient,'function'); // dlopen only; no Oracle Client/DB.
assert.equal(typeof require('mssql').ConnectionPool,'function');
console.log('D7_WINDOWS_NATIVE_LOAD_PASS:'+JSON.stringify({...runtime,napi:process.versions.napi,odbc:require('odbc/package.json').version,oracle:oracle.versionString,scope:'OFFLINE_NO_DB_NO_OCI_INIT'}));
