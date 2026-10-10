import { describe, expect, test } from "vitest";
import { runBatchSync, replay } from "../../FastFighting/scripts/engine/simulator.js";
import { parseFormula } from "../scripts/core.js";
import { dnd5eRules } from "../scripts/rules.js";

let n = 0;
const at = (x, y) => ({ x, y, size: 5 });
const strike = (over = {}) => ({ id: `s${++n}`, name: "Longsword", kind: "strike", bonus: 5, melee: true, reach: 5, damage: [parseFormula("1d8+3", "slashing")], ...over });
const creature = (over = {}) => ({
  id: over.id ?? `c${++n}`, name: over.name ?? over.id, side: "friendly", kind: "npc", level: 1,
  hp: { value: 20, max: 20, temp: 0 }, defenses: { ac: 15, str: 2, dex: 2, con: 2, int: 0, wis: 0, cha: 0 },
  initiative: { mod: 2 }, speeds: { walk: 30 }, actions: [strike()], iwr: {},
  traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  flags: {}, diesAtZero: true, ...over
});
const battle = (combatants, options = {}) => ({
  combatants,
  sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } },
  options: { positioning: false, opening: "fight", ...options }
});

describe("5e turns in the engine", () => {
  test("a creature moves and attacks in the same turn", () => {
    const a = creature({ id: "a", position: at(0, 0) });
    const b = creature({ id: "b", side: "hostile", position: at(25, 0), actions: [strike({ bonus: -50 })] });
    const r = replay(battle([a, b], { positioning: true, maxRounds: 1 }), dnd5eRules, 3);
    const mine = r.log.filter(e => e.actorId === "a");
    expect(mine.some(e => e.type === "move")).toBe(true);
    expect(mine.some(e => e.type === "attack")).toBe(true);
  });

  test("one Attack action per turn (no multiple attacks without Extra Attack)", () => {
    const a = creature({ id: "a" });
    const b = creature({ id: "b", side: "hostile", hp: { value: 500, max: 500, temp: 0 }, actions: [strike({ bonus: -50 })] });
    const r = replay(battle([a, b], { maxRounds: 3 }), dnd5eRules, 5);
    const perRound = [1, 2, 3].map(rd => r.log.filter(e => e.round === rd && e.actorId === "a" && e.type === "attack").length);
    expect(perRound).toEqual([1, 1, 1]);
  });

  test("a Multiattack makes all its strikes with one action", () => {
    const bite = strike({ id: "bite", name: "Bite" });
    const claw = strike({ id: "claw", name: "Claws" });
    const multi = { ...bite, id: "multi", name: "Multiattack", sequence: [bite, { ...claw, id: "c1" }, { ...claw, id: "c2" }] };
    const bear = creature({ id: "bear", actions: [bite, claw, multi] });
    const dummy = creature({ id: "d", side: "hostile", hp: { value: 500, max: 500, temp: 0 }, actions: [strike({ bonus: -50 })] });
    const r = replay(battle([bear, dummy], { maxRounds: 1 }), dnd5eRules, 2);
    expect(r.log.filter(e => e.actorId === "bear" && e.type === "attack").length).toBe(3);
  });

  test("a bonus-action heal and an attack in the same turn", () => {
    const word = { id: "hw", name: "Healing Word", kind: "heal", cost: 1, economy: "bonus", heal: [parseFormula("1d4+3", "healing")], resource: "slots:1" };
    const cleric = creature({ id: "cleric", actions: [strike(), word], resources: { "slots:1": 3 } });
    const friend = creature({ id: "friend", hp: { value: 2, max: 30, temp: 0 } });
    const foe = creature({ id: "foe", side: "hostile", hp: { value: 300, max: 300, temp: 0 }, actions: [strike({ bonus: -50 })] });
    const r = replay(battle([cleric, friend, foe], { maxRounds: 1 }), dnd5eRules, 7);
    const mine = r.log.filter(e => e.actorId === "cleric");
    expect(mine.some(e => e.type === "heal")).toBe(true);
    expect(mine.some(e => e.type === "attack")).toBe(true);
  });

  test("a fallen PC makes death saves until it dies or stabilizes", () => {
    const pc = creature({ id: "pc", kind: "pc", diesAtZero: false, hp: { value: 0, max: 20, temp: 0 }, stable: false });
    const foe = creature({ id: "foe", side: "hostile", actions: [strike({ bonus: -50 })], hp: { value: 300, max: 300, temp: 0 } });
    // A standing (harmless) ally keeps the fight going, so the PC gets turns to roll on.
    const ally = creature({ id: "ally", hp: { value: 300, max: 300, temp: 0 }, actions: [strike({ bonus: -50 })] });
    const r = replay(battle([pc, ally, foe], { maxRounds: 6, aftermath: "none" }), dnd5eRules, 4);
    expect(r.log.some(e => e.type === "recovery" && /death save/.test(e.text))).toBe(true);
  });

  test("a level-matched fight is roughly even", () => {
    const r = runBatchSync(battle([creature({ id: "a" }), creature({ id: "b", side: "hostile" })], { maxRounds: 20 }), dnd5eRules, { runs: 2000 });
    expect(r.sides.friendly.pWin).toBeGreaterThan(0.4);
    expect(r.sides.friendly.pWin).toBeLessThan(0.6);
  });
});
