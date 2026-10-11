import { describe, expect, test } from "vitest";
import { ridersFrom, HIT_WORDS, ON_HIT, namesFiends } from "../scripts/riders.js";
import { parseFormula } from "../scripts/core.js";
import { dnd5eRules } from "../scripts/rules.js";
import { text } from "./foundry-i18n.js";
import { replay } from "../../FastFighting/scripts/engine/simulator.js";

const d8 = n => parseFormula(`${n}d8`, "radiant");
const dice = parts => parts.reduce((s, p) => s + p.dice.reduce((t, d) => t + d.n, 0), 0);
const slots = (...levels) => levels.map(l => ({ key: `slots:${l}`, level: l, pool: 2 }));

describe("riders from 5e features and spells", () => {
  test("Divine Smite (2014): a d8 more for each slot level above the first, at most 5d8; an extra die against fiends and undead", () => {
    const riders = ridersFrom({
      id: "smite", name: "Divine Smite", text: "When you hit a creature with a melee weapon attack, you can expend one spell slot.",
      damage: [{ parts: [d8(2)], perLevel: [d8(1)] }, { parts: [d8(1)], perLevel: [], vs: true }], save: null,
      cost: { slots: slots(1, 2, 5), baseLevel: 1, maxLevel: 4, turn: {} }
    });
    const plain = riders.filter(r => !r.vs);
    expect(plain.map(r => dice(r.damage))).toEqual([2, 3, 5]); // 5th-level slot: still 5d8
    expect(plain.map(r => r.resource)).toEqual(["slots:1", "slots:2", "slots:5"]);
    const vs = riders.filter(r => r.vs);
    expect(vs.map(r => dice(r.damage))).toEqual([3, 4, 6]);
    expect(riders.every(r => r.melee && r.weapon && r.critDouble && r.group === "smite" && !r.cost)).toBe(true);
    // Against a fiend the bigger one is offered first, and only one per hit (same group).
    expect(riders.indexOf(vs[0])).toBeLessThan(riders.indexOf(plain[0]));
  });

  test("Divine Smite (2024): a bonus action and the turn's spell slot; all it deals against fiends", () => {
    const riders = ridersFrom({
      id: "smite24", name: "Divine Smite", text: "Cast immediately after you hit a target with a Melee weapon or an Unarmed Strike.",
      damage: [{ parts: [d8(3)], perLevel: [d8(1)], vs: true, total: true }, { parts: [d8(2)], perLevel: [d8(1)] }], save: null,
      cost: { slots: slots(1, 3), baseLevel: 1, turn: { bonus: 1, slot: 1 } }
    });
    expect(riders.filter(r => r.vs).map(r => dice(r.damage))).toEqual([3, 5]);
    expect(riders.filter(r => !r.vs).map(r => dice(r.damage))).toEqual([2, 4]);
    expect(riders[0].cost).toEqual({ bonus: 1, slot: 1 });
  });

  test("Stunning Strike: a save or be stunned, from another feature's points, once a turn", () => {
    const stunned = { conditions: { stunned: 1 }, rounds: 1, label: "stunned" };
    const [r] = ridersFrom({
      id: "stun", name: "Stunning Strike", text: "Once per turn, when you hit a creature with a Monk weapon or an Unarmed Strike, you can expend 1 Focus Point.",
      damage: [], save: { type: "con", dc: 14, outcome: stunned }, cost: { resource: "feature:focus", turn: {} }
    });
    expect(r).toMatchObject({ resource: "feature:focus", save: { type: "con", dc: 14 }, onSave: [stunned, stunned, null, null], oncePerTurn: true });
  });

  test("Precision Attack: a superiority die on a close miss", () => {
    const [r] = ridersFrom({ id: "precision", name: "Precision Attack", text: "When you make an attack roll ...", damage: [], save: null, cost: { resource: "feature:sup", turn: {} }, attackDie: 10 });
    expect(r).toMatchObject({ when: "miss", attackDie: 10, resource: "feature:sup" });
  });

  test("what counts as riding on a hit", () => {
    expect(HIT_WORDS.test("Immediately after you hit a creature")).toBe(true);
    expect(HIT_WORDS.test("When you hit a creature with an attack")).toBe(true);
    expect(HIT_WORDS.test("You can take a bonus action to dash")).toBe(false);
    expect(ON_HIT.has("trip-attack")).toBe(true);
    expect(namesFiends("Unholy Creature Damage")).toBe(true);
    expect(namesFiends("Cast")).toBe(false);
  });
});

describe("in a fight", () => {
  test("a paladin smites a fiend with the bigger smite, never past its slots", () => {
    const riders = ridersFrom({
      id: "smite", name: "Divine Smite", text: "When you hit a creature with a melee weapon attack", damage: [{ parts: [d8(2)], perLevel: [d8(1)] }, { parts: [d8(1)], perLevel: [], vs: true }],
      save: null, cost: { slots: [{ key: "slots:1", level: 1, pool: 2 }], baseLevel: 1, turn: {} }
    });
    const traits = { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
    const paladin = {
      id: "paladin", name: "Paladin", side: "friendly", kind: "pc", level: 3, hp: { value: 60, max: 60 }, defenses: { ac: 18, str: 5, dex: 0, con: 3, int: 0, wis: 2, cha: 5 },
      initiative: { mod: 2 }, speeds: { walk: 30 }, iwr: {}, traits, flags: {}, diesAtZero: false, resources: { "slots:1": 2 }, riders, tac: { resourceUse: "nova" },
      actions: [{ id: "sword", name: "Longsword", kind: "strike", weapon: true, cost: 1, bonus: 6, melee: true, reach: 5, damage: [parseFormula("1d8+3", "slashing")] }]
    };
    const fiend = { id: "imp", name: "Imp", side: "hostile", kind: "npc", level: 2, hp: { value: 90, max: 90 }, defenses: { ac: 13, str: 0, dex: 3, con: 1, int: 0, wis: 1, cha: 2 },
      initiative: { mod: 0 }, speeds: { walk: 30 }, iwr: {}, traits, flags: { fearless: true }, diesAtZero: true, creatureTraits: ["fiend"],
      actions: [{ id: "claw", name: "Claw", kind: "strike", cost: 1, bonus: 3, melee: true, reach: 5, damage: [parseFormula("1d4", "piercing")] }] };
    const spec = { combatants: [paladin, fiend], sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } }, options: { positioning: false, maxRounds: 5 } };
    let smites = 0;
    for ( let s = 1; s <= 10; s++ ) {
      const r = replay(spec, dnd5eRules, s);
      const used = r.log.filter(e => e.type === "attack" && e.riders?.length);
      expect(used.length).toBeLessThanOrEqual(2);
      for ( const e of used ) expect(e.riders).toEqual([text("FFDND5E.VsFiends", { name: "Divine Smite" })]);
      smites += used.length;
    }
    expect(smites).toBeGreaterThan(5);
  });
});
