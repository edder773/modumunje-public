#!/usr/bin/env node
/** Dependency-free public export checks; runs before installation in CI. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'config/public-export-policy.json'), 'utf8'));
const exceptionPath = path.join(root, 'config/public-content-scan-exceptions.json');
const exceptions = fs.existsSync(exceptionPath) ? JSON.parse(fs.readFileSync(exceptionPath, 'utf8')) : {};
const ignored = new Set(['.git', 'node_modules', 'dist', '.next', '.vinext', '.wrangler', '.sites-runtime', 'coverage', 'playwright-report', 'test-results', '.ci-artifacts']);
const denyExact = new Set([...policy.excludedTests, ...policy.excludedScripts, 'AGENTS.md']);
function walk(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    if (!prefix && (ignored.has(entry.name) || entry.name.endsWith('.tsbuildinfo') || entry.name === 'next-env.d.ts')) return [];
    const p = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error('Unexpected symlink: ' + p);
    return entry.isDirectory() ? walk(path.join(dir, entry.name), p + '/') : [p];
  });
}
const deniedPath = p => /^(?:dist|node_modules|coverage|playwright-report|test-results|\.ci-artifacts|\.next|\.wrangler|\.sites-runtime)(?:\/|$)/.test(p) || /\.(?:zip|tgz|tar|7z|sqlite|sqlite3|db|pem|key)$/i.test(p) || denyExact.has(p) || p.startsWith('scripts/public-export/')
  || /^(?:\.internal|\.openai|docs|artifacts)(?:\/|$)/.test(p)
  || /^(?:apps\/backend\/resources\/(?:content|database|private-diagrams)|tools\/ipe-question-generation)(?:\/|$)/.test(p)
  || /^apps\/frontend\/public\/(?:content|assets|learning-assets)\//.test(p)
  || /server-(?:question|theory)-bank\.mjs$|private-diagrams.*generated|apps\/backend\/resources\/.*answer.*\.json$/.test(p)
  || /^\.github\/workflows\//.test(p) && !/^\.github\/workflows\/(?:ci|security)\.yml$/.test(p)
  || /(?:^|\/)\.env(?:\.|$)/.test(p) && p !== '.env.example';
const secrets = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['openai-token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{24,}\b/],
  ['google-oauth-secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{35}\b/],
  ['bearer-jwt', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/],
  ['credential-url', /https?:\/\/[^\s/:@]+:[^\s/@]{8,}@(?!example\.)/],
];
const findings = { forbiddenPaths: [], secrets: [], personalEmails: [], contentHeuristicMatches: [], reviewedSourceExceptions: [], unresolvedContent: [], staleExceptions: [] };
let tracked = [];
try {
  const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (fs.realpathSync(top) === fs.realpathSync(root)) tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
} catch {}
const files = [...new Set([...walk(root), ...tracked])].sort();
for (const p of files) {
  if (deniedPath(p)) findings.forbiddenPaths.push(p);
  const filename = path.join(root, p);
  if (!fs.existsSync(filename)) continue;
  if (fs.lstatSync(filename).isSymbolicLink()) throw Error('Unexpected tracked symlink: ' + p);
  const data = fs.readFileSync(filename);
  const text = data.toString('utf8');
  for (const [rule, pattern] of secrets) if (pattern.test(text)) findings.secrets.push({ path: p, rule });
  const normalizedText = text.replace(/\\+\./gu, '.');
  const addresses = [...normalizedText.matchAll(/\b[A-Za-z0-9_.+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/gu)];
  if (addresses.some(([, domain]) => !/^(?:example\.(?:com|org|net)|[^.]+(?:\.[^.]+)*\.(?:invalid|test|local))$/iu.test(domain))) findings.personalEmails.push({ path: p, rule: 'non-placeholder-email' });
  const hangul = (text.match(/[가-힣]/g) ?? []).length;
  if (hangul >= 300 && /(?:["']?(?:answer|correct)["']?\s*:)/i.test(text)) {
    const hash = createHash('sha256').update(data).digest('hex');
    const item = { path: p, hangul, sha256: hash };
    findings.contentHeuristicMatches.push(item);
    const allowed = exceptions[p];
    if (allowed?.sha256 === hash && typeof allowed.reason === 'string' && allowed.reason.length > 20) findings.reviewedSourceExceptions.push({ ...item, reason: allowed.reason });
    else findings.unresolvedContent.push(item);
  }
}
for (const [p, exception] of Object.entries(exceptions)) {
  if (!files.includes(p) || !findings.contentHeuristicMatches.some(f => f.path === p && f.sha256 === exception.sha256)) findings.staleExceptions.push(p);
}
const passed = findings.forbiddenPaths.length === 0 && findings.secrets.length === 0 && findings.personalEmails.length === 0 && findings.unresolvedContent.length === 0 && findings.staleExceptions.length === 0;
console.log(JSON.stringify({ result: passed ? 'pass' : 'fail', fileCount: files.length, ...findings }, null, 2));
if (!passed) process.exitCode = 1;
