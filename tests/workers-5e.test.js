/**
 * The planner's fights on background workers (the core's API 22): this helper opens its rules to them
 * (adapter.workerRules), and rules.js loads and plays with nothing of Foundry's, as a worker has it. On real threads
 * (node's worker_threads, tests/fixtures/batch-thread.js), a batch of 5e fights split among workers and put back in
 * order is exactly what the main thread's runBatchSync gives.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { runBatchSync } from "../../FastFighting/scripts/engine/simulator.js";
import { openPool } from "../../FastFighting/scripts/engine/batch-pool.js";
import { parseFormula } from "../scripts/core.js";
import { dnd5eRules } from "../scripts/rules.js";
import { Dnd5eAdapter } from "../scripts/adapter.js";

const RULES = new Dnd5eAdapter().workerRules();
const SCRIPTS = fileURLToPath(new URL("../scripts/", import.meta.url));

const threads = [];
/** A worker thread running the core's batch-worker.js, shaped like a browser's Worker. */
function thread(workerData = null) {
  const t = new NodeWorker(new URL("./fixtures/batch-thread.js", import.meta.url), { workerData });
  threads.push(t);
  const w = { onmessage: null, onerror: null, onmessageerror: null };
  t.on("message", data => w.onmessage?.({ data }));
  t.on("error", err => w.onerror?.({ message: err.message }));
  w.postMessage = message => t.postMessage(message);
  w.terminate = () => { t.terminate(); };
  return w;
}
afterAll(async () => { await Promise.all(threads.map(t => t.terminate())); });

const at = (x, y = 0) => ({ x, y, size: 5 });
const minded = (tactical = 60, brave = 70) => ({ tactical: { base: tactical, fudge: 0 }, brave: { base: brave, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } });
const strike = (id, over = {}) => ({ id, name: id, kind: "strike", cost: 1, bonus: 5, melee: true, reach: 5, damage: [parseFormula("1d8+3", "slashing")], ...over });
const bow = id => strike(id, { name: "Shortbow", melee: false, reach: undefined, range: { increment: 80, max: 320 }, damage: [parseFormula("1d6+3", "piercing")] });
const creature = (id, side, position, over = {}) => ({
  id, name: id, side, kind: side === "friendly" ? "pc" : "npc", level: 3, hp: { value: 28, max: 28, temp: 0 },
  defenses: { ac: 15, str: 2, dex: 2, con: 2, int: 0, wis: 0, cha: 0 }, perception: 2, initiative: { mod: 2, stealth: 2 }, speeds: { walk: 30 },
  actions: [strike(`${id}.sword`)], iwr: {}, flags: {}, diesAtZero: side !== "friendly", traits: minded(), escapeWork: { mod: 3, ath: 3, acr: 2, str: 2, dex: 2 },
  rulesVersion: "modern", position, ...over
});
const battle = (combatants, options = {}) => ({
  combatants, sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } },
  options: { positioning: true, maxRounds: 8, ...options }
});

/** Twelve creatures, two blocks 40 feet apart, some shooting, a wall across part of the field. */
function twelve() {
  const list = [];
  for ( let i = 0; i < 6; i++ ) {
    const shoots = i % 3 === 2;
    list.push(creature(`pc${i}`, "friendly", at(Math.floor(i / 3) * 5, (i % 3) * 5), shoots ? { actions: [bow(`pc${i}.bow`), strike(`pc${i}.dagger`)] } : {}));
    list.push(creature(`foe${i}`, "hostile", at(45 + Math.floor(i / 3) * 5, (i % 3) * 5), shoots ? { actions: [bow(`foe${i}.bow`)] } : {}));
  }
  const spec = battle(list);
  spec.walls = [{ a: [22.5, 2.5], b: [22.5, 30], s: 20, d: 0, door: null, open: false }];
  return spec;
}

/** What 5e's rules play their own way: death saves, Extra Attack, a heal on a bonus action, a hider, the 2014 rules. */
function dnd5eFeatures() {
  const extra = strike("fighter.sword", { id: "fighter.extra", name: "Extra Attack", sequence: [strike("fighter.a1"), strike("fighter.a2")] });
  const word = { id: "cleric.word", name: "Healing Word", kind: "heal", cost: 1, economy: "bonus", heal: [parseFormula("1d4+3", "healing")], resource: "slots:1", range: { increment: 60, max: 60 } };
  return battle([
    creature("fighter", "friendly", at(0), { hp: { value: 40, max: 40, temp: 0 }, actions: [strike("fighter.sword"), extra], deathSaves: { success: 0, failure: 0 } }),
    creature("cleric", "friendly", at(0, 10), { actions: [strike("cleric.mace"), word], resources: { "slots:1": 3 }, rulesVersion: "legacy" }),
    creature("orc", "hostile", at(40), { hp: { value: 30, max: 30, temp: 0 }, actions: [strike("orc.axe", { bonus: 6, damage: [parseFormula("1d12+3", "slashing")] })] }),
    creature("sneak", "hostile", at(45, 15), { hidden: true, initiative: { mod: 3, stealth: 7 }, actions: [strike("sneak.knife")] })
  ], { surprise: "system" });
}

describe("this helper's rules for the planner's workers", () => {
  test("workerRules: rules.js beside the adapter, its dnd5eRules, no settings to send (rulesVersion travels on the spec)", async () => {
    expect(RULES).toEqual({ url: new URL("../scripts/rules.js", import.meta.url).href, exportName: "dnd5eRules" });
    expect((await import(RULES.url))[RULES.exportName]).toBe(dnd5eRules);
  });

  test("rules.js imports nothing of the Foundry side (no sheets, cards or chat)", () => {
    const seen = new Set();
    const walk = file => {
      if ( seen.has(file) ) return;
      seen.add(file);
      const src = fs.readFileSync(file, "utf8");
      for ( const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+"(\.\/[^"]+)"/g) ) walk(path.join(path.dirname(file), m[1]));
    };
    walk(path.join(SCRIPTS, "rules.js"));
    const names = [...seen].map(f => path.basename(f)).sort();
    for ( const foundrySide of ["adapter.js", "commit.js", "read-turn.js", "main.js", "lore.js", "leadership.js", "effects.js", "conditions.js"] ) {
      expect(names).not.toContain(foundrySide);
    }
  });

  test("loaded on a thread with nothing of Foundry's, it reads none of Foundry's globals", async () => {
    const w = thread({ trap: RULES.url });
    const said = await new Promise((resolve, reject) => { w.onmessage = e => resolve(e.data); w.onerror = reject; });
    expect(said).toEqual({ type: "touched", names: [] });
  }, 30000);
});

describe("5e fights on real threads: what runBatchSync gives", () => {
  for ( const [name, make, runs] of [["twelve creatures on a walled field", twelve, 24], ["death saves, Extra Attack, a bonus-action heal, a hider, the 2014 rules", dnd5eFeatures, 80]] ) {
    test(name, async () => {
      const warn = vi.spyOn(console, "warn");
      const spec = make();
      const pool = openPool(RULES, { size: 4, makeWorker: () => thread() });
      const r = await pool.run(spec, dnd5eRules, { runs, seed: 17 });
      pool.close();
      expect(pool.used).toBe(4);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
      expect(r).toEqual(runBatchSync(spec, dnd5eRules, { runs, seed: 17 }));
    }, 60000);
  }
});
