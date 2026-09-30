import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createSessionEpoch } from "../packages/shared/src/runtime/session-epoch.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("S06 strict JavaScript gate checks implementation bodies, not only declaration files", () => {
  const configFile = path.join(root, "tsconfig.core-js.json");
  const loaded = ts.readConfigFile(configFile, ts.sys.readFile);
  assert.equal(loaded.error, undefined);
  const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
  assert.deepEqual(config.errors, []);
  assert.equal(config.options.checkJs, true);
  assert.equal(config.options.strict, true);
  const target = path.join(root, "apps/backend/src/common/database/d1-query-bindings.mjs");
  assert.ok(config.fileNames.includes(target));
  const clean = ts.createProgram(config.fileNames, config.options);
  assert.deepEqual(ts.getPreEmitDiagnostics(clean).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  // An implementation-only error must be rejected even when every call site is valid.
  const host = ts.createCompilerHost(config.options);
  const originalRead = host.readFile;
  host.readFile = (file) => file === target
    ? fs.readFileSync(target, "utf8").replace("return JSON.stringify(checked);", "return checked * 2;")
    : originalRead(file);
  const broken = ts.createProgram(config.fileNames, config.options, host);
  const errors = ts.getPreEmitDiagnostics(broken);
  assert.ok(errors.some((d) => d.file?.fileName === target && d.code === 2362));
});

test("S06 an old completion cannot commit into a new session or after unmount", async () => {
  const epoch = createSessionEpoch();
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const oldCurrent = epoch.capture();
  let state = "new session";
  const completion = pending.then(() => { if (oldCurrent()) state = "old answer"; });
  epoch.invalidate();
  const current = epoch.capture();
  resolve();
  await completion;
  assert.equal(state, "new session");
  assert.equal(current(), true);
  epoch.invalidate();
  assert.equal(current(), false);
});
