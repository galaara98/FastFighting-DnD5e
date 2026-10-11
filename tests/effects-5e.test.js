import { describe, expect, test } from "vitest";
import { replay, runBatchSync } from "../../FastFighting/scripts/engine/simulator.js";
import { parseFormula } from "../scripts/core.js";
import { dnd5eRules } from "../scripts/rules.js";
import { bonusOf, modsFromChanges, fromWords, effectLabel, durationRounds, helps } from "../scripts/effects.js";
import { text } from "./foundry-i18n.js";

let n = 0;
const strike = (over = {}) => ({ id: `s${++n}`, name: "Longsword", kind: "strike", bonus: 5, melee: true, reach: 5, damage: [parseFormula("1d8+3", "slashing")], ...over });
const creature = (over = {}) => ({
  id: over.id ?? `c${++n}`, name: over.name ?? over.id, side: "friendly", kind: "npc", level: 3,
  hp: { value: 40, max: 40, temp: 0 }, defenses: { ac: 15, str: 2, dex: 2, con: 2, int: 0, wis: 0, cha: 0 },
  initiative: { mod: 2 }, speeds: { walk: 30 }, actions: [strike()], iwr: {},
  traits: { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  flags: {}, diesAtZero: true, ...over
});
const battle = (combatants, options = {}) => ({
  combatants,
  sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } },
  options: { positioning: false, opening: "fight", ...options }
});
const ADD = 2;
const change = (key, value, mode = ADD) => ({ key, mode, value });

describe("reading 5e effects", () => {
  test("bonuses: a lone die rides along, other dice count as their average", () => {
    expect(bonusOf("1d4")).toEqual({ die: 4 });
    expect(bonusOf("-1d4")).toEqual({ die: -4 });
    expect(bonusOf("+2")).toEqual({ flat: 2 });
    expect(bonusOf("- 1d8")).toEqual({ die: -8 });
    expect(bonusOf("2d6")).toEqual({ flat: 7 });
    expect(bonusOf("1d4[radiant]")).toEqual({ die: 4 });
    expect(bonusOf("@scale.rage")).toBeNull();
  });

  test("Bless, Bane, Shield of Faith, Slow, Haste, Divine Favor and Aid from their changes", () => {
    const attack = v => ["mwak", "rwak", "msak", "rsak"].map(k => change(`system.bonuses.${k}.attack`, v));
    expect(modsFromChanges([...attack("1d4"), change("system.bonuses.abilities.save", "1d4")]).mods).toEqual({ attackDie: 4, saveDie: 4 });
    expect(modsFromChanges([...attack("-1d4"), change("system.bonuses.abilities.save", "-1d4")]).mods).toEqual({ attackDie: -4, saveDie: -4 });
    expect(modsFromChanges([change("system.attributes.ac.bonus", "2")]).mods).toEqual({ ac: 2 });
    expect(modsFromChanges([change("system.attributes.ac.bonus", "-2"), change("system.attributes.movement.multiplier", "0.5", 1), change("system.abilities.dex.bonuses.save", "-2")]).mods)
      .toEqual({ ac: -2, speed: -15 });
    expect(modsFromChanges([change("system.attributes.movement.multiplier", "2", 1), change("system.attributes.ac.bonus", "2")]).mods).toEqual({ speed: 30, ac: 2 });
    expect(modsFromChanges([change("system.bonuses.mwak.damage", "1d4[radiant]")]).mods).toEqual({ damage: 3 });
    expect(modsFromChanges([change("system.attributes.hp.tempmax", "5")])).toEqual({ mods: {}, tempHp: 5, iwr: null });
    // Rage: its damage (the character's own number, already filled in) and its resistances.
    const rage = modsFromChanges([change("system.bonuses.mwak.damage", "+2"), ...["slashing", "piercing", "bludgeoning"].map(t => change("system.traits.dr.value", t))]);
    expect(rage.mods).toEqual({ damage: 2 });
    expect(rage.iwr).toEqual({ resist: { slashing: 1, piercing: 1, bludgeoning: 1 }, immune: [] });
    expect(modsFromChanges([change("system.attributes.movement.speed", "10")]).mods).toEqual({ speed: 10 });
    expect(modsFromChanges([change("system.magicalBonus", "1", 4)]).mods).toEqual({ attack: 1, damage: 1 });
    expect(modsFromChanges([change("system.magicalBonus", "1", 5)]).mods).toEqual({ attack: 1, damage: 1 }); // the 2014 SRD's
    expect(modsFromChanges([change("system.attributes.movement.bonus", "10")]).mods).toEqual({ speed: 10 }); // the 2014 SRD's Longstrider
    // What the engine doesn't play out is left out.
    expect(modsFromChanges([change("system.traits.ci.value", "frightened"), change("system.attributes.ac.calc", "mage", 5)]).mods).toEqual({});
  });

  test("the words say what the changes don't", () => {
    const faerie = fromWords("Attack rolls against an affected creature or object have Advantage if the attacker can see it.");
    expect(faerie.mods).toEqual({ defAdv: 1 });
    expect(fromWords("For the duration, any creature has Disadvantage on attack rolls against you.").mods).toEqual({ defAdv: -1 });
    const mock = fromWords("take 1d6 Psychic damage and have Disadvantage on the next attack roll it makes before the end of its next turn.");
    expect(mock.mods).toEqual({ adv: -1 });
    expect(mock.rounds).toBe(1);
    expect(fromWords("it gains an additional action on each of its turns.", { ac: 2 }).mods).toEqual({ actions: 1 });
    expect(fromWords("On its turns, it can take either an action or a Bonus Action, not both").conditions).toEqual({ slowed: 1 });
    expect(fromWords("At the end of each of its turns, the target repeats the save, ending the spell on itself on a success.").repeatSave).toBe(true);
    const charm = fromWords("It does so with Advantage if you or your allies are fighting it. On a failed save, the target has the Charmed condition until the spell ends or until you or your allies damage it.");
    expect(charm.saveAdvantage).toBe(true);
    expect(charm.endsOnHarm).toBe(true);
    expect(fromWords("you deal an extra 1d6 Necrotic damage to the target whenever you hit it with an attack roll").mark).toBe(true);
    expect(fromWords("Until it ends, an attacker subtracts 1d4 from the attack roll.").mods).toEqual({ ac: 2 }); // (not in the SRD: a paraphrase)
    // SRD 5.1 (2014) and SRD 5.2 (2024) wordings.
    expect(fromWords("Three illusory duplicates of yourself appear in your space.").mods).toEqual({ defAdv: -1 });
    expect(fromWords("An affected target can't take reactions and must roll a d10 at the start of each of its turns to determine its behavior for that turn.").conditions).toEqual({ incapacitated: 1 });
    expect(fromWords("that target can't take Bonus Actions or Reactions and must roll 1d10 at the start of each of its turns to determine its behavior").conditions).toEqual({ incapacitated: 1 });
    expect(fromWords("An affected target can't take reactions and must roll from the Confusion table at the start of each of its turns to determine its behavior for that turn.").conditions).toEqual({ incapacitated: 1 });
    expect(fromWords("The spell ends for a target that attacks or casts a spell.").endsOnAttack).toBe(true);
    expect(fromWords("The spell ends early immediately after the target makes an attack roll, deals damage, or casts a spell.").endsOnAttack).toBe(true);
    expect(fromWords("If you or creatures that are friendly to you are fighting it, it has advantage on the saving throw.").saveAdvantage).toBe(true);
    expect(fromWords("It must make a Wisdom saving throw, and does so with advantage if you or your companions are fighting it.").saveAdvantage).toBe(true);
    expect(fromWords("it is charmed by you until the spell ends or until you or your companions do anything harmful to it.").endsOnHarm).toBe(true);
  });

  test("labels read as how it leaves its target; buffs are told from debuffs", () => {
    expect(effectLabel({ names: ["Blessed"], mods: { attackDie: 4 } })).toBe("blessed");
    expect(effectLabel({ names: ["Bane"], mods: { attackDie: -4 } })).toBe(text("FASTFIGHTING.Effect.weakened"));
    expect(effectLabel({ names: ["Shimmering Field"], mods: { ac: 2 } })).toBe(text("FASTFIGHTING.Effect.shielded"));
    expect(effectLabel({ statuses: ["paralyzed"] })).toBe(text("FFDND5E.Cond.paralyzed").toLocaleLowerCase());
    expect(effectLabel({ names: ["Dominated"], statuses: ["charmed"] })).toBe("dominated");
    expect(effectLabel({ conditions: { incapacitated: 1 } })).toBe(text("FFDND5E.Worded.incapacitated"));
    expect(durationRounds({ value: 1, units: "minute" })).toBe(10);
    expect(helps({ attackDie: 4, saveDie: 4 })).toBe(true);
    expect(helps({ attackDie: -4 })).toBe(false);
    expect(helps({ defAdv: -1 })).toBe(true);
    expect(helps({ defAdv: 1 })).toBe(false);
  });
});

describe("5e buffs and debuffs in the engine", () => {
  const bless = { id: "bless", name: "Bless", kind: "buff", cost: 1, concentration: true, area: { targets: 3 }, range: { increment: 30, max: 30, noPenalty: true }, resource: "slots:1",
    outcome: { mods: { attackDie: 4, saveDie: 4 }, rounds: 10, label: "blessed" } };
  const cleric = (over = {}) => creature({ id: "cleric", kind: "pc", diesAtZero: false, resources: { "slots:1": 2 }, actions: [strike({ id: "mace", bonus: 4, damage: [parseFormula("1d6+2", "bludgeoning")] }), bless], ...over });
  const fighter = id => creature({ id, kind: "pc", diesAtZero: false, hp: { value: 60, max: 60, temp: 0 }, actions: [strike({ id: `${id}-sword`, bonus: 5 })] });
  const ogre = (over = {}) => creature({ id: "ogre", side: "hostile", hp: { value: 120, max: 120, temp: 0 }, defenses: { ac: 13, str: 4, dex: -1, con: 3, int: -3, wis: -2, cha: -2 },
    actions: [strike({ id: "club", bonus: 6, damage: [parseFormula("2d8+4", "bludgeoning")] })], traits: { tactical: { base: 30, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 50, fudge: 0 } }, ...over });

  test("a cleric opens with Bless on three of its party, and holds it by concentrating", () => {
    const r = replay(battle([cleric(), fighter("f1"), fighter("f2"), fighter("f3"), ogre()], { maxRounds: 3 }), dnd5eRules, 4);
    const b = r.log.find(e => e.type === "buff");
    expect(b?.round).toBe(1);
    expect(b.targets).toHaveLength(3);
    // The d4 rides with each blessed attack: d20 + mod = total still adds up.
    const blessedHit = r.log.find(e => e.type === "attack" && b.targetIds.includes(e.actorId) && e.round >= 1 && r.log.indexOf(e) > r.log.indexOf(b));
    expect(blessedHit.natural + blessedHit.mod).toBe(blessedHit.total);
  });

  test("concentration breaks under heavy blows", () => {
    let broke = 0;
    for ( let s = 1; s <= 20; s++ ) {
      const c = cleric({ defenses: { ac: 8, str: 0, dex: 0, con: -3, int: 0, wis: 3, cha: 0 }, hp: { value: 200, max: 200, temp: 0 } });
      const r = replay(battle([c, fighter("f1"), ogre({ actions: [strike({ id: "club", bonus: 9, damage: [parseFormula("4d8+8", "bludgeoning")] })] })], { maxRounds: 4 }), dnd5eRules, s);
      if ( r.log.some(e => e.type === "concentrationEnd" && e.reason === "blow") ) broke += 1;
    }
    expect(broke).toBeGreaterThan(2);
  });

  test("a Shove's save is the better of Strength and Dexterity", () => {
    const prone = { conditions: { prone: 1 }, rounds: 1, label: "knocked prone" };
    const shove = { id: "shove", name: "Shove", kind: "control", cost: 1, melee: true, reach: 5, save: { type: ["str", "dex"], dc: 14, basic: false }, onSave: [prone, prone, null, null] };
    const nimble = ogre({ defenses: { ac: 13, str: -5, dex: 30, con: 3, int: -3, wis: -2, cha: -2 } });
    const r = replay(battle([creature({ id: "a", actions: [shove] }), nimble], { maxRounds: 3 }), dnd5eRules, 2);
    for ( const e of r.log.filter(x => x.type === "control" && x.action === "Shove") ) expect(e.took).toBe(false);
  });

  test("Rage: the barbarian rages first, and its resistance halves the blows", () => {
    const rage = { id: "rage", name: "Rage", kind: "buff", targets: "self", cost: 1, economy: "bonus", uses: 3,
      outcome: { mods: { damage: 2 }, iwr: { resist: { slashing: 1, piercing: 1, bludgeoning: 1 } }, rounds: 100, label: "raging" } };
    const barbarian = (actions) => creature({ id: "barb", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300, temp: 0 }, actions: [strike({ id: "axe", bonus: 6, damage: [parseFormula("1d12+3", "slashing")] }), ...actions] });
    const r = replay(battle([barbarian([rage]), ogre()], { maxRounds: 3 }), dnd5eRules, 2);
    expect(r.log.find(e => e.type === "buff")?.round).toBe(1);
    const taken = actions => runBatchSync(battle([barbarian(actions), ogre()], { maxRounds: 4 }), dnd5eRules, { runs: 300, seed: 5 }).combatants.ogre.meanDamage;
    expect(taken([rage])).toBeLessThan(taken([]) * 0.7);
  });

  test("Action Surge: one more action, at once, and only once a turn", () => {
    const surge = { id: "surge", name: "Action Surge", kind: "buff", targets: "self", economy: "free", oncePerTurn: true, uses: 2, cost: 1, outcome: { actionsNow: 1, rounds: 1, label: "surging" } };
    const fighter = creature({ id: "fighter", kind: "pc", diesAtZero: false, hp: { value: 300, max: 300, temp: 0 }, actions: [strike({ id: "blade", bonus: 7 }), surge] });
    const r = replay(battle([fighter, ogre({ hp: { value: 300, max: 300, temp: 0 } })], { maxRounds: 2 }), dnd5eRules, 3);
    const round1 = r.log.filter(e => e.round === 1 && e.actorId === "fighter");
    expect(round1.filter(e => e.type === "buff")).toHaveLength(1);
    expect(round1.filter(e => e.type === "attack")).toHaveLength(2);
  });

  test("slowed: an action or a bonus action, not both, and no reactions", () => {
    const u = { conds: { slowed: 1 }, spec: { speeds: { walk: 30 } } };
    expect(dnd5eRules.turn(u).bonus).toBe(0);
    expect(dnd5eRules.reactions(u)).toBe(0);
  });

  test("a fight full of buffs, debuffs and charms runs clean", () => {
    const bane = { id: "bane", name: "Bane", kind: "control", cost: 1, concentration: true, area: { targets: 3 }, save: { type: "cha", dc: 13, basic: false }, range: { increment: 30, max: 30, noPenalty: true },
      onSave: [{ mods: { attackDie: -4, saveDie: -4 }, rounds: 10, label: "weakened" }, { mods: { attackDie: -4, saveDie: -4 }, rounds: 10, label: "weakened" }, null, null] };
    const charm = { id: "charm", name: "Charm Person", kind: "control", cost: 1, save: { type: "wis", dc: 13, basic: false, advantage: 1 }, range: { increment: 30, max: 30, noPenalty: true },
      onSave: [{ conditions: { controlled: 1 }, rounds: 600, label: "charmed", endsOnHarm: true }, { conditions: { controlled: 1 }, rounds: 600, label: "charmed", endsOnHarm: true }, null, null] };
    const dodge = { id: "dodge", name: "Dodge", kind: "buff", targets: "self", cost: 1, outcome: { mods: { defAdv: -1 }, rounds: 1, label: "dodging" } };
    const mage = creature({ id: "mage", kind: "pc", diesAtZero: false, actions: [strike({ id: "staff", bonus: 2 }), bane, charm, dodge] });
    const spec = battle([cleric(), mage, fighter("f1"), ogre(), ogre({ id: "ogre2", name: "ogre2" })], { maxRounds: 8 });
    expect(() => runBatchSync(spec, dnd5eRules, { runs: 100 })).not.toThrow();
  });
});
