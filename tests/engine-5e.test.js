import { describe, expect, test } from "vitest";
import { runBatchSync, replay } from "../../FastFighting/scripts/engine/simulator.js";
import { parseFormula } from "../scripts/core.js";
import { dnd5eRules } from "../scripts/rules.js";
import { text } from "./foundry-i18n.js";

/** Does a line read as this template, its {placeholders} filled with anything? */
const reads = (line, key) => {
  const pattern = text(key).split(/\{\w+\}/).map(bit => bit.replace(/[.*+?^${}()|[\]\\]/g, c => `\\${c}`)).join(".*");
  return new RegExp(`^${pattern}$`).test(line ?? "");
};

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
    expect(r.log.some(e => e.type === "recovery" && ["Death.Success", "Death.Failure", "Death.Dies", "Death.Stable", "Death.Twenty"].some(k => reads(e.text, `FFDND5E.${k}`)))).toBe(true);
  });

  test("a save on a hit: the wolf knocks you down, the spider's venom burns", () => {
    const bite = strike({ bonus: 50, effects: [{ kind: "save", save: { type: "str", dc: 99 }, conditions: { prone: 1 }, rounds: 1, label: "prone" }] });
    const venom = strike({ bonus: 50, effects: [{ kind: "save", save: { type: "con", dc: 99, basic: true }, damage: [parseFormula("2d8", "poison")], label: "venom" }] });
    const r = replay(battle([creature({ id: "wolf", actions: [bite] }), creature({ id: "spider", actions: [venom] }),
      creature({ id: "pc", side: "hostile", hp: { value: 500, max: 500, temp: 0 }, actions: [strike({ bonus: -50 })] })], { maxRounds: 1 }), dnd5eRules, 3);
    expect(r.log.some(e => e.type === "riderSave" && e.by === "wolf" && e.degree === 1)).toBe(true);
    expect(r.log.some(e => e.type === "condition" && e.by === "wolf")).toBe(true);
    expect(r.log.find(e => e.type === "riderSave" && e.by === "spider")?.damage).toBeGreaterThan(0);
  });

  test("a level-matched fight is roughly even", () => {
    const r = runBatchSync(battle([creature({ id: "a" }), creature({ id: "b", side: "hostile" })], { maxRounds: 20 }), dnd5eRules, { runs: 2000 });
    expect(r.sides.friendly.pWin).toBeGreaterThan(0.4);
    expect(r.sides.friendly.pWin).toBeLessThan(0.6);
  });
});

describe("5e healing and spell slots", () => {
  const word = { id: "hw", name: "Healing Word", kind: "heal", cost: 1, economy: "bonus", heal: [parseFormula("1d4+3", "healing")], resource: "slots:1", range: { increment: 60, max: 60, noPenalty: true } };
  const cure = { id: "cw", name: "Cure Wounds", kind: "heal", cost: 1, heal: [parseFormula("1d8+3", "healing")], resource: "slots:1", reach: 5 };
  const bolt = { id: "gb", name: "Guiding Bolt", kind: "spell-attack", cost: 1, bonus: 50, damage: [parseFormula("4d6", "radiant")], range: { increment: 120, max: 120 }, resource: "slots:1" };
  const setup = (actions, friendAt = 25) => {
    const cleric = creature({ id: "cleric", position: at(0, 0), actions: [strike(), ...actions], resources: { "slots:1": 4 } });
    const friend = creature({ id: "friend", kind: "pc", diesAtZero: false, position: at(friendAt, 0), hp: { value: 0, max: 30, temp: 0 }, stable: false });
    const foe = creature({ id: "foe", side: "hostile", position: at(100, 0), hp: { value: 300, max: 300, temp: 0 }, actions: [strike({ bonus: -50 })] });
    return battle([cleric, friend, foe], { positioning: true, maxRounds: 1, aftermath: "none" });
  };

  test("a touch spell means walking over first", () => {
    const r = replay(setup([cure]), dnd5eRules, 2);
    const mine = r.log.filter(e => e.actorId === "cleric");
    const walk = mine.findIndex(e => e.type === "move" && e.purpose === "tend");
    const heal = mine.findIndex(e => e.type === "heal" && e.action === "Cure Wounds");
    expect(walk).toBeGreaterThanOrEqual(0);
    expect(heal).toBeGreaterThan(walk);
  });

  test("the fallen get Healing Word from afar rather than a walk and Cure Wounds", () => {
    const r = replay(setup([cure, word]), dnd5eRules, 2);
    expect(r.log.find(e => e.actorId === "cleric" && e.type === "heal")?.action).toBe("Healing Word");
  });

  test("one spell slot a turn: Healing Word, then no Guiding Bolt", () => {
    const r = replay(setup([word, bolt], 10), dnd5eRules, 2);
    const mine = r.log.filter(e => e.actorId === "cleric" && e.round === 1);
    expect(mine.some(e => e.type === "heal" && e.action === "Healing Word")).toBe(true);
    expect(mine.some(e => e.action === "Guiding Bolt")).toBe(false);
  });
});

describe("5e opportunity attacks", () => {
  const cure = { id: "cw", name: "Cure Wounds", kind: "heal", cost: 1, heal: [parseFormula("1d8+3", "healing")], reach: 5 };
  const fight = (healerFlags = {}) => {
    const healer = creature({ id: "healer", kind: "pc", position: at(0, 0), actions: [strike(), cure], flags: healerFlags, initiative: { mod: 50 },
      traits: { tactical: { base: 80, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 20, fudge: 0 }, loyal: { base: 80, fudge: 0 } } });
    const friend = creature({ id: "friend", kind: "pc", diesAtZero: false, position: at(-20, 0), hp: { value: 0, max: 30, temp: 0 }, stable: false });
    const orc = creature({ id: "orc", side: "hostile", position: at(5, 0), hp: { value: 500, max: 500, temp: 0 }, actions: [strike({ bonus: -50 })] });
    return replay(battle([healer, friend, orc], { positioning: true, maxRounds: 1, aftermath: "none" }), dnd5eRules, 6);
  };

  test("anyone with a melee weapon can make one: walking off from the orc to a fallen friend costs a swing", () => {
    const r = fight();
    const types = r.log.filter(e => e.actorId === "healer" || e.type === "opportunity").map(e => e.type);
    expect(types).toContain("opportunity");
    expect(types.indexOf("heal")).toBeGreaterThan(types.indexOf("opportunity"));
  });

  test("Cunning Action: Disengage as a bonus action, then walk over and heal with the action", () => {
    const r = fight({ nimble: true });
    const mine = r.log.filter(e => e.actorId === "healer" && e.type !== "thought").map(e => e.type);
    expect(mine.slice(0, 3)).toEqual(["disengage", "move", "heal"]);
    expect(r.log.some(e => e.type === "opportunity")).toBe(false);
  });
});
