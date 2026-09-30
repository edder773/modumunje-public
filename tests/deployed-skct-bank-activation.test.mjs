import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { previewSkctBankActivation } from "../apps/backend/src/modules/admin/admin-skct-bank-use-cases.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = process.env.SKCT_GROUP_ACTIVATION_BANK;
const fixtureTest = fixturePath ? test : test.skip;
const bank = fixturePath ? JSON.parse(await readFile(fixturePath, "utf8")) : null;
const preview = bank ? await previewSkctBankActivation(bank) : null;
const releaseSha256 = preview?.releaseSha256;

async function writeApprovedBank(directory) {
  const bankPath = path.join(directory, "approved-skct-bank.json");
  await writeFile(bankPath, await readFile(fixturePath), { mode: 0o600 });
  return bankPath;
}

fixtureTest("deployed activation client previews before one explicit authenticated activation", async () => {
  const actions = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    actions.push(body.action);
    assert.equal(request.headers.origin?.startsWith("http://127.0.0.1:"), true);
    assert.equal(request.headers["x-sql-study-admin-request"], "1");
    assert.match(request.headers.cookie ?? "", /admin_session=test-session/u);
    const payload = body.action === "skct-bank-preview"
      ? preview
      : { ...preview, activated: true, replayed: false };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "skct-deployed-activation-"));
  const bankPath = await writeApprovedBank(temporary);
  const storageState = path.join(temporary, "state.json");
  await writeFile(storageState, JSON.stringify({
    cookies: [{
      name: "admin_session",
      value: "test-session",
      domain: "127.0.0.1",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    }],
    origins: [],
  }));
  try {
    const child = spawn(process.execPath, [
      "--import", "tsx",
      "scripts/activate-skct-group-bank-deployed.mjs",
      "--bank", bankPath,
      "--storage-state", storageState,
      "--base-url", `http://127.0.0.1:${address.port}`,
      "--allow-loopback-test",
      "--activate",
      "--expected-sha", releaseSha256,
    ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const exitCode = await new Promise((resolve) => child.once("close", resolve));
    assert.equal(exitCode, 0, Buffer.concat(stderr).toString("utf8"));
    assert.deepEqual(actions, ["skct-bank-preview", "skct-bank-activate"]);
    const output = JSON.parse(Buffer.concat(stdout).toString("utf8"));
    assert.equal(output.mode, "activate");
    assert.equal(output.releaseSha256, releaseSha256);
    assert.doesNotMatch(Buffer.concat(stdout).toString("utf8"), /correctAnswers|explanationMd/u);
    assert.ok((await readFile(bankPath, "utf8")).includes("correctAnswers"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  }
});

fixtureTest("deployed activation client refuses to send the bank to another host", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "skct-deployed-target-"));
  const bankPath = await writeApprovedBank(temporary);
  const storageState = path.join(temporary, "state.json");
  await writeFile(storageState, JSON.stringify({ cookies: [], origins: [] }));
  const child = spawn(process.execPath, [
    "--import", "tsx",
    "scripts/activate-skct-group-bank-deployed.mjs",
    "--bank", bankPath,
    "--storage-state", storageState,
    "--base-url", "https://example.invalid",
    "--activate",
    "--expected-sha", releaseSha256,
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolve) => child.once("close", resolve));
  assert.notEqual(exitCode, 0);
  assert.match(Buffer.concat(stderr).toString("utf8"), /target must be exact https:\/\/modumunje[.]com/u);
  await rm(temporary, { recursive: true, force: true });
});

for (const redirectStatus of [307, 308]) {
  fixtureTest(`deployed activation client refuses ${redirectStatus} without forwarding the private bank`, async () => {
    let sinkRequests = 0;
    let sinkBytes = 0;
    const sourceActions = [];
    const sink = http.createServer(async (request, response) => {
      sinkRequests += 1;
      for await (const chunk of request) sinkBytes += chunk.length;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ...preview,
        activated: true,
      }));
    });
    await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
    const sinkAddress = sink.address();
    assert.ok(sinkAddress && typeof sinkAddress === "object");

    const source = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      sourceActions.push(body.action);
      if (redirectStatus === 308 && body.action === "skct-bank-preview") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(preview));
        return;
      }
      response.writeHead(redirectStatus, {
        location: `http://127.0.0.1:${sinkAddress.port}/capture-private-bank`,
      });
      response.end();
    });
    await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
    const sourceAddress = source.address();
    assert.ok(sourceAddress && typeof sourceAddress === "object");

    const temporary = await mkdtemp(path.join(os.tmpdir(), `skct-redirect-${redirectStatus}-`));
    const bankPath = await writeApprovedBank(temporary);
    const storageState = path.join(temporary, "state.json");
    await writeFile(storageState, JSON.stringify({ cookies: [], origins: [] }));
    try {
      const child = spawn(process.execPath, [
        "--import", "tsx",
        "scripts/activate-skct-group-bank-deployed.mjs",
        "--bank", bankPath,
        "--storage-state", storageState,
        "--base-url", `http://127.0.0.1:${sourceAddress.port}`,
        "--allow-loopback-test",
        "--activate",
        "--expected-sha", releaseSha256,
      ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      const stdout = [];
      const stderr = [];
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      const exitCode = await new Promise((resolve) => child.once("close", resolve));
      assert.notEqual(exitCode, 0);
      assert.equal(sinkRequests, 0);
      assert.equal(sinkBytes, 0);
      assert.deepEqual(sourceActions, redirectStatus === 307
        ? ["skct-bank-preview"]
        : ["skct-bank-preview", "skct-bank-activate"]);
      assert.doesNotMatch(Buffer.concat(stdout).toString("utf8"), /"mode"\s*:\s*"(?:preview|activate)"/u);
      assert.match(Buffer.concat(stderr).toString("utf8"), /refused redirect response/u);
    } finally {
      await new Promise((resolve) => source.close(resolve));
      await new Promise((resolve) => sink.close(resolve));
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
