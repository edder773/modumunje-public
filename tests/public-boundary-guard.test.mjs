import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const source = new URL('../scripts/check-public-boundary.mjs', import.meta.url);
function withTree(run) {
 const root=mkdtempSync(join(tmpdir(),'public-boundary-'));
 try {
  mkdirSync(join(root,'scripts'));mkdirSync(join(root,'config'));
  copyFileSync(source,join(root,'scripts/check-public-boundary.mjs'));
  writeFileSync(join(root,'config/public-export-policy.json'),JSON.stringify({excludedTests:[],excludedScripts:[]}));
  return run(root);
 } finally {rmSync(root,{recursive:true,force:true});}
}
function check(root){const p=spawnSync(process.execPath,['scripts/check-public-boundary.mjs'],{cwd:root,encoding:'utf8'});return {status:p.status,report:JSON.parse(p.stdout)};}
test('ordinary interface source passes the public boundary',()=>withTree(root=>{
 writeFileSync(join(root,'interface.js'),'export const label="Study";');assert.equal(check(root).status,0);
}));
test('credential-shaped bytes are rejected, including in a binary file',()=>withTree(root=>{
 const credential=['gh','p_','A'.repeat(36)].join('');writeFileSync(join(root,'image.bin'),Buffer.from('\0'+credential+'\0'));
 const result=check(root);assert.equal(result.status,1);assert.equal(result.report.secrets[0].rule,'github-token');
}));
test('forcibly tracked generated files cannot bypass the public guard',()=>withTree(root=>{
 assert.equal(spawnSync('git',['init','--quiet'],{cwd:root}).status,0);
 mkdirSync(join(root,'dist'));writeFileSync(join(root,'dist/private.txt'),'generated output');
 assert.equal(spawnSync('git',['add','--force','dist/private.txt'],{cwd:root}).status,0);
 const result=check(root);assert.equal(result.status,1);assert.ok(result.report.forbiddenPaths.includes('dist/private.txt'));
}));
test('environment files and database archives are rejected',()=>withTree(root=>{
 writeFileSync(join(root,'.env.local'),'SESSION_SECRET=');writeFileSync(join(root,'backup.sqlite'),'synthetic');
 const result=check(root);assert.equal(result.status,1);assert.ok(result.report.forbiddenPaths.includes('.env.local'));assert.ok(result.report.forbiddenPaths.includes('backup.sqlite'));
}));

test('personal contact references cannot enter the public source',()=>withTree(root=>{
 writeFileSync(join(root,'contact.js'),'const contact="'+['person','unverified-mail.com'].join('@')+'";');
 const result=check(root);assert.equal(result.status,1);assert.equal(result.report.personalEmails.length,1);
}));
