import assert from "node:assert/strict";
import test from "node:test";
import { finishLobbyPoll, nextLobbyPoll, type LobbyPollDeadlines } from "../apps/frontend/src/features/group-exams/group-exam-lobby-poll";

function simulate(minutes: number, phase: string, visible: boolean) {
  let due: LobbyPollDeadlines = { syncAt: 0, heartbeatAt: 0 };
  let now = 0;
  const events: Array<{ at: number; heartbeat: boolean; sync: boolean }> = [];
  while (now < minutes * 60_000) {
    const next = nextLobbyPoll(due, now);
    now += next.delay;
    if (now >= minutes * 60_000) break;
    const action = nextLobbyPoll(due, now);
    const sync = action.sync || visible;
    events.push({ at: now, heartbeat: action.heartbeat, sync });
    due = finishLobbyPoll(due, now, action.heartbeat, sync, phase, visible, true);
  }
  return events;
}

test("idle minute boundaries keep sync at 15s and presence writes at 20s without duplicate requests", () => {
  const events = simulate(3, "idle", true);
  assert.deepEqual(events.slice(0, 7), [
    { at: 0, heartbeat: true, sync: true }, { at: 15_000, heartbeat: false, sync: true },
    { at: 20_000, heartbeat: true, sync: true }, { at: 35_000, heartbeat: false, sync: true },
    { at: 40_000, heartbeat: true, sync: true }, { at: 55_000, heartbeat: false, sync: true },
    { at: 60_000, heartbeat: true, sync: true },
  ]);
  for (let minute = 0; minute < 3; minute += 1) {
    const window = events.filter((event) => event.at >= minute * 60_000 && event.at < (minute + 1) * 60_000);
    assert.equal(window.length, 6);
    assert.equal(window.filter((event) => event.heartbeat).length, 3);
  }
});

test("running and hidden phases retain their own timing budgets", () => {
  const running = simulate(1, "running", true);
  assert.equal(running.filter((event) => event.heartbeat).length, 3);
  assert.ok(running.every((event, index) => index === 0 || event.at - running[index - 1].at <= 3_000));
  const hidden = simulate(3, "idle", false);
  assert.equal(hidden.filter((event) => event.heartbeat).length, 9);
  assert.deepEqual(hidden.slice(0, 5), [
    { at: 0, heartbeat: true, sync: true }, { at: 20_000, heartbeat: true, sync: false },
    { at: 30_000, heartbeat: false, sync: true }, { at: 40_000, heartbeat: true, sync: false },
    { at: 60_000, heartbeat: true, sync: true },
  ]);
});


test("failed sync backs off progressively, caps delay, and success resets it", () => {
  let due: LobbyPollDeadlines = {syncAt: 0, heartbeatAt: 0};
  const gaps=[];
  for(let failure=0;failure<6;failure++) {
    due=finishLobbyPoll(due,0,false,true,"running",true,false);
    gaps.push(due.syncAt);
  }
  assert.deepEqual(gaps,[6000,12000,24000,30000,30000,30000]);
  assert.equal(due.consecutiveFailures,5);
  due=finishLobbyPoll(due,1000,true,true,"running",true,true);
  assert.equal(due.consecutiveFailures,0);
  assert.equal(due.syncAt,4000);
  assert.equal(due.heartbeatAt,21000);
  due=finishLobbyPoll(due,4000,false,true,"running",true,false,499);
  assert.equal(due.syncAt,10499);
  const hidden=finishLobbyPoll(due,0,false,true,"idle",false,false,499);
  assert.equal(hidden.syncAt,60000);
  const heartbeat=finishLobbyPoll(hidden,10,true,false,"idle",false,true);
  assert.equal(heartbeat.consecutiveFailures,hidden.consecutiveFailures);
  assert.equal(heartbeat.syncAt,hidden.syncAt);
});
