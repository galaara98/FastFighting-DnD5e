/**
 * Playstyle perks in 5e's terms: Dodge as the shield answer has it (a 5e shield is in the AC already), Hide for one
 * keeping a low profile, and one who spares the fallen knocking a foe out with a melee blow.
 */
import { describe, expect, test } from "vitest";
import { replay } from "../../FastFighting/scripts/engine/simulator.js";
import { parseFormula, STATUS } from "../scripts/core.js";
import { dnd5eRules } from "../scripts/rules.js";

let n = 0;
const strike = (over = {}) => ({ id: `s${++n}`, name: "Longsword", kind: "strike", bonus: 5, melee: true, reach: 5, damage: [parseFormula("1d8+3", "slashing")], ...over });
const creature = (over = {}) => ({
  id: over.id ?? `c${++n}`, name: over.name ?? over.id, side: "friendly", kind: "npc", level: 1,
  hp: { value: 20, max: 20, temp: 0 }, defenses: { ac: 15, str: 2, dex: 2, con: 2, int: 0, wis: 0, cha: 0 },
  initiative: { mod: 2 }, speeds: { walk: 30 }, actions: [strike()], iwr: {},
  traits: { tactical: { base: 80, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 40, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  flags: {}, diesAtZero: true, ...over
});
const battle = (combatants, options = {}) => ({
  combatants, sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } },
  options: { positioning: false, opening: "fight", ...options }
});

describe("Hide", () => {
  test("hidden: its attacks at advantage, those against it at disadvantage; it ends when it attacks", () => {
    expect(dnd5eRules.conditionMods("hidden")).toEqual({ adv: 1, defAdv: -1 });
    const u = { conds: { hidden: 1 }, baseConds: { hidden: 1 }, effects: [{ key: "x", conditions: { hidden: 1 }, rounds: 5 }], baseMods: [], spec: { iwr: {} } };
    dnd5eRules.afterRoll(null, u, { degree: 2 }, { kind: "attack" });
    expect(u.conds.hidden).toBeFalsy();
  });

  test("unseen, by the rolls (SRD 5.1 and 5.2 alike): its attacks with advantage, those at it with disadvantage", () => {
    const attack = (attacker, target) => dnd5eRules.modifiers.attack({ attacker: { conds: {}, spec: { flags: {} }, ...attacker }, target: { conds: {}, ...target }, action: { melee: true }, distance: 5 }).advantage;
    expect(attack({ conds: { hidden: 1 } }, {})).toBe(1);
    expect(attack({}, { conds: { hidden: 1 } })).toBe(-1);
    expect(attack({ conds: { hidden: 1 } }, { conds: { hidden: 1 } })).toBe(0); // neither sees the other
    expect(attack({ conds: { hidden: 1, poisoned: 1 } }, {})).toBe(0); // advantage and disadvantage cancel
  });

  // A shade that Hid, with two strikes to its Multiattack, and an ogre that only stands and swings.
  const twoStrikes = () => { const a = strike({ id: "a1" }); return { ...a, id: "multi", name: "Multiattack", sequence: [a, { ...a, id: "a2" }] }; };
  const shade = (over = {}) => creature({ id: "shade", conditions: { hidden: 1 }, hp: { value: 300, max: 300, temp: 0 }, flags: { fearless: true }, ...over });
  const ogre = (over = {}) => creature({ id: "ogre", side: "hostile", hp: { value: 300, max: 300, temp: 0 }, flags: { fearless: true }, ...over });
  const attacks = (r, id) => r.log.filter(e => e.type === "attack" && e.actorId === id);

  test("a hidden attacker's first attack has advantage; it's seen after it, the next strike and the blows at it plain", () => {
    const r = replay(battle([shade({ initiative: { mod: 40 }, actions: [twoStrikes()] }), ogre({ initiative: { mod: -40 } })], { maxRounds: 2 }), dnd5eRules, 1);
    const [first, second] = attacks(r, "shade");
    expect(first.advantage).toBe(1);
    expect(second.round).toBe(first.round);
    expect(second.advantage).toBe(0);
    expect(r.log.indexOf(attacks(r, "ogre")[0])).toBeGreaterThan(r.log.indexOf(first));
    for ( const e of attacks(r, "ogre") ) expect(e.advantage).toBe(0);
  });

  test("an attack at a hidden creature has disadvantage, until it attacks and gives itself away", () => {
    const r = replay(battle([shade({ initiative: { mod: -40 } }), ogre({ initiative: { mod: 40 } })], { maxRounds: 2 }), dnd5eRules, 1);
    const shadeFirst = attacks(r, "shade")[0];
    const ogres = attacks(r, "ogre");
    const before = ogres.filter(e => r.log.indexOf(e) < r.log.indexOf(shadeFirst));
    const after = ogres.filter(e => r.log.indexOf(e) > r.log.indexOf(shadeFirst));
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    for ( const e of before ) expect(e.advantage).toBe(-1);
    expect(shadeFirst.advantage).toBe(1);
    for ( const e of after ) expect(e.advantage).toBe(0);
  });

  test("not with a foe beside it", () => {
    const foe = { id: "f", side: "hostile", status: STATUS.STANDING };
    const run = { byId: new Map([["f", foe]]), prep: { sides: { friendly: { enemies: new Set(["hostile"]) } } } };
    expect(dnd5eRules.usable(run, { side: "friendly", adjacent: new Set(["f"]) }, { hide: true })).toBe(false);
    expect(dnd5eRules.usable(run, { side: "friendly", adjacent: new Set() }, { hide: true })).toBe(true);
    expect(dnd5eRules.usable(run, { side: "friendly", adjacent: new Set(["f"]) }, { kind: "strike" })).toBe(true);
  });
});

describe("the fallen", () => {
  test("one who spares the fallen knocks a foe out with a melee blow (any can); a shot still kills", () => {
    const fate = (behavior, weapon) => {
      const knight = creature({ id: "knight", behavior, actions: [weapon] });
      const goblin = creature({ id: "gob", side: "hostile", hp: { value: 4, max: 4, temp: 0 }, defenses: { ac: 5 }, flags: { fearless: true }, actions: [strike({ bonus: -20 })] });
      return replay(battle([knight, goblin], { maxRounds: 2 }), dnd5eRules, 1).units.gob.status;
    };
    const sword = strike({ bonus: 30, damage: [parseFormula("20", "slashing")] });
    const bow = { ...sword, id: "bow", melee: false, reach: undefined, range: { increment: 80, max: 320 } };
    expect(fate({}, sword)).toBe(STATUS.DEAD);
    expect(fate({ spareDowned: 1 }, sword)).toBe(STATUS.DOWN);
    expect(fate({ spareDowned: 1 }, bow)).toBe(STATUS.DEAD);
  });
});

describe("Dodge, as the shield answer has it", () => {
  test("never: it doesn't; always: more readily", () => {
    const dodge = { id: "me.dodge", name: "Dodge", kind: "buff", targets: "self", cost: 1, traits: [], tell: "dodge", guard: true, setup: true, outcome: { mods: { defAdv: -1 }, rounds: 1, label: "dodging" } };
    const dodges = shield => {
      let count = 0;
      for ( let seed = 1; seed <= 10; seed++ ) {
        const me = creature({ id: "me", actions: [strike({ bonus: -10, damage: [parseFormula("1", "bludgeoning")] }), dodge], tactics: { shield } });
        const ogre = creature({ id: "ogre", side: "hostile", hp: { value: 200, max: 200, temp: 0 }, flags: { fearless: true }, actions: [strike({ bonus: 8, damage: [parseFormula("2d8+5", "bludgeoning")] })] });
        count += replay(battle([me, ogre], { maxRounds: 3 }), dnd5eRules, seed).log.filter(e => e.type === "buff" && e.actorId === "me").length;
      }
      return count;
    };
    expect(dodges("never")).toBe(0);
    expect(dodges("always")).toBeGreaterThanOrEqual(dodges("spare"));
    expect(dodges("spare")).toBeGreaterThan(0);
  });
});
