/**
 * A character's personality, as D&D 5e reads it: a player character from everything on its sheet, a creature from what
 * it is. Features and identifiers as the SRD has them (2014 and 2024).
 */
import { describe, test, expect } from "vitest";
import { deriveDnd5eTraits, effectLeans } from "../scripts/traits.js";
import { PC_BASELINE } from "../scripts/core.js";

/** The usual hero's numbers (Intelligence and Wisdom 12, Constitution 14, its Wisdom save for its level, level 5) unless told otherwise. */
const SCORES = { str: 10, dex: 14, con: 14, int: 12, wis: 12, cha: 10 };
const pc = ({ scores, ...extra } = {}) => deriveDnd5eTraits({ type: "character", level: 5, wisSave: 2, scores: { ...SCORES, ...scores }, features: [], ...extra });
const cls = (id, levels = 1, subclass = null) => ({ id, name: `${id}!`, levels, subclass: subclass ? { id: subclass, name: `${subclass}!` } : null });

// Effects as the SRD's own features have them (dnd5e's classes24 and origins24).
const MINDLESS_RAGE = [{ disabled: true, changes: [{ key: "system.traits.ci.value", value: "charmed" }, { key: "system.traits.ci.value", value: "frightened" }] }];
const GNOMISH_CUNNING = [{ disabled: false, changes: ["int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.save.roll.mode`, value: "1" })) }];
const DANGER_SENSE = [{ disabled: false, changes: [{ key: "system.abilities.dex.save.roll.mode", value: "1" }] }];
const FEARLESS = [{ disabled: false, changes: [{ key: "system.traits.ci.value", value: "frightened" }] }];

describe("a 5e player character's traits, from its sheet", () => {
  test("the usual hero's numbers make the usual hero, at any level but for experience", () => {
    expect(pc().traits).toEqual(PC_BASELINE);
    // (Its Wisdom save keeps up with its level: +2 at 1st, +4 at 17th.)
    expect(pc({ level: 1, wisSave: 2 }).traits).toEqual({ ...PC_BASELINE, tactical: PC_BASELINE.tactical - 2 });
    expect(pc({ level: 17, wisSave: 4 }).traits).toEqual({ ...PC_BASELINE, tactical: PC_BASELINE.tactical + 6 });
  });

  test("no two alike: a sage wizard thinks ahead, a cleric's faith steadies her, a criminal looks out for itself", () => {
    const wizard = pc({ level: 1, scores: { int: 17, wis: 12 }, wisSave: 3, classes: [cls("wizard", 1)], background: { id: "sage", name: "Sage" }, skills: { arc: 1, his: 1, inv: 1 } }).traits;
    const cleric = pc({ level: 1, scores: { int: 10, wis: 16 }, wisSave: 5, classes: [cls("cleric", 1)], background: { id: "acolyte", name: "Acolyte" }, alignment: "lg", skills: { med: 1, rel: 1 } }).traits;
    const fighter = pc({ level: 1, scores: { int: 10, wis: 8 }, wisSave: -1, classes: [cls("fighter", 1)], background: { id: "soldier", name: "Soldier" }, skills: { ath: 1, prc: 1 } }).traits;
    const rogue = pc({ level: 1, scores: { int: 14, wis: 12 }, wisSave: 1, classes: [cls("rogue", 1)], background: { id: "criminal", name: "Criminal" }, alignment: "cn", skills: { slt: 2, dec: 1, ste: 2 } }).traits;
    expect(wizard.tactical).toBeGreaterThan(Math.max(cleric.tactical, fighter.tactical, rogue.tactical));
    expect(cleric.brave).toBeGreaterThan(Math.max(wizard.brave, fighter.brave, rogue.brave));
    expect(fighter.brave).toBeLessThan(PC_BASELINE.brave);
    expect(rogue.selfish).toBeGreaterThan(PC_BASELINE.selfish + 10);
    expect(cleric.selfish).toBeLessThan(PC_BASELINE.selfish - 10);
    expect(fighter.loyal).toBeGreaterThan(rogue.loyal);
    expect(new Set([wizard, cleric, fighter, rogue].map(x => JSON.stringify(x))).size).toBe(4);
  });

  test("its classes count by their share of its levels, and a subclass with them", () => {
    const paladin = pc({ classes: [cls("paladin", 10)] }).traits;
    const dabbler = pc({ classes: [cls("paladin", 2), cls("rogue", 8)] }).traits;
    expect(paladin.selfish).toBeLessThan(dabbler.selfish);
    expect(paladin.loyal).toBeGreaterThan(dabbler.loyal);
    const berserker = pc({ classes: [cls("barbarian", 5, "berserker")] }).traits;
    expect(berserker.brave).toBeGreaterThan(pc({ classes: [cls("barbarian", 5)] }).traits.brave);
    // (The 2014 SRD's identifier is read the same.)
    expect(pc({ classes: [cls("barbarian", 5, "path-of-the-berserker")] }).traits).toEqual(berserker);
  });

  test("features by what their effects do, the rest by identifier", () => {
    expect(effectLeans(FEARLESS)).toEqual({ brave: 10 });
    // (Mindless Rage's immunities are on only while raging: half.)
    expect(effectLeans(MINDLESS_RAGE)).toEqual({ brave: 6 });
    expect(effectLeans(GNOMISH_CUNNING)).toEqual({ brave: 3 });
    expect(effectLeans(DANGER_SENSE)).toEqual({});
    // 2024's Mindless Rage by its effects, 2014's (no effects) by its identifier: the same.
    const raging = pc({ items: [{ id: "mindless-rage", name: "Mindless Rage", effects: MINDLESS_RAGE }] });
    expect(raging.traits.brave).toBe(PC_BASELINE.brave + 6);
    expect(pc({ items: [{ id: "mindless-rage", name: "Mindless Rage", effects: [] }] }).traits).toEqual(raging.traits);
    expect(raging.flags.fearless).toBeUndefined();
    // A halfling's Brave, a paladin's Aura of Courage, an orc's Relentless Endurance.
    const halfling = pc({ items: [{ id: "brave", name: "Brave", effects: [] }] });
    expect(halfling.traits.brave).toBeGreaterThan(PC_BASELINE.brave);
    expect(halfling.reasons.brave).toContain("Brave");
    expect(pc({ items: [{ id: "aura-of-courage", name: "Aura of Courage", effects: [] }] }).traits.brave).toBeGreaterThan(PC_BASELINE.brave);
    expect(pc({ items: [{ id: "relentless-endurance", name: "Relentless Endurance", effects: [] }] }).traits.brave).toBeGreaterThan(PC_BASELINE.brave);
    // (One it doesn't know, and that does nothing it reads, says nothing.)
    expect(pc({ items: [{ id: "darkvision", name: "Darkvision", effects: [] }] }).traits).toEqual(PC_BASELINE);
  });

  test("nothing can frighten one immune to it: a fearless one", () => {
    const own = pc({ ci: ["frightened"] });
    expect(own.flags.fearless).toBe(true);
    expect(own.traits.brave).toBe(PC_BASELINE.brave + 10);
    const byFeature = pc({ items: [{ id: "unknown-boon", name: "Boon", effects: FEARLESS }] });
    expect(byFeature.flags.fearless).toBe(true);
    expect(byFeature.traits.brave).toBe(PC_BASELINE.brave + 10);
  });

  test("good less selfish, evil more; lawful more loyal, chaotic less", () => {
    const lg = pc({ alignment: "lg" }).traits;
    const ce = pc({ alignment: "ce" }).traits;
    expect(lg.selfish).toBeLessThan(PC_BASELINE.selfish);
    expect(ce.selfish).toBeGreaterThan(PC_BASELINE.selfish);
    expect(lg.loyal).toBeGreaterThan(PC_BASELINE.loyal);
    expect(ce.loyal).toBeLessThan(PC_BASELINE.loyal);
    expect(pc({ alignment: "tn" }).traits).toEqual(PC_BASELINE);
  });

  test("healing others, skills, a weary body", () => {
    const healer = pc({ heals: ["Cure Wounds", "Healing Word"] });
    expect(healer.traits.selfish).toBeLessThan(PC_BASELINE.selfish);
    expect(healer.reasons.selfish).toContain("Cure Wounds");
    expect(pc({ skills: { slt: 2 } }).traits.selfish).toBeGreaterThan(pc({ skills: { slt: 1 } }).traits.selfish);
    expect(pc({ skills: { inv: 1, his: 1 } }).traits.tactical).toBeGreaterThan(PC_BASELINE.tactical);
    // (Half proficiency, a bard's Jack of All Trades, isn't proficiency.)
    expect(pc({ skills: { slt: 0.5 } }).traits).toEqual(PC_BASELINE);
    expect(pc({ exhaustion: 2 }).traits.brave).toBeLessThan(PC_BASELINE.brave);
  });

  test("one who isn't in the party is less bound to the others", () => {
    expect(pc({ inParty: false }).traits.loyal).toBe(PC_BASELINE.loyal - 10);
    expect(pc({ inParty: true }).traits.loyal).toBe(PC_BASELINE.loyal);
    expect(pc({ inParty: undefined }).traits.loyal).toBe(PC_BASELINE.loyal);
  });

  test("each trait's reason says where it started and what moved it", () => {
    const { reasons } = pc({ classes: [cls("paladin", 5, "devotion")] });
    expect(reasons.selfish).toContain("paladin!");
    expect(reasons.loyal).toContain("devotion!");
    expect(reasons.tactical).toContain(String(PC_BASELINE.tactical));
  });
});

describe("a 5e creature's traits", () => {
  const npc = extra => deriveDnd5eTraits({ type: "npc", creature: "humanoid", int: 10, wis: 0, level: 1, wisSave: 0, features: [], ...extra });

  test("its alignment moves it, more than a hero's", () => {
    const plain = npc().traits;
    const lg = npc({ alignment: "lg" }).traits;
    const ce = npc({ alignment: "ce" }).traits;
    expect(lg.selfish).toBeLessThan(plain.selfish);
    expect(ce.selfish).toBeGreaterThan(plain.selfish);
    expect(lg.loyal).toBeGreaterThan(plain.loyal);
    expect(ce.loyal).toBeLessThan(plain.loyal);
    expect(plain.selfish - lg.selfish).toBeGreaterThan(PC_BASELINE.selfish - pc({ alignment: "lg" }).traits.selfish);
    expect(plain.loyal - ce.loyal).toBeGreaterThan(PC_BASELINE.loyal - pc({ alignment: "ce" }).traits.loyal);
  });

  test("a devil's hierarchy, a demon's chaos; what it's immune to; its features", () => {
    const devil = npc({ creature: "fiend", subtype: "Devil", int: 14 }).traits;
    const demon = npc({ creature: "fiend", subtype: "Demon, Shapechanger", int: 14 }).traits;
    const fiend = npc({ creature: "fiend", int: 14 }).traits;
    expect(devil.loyal).toBeGreaterThan(fiend.loyal);
    expect(demon.loyal).toBeLessThan(fiend.loyal);
    const golem = npc({ creature: "construct", int: 6, ci: ["charmed", "frightened"] });
    expect(golem.flags.fearless).toBe(true);
    const lich = npc({ creature: "undead", int: 20, ci: ["frightened"] });
    expect(lich.traits.brave).toBeGreaterThan(npc({ creature: "undead", int: 20 }).traits.brave);
    expect(lich.flags.fearless).toBe(true);
    const knight = npc({ features: ["brave"], items: [{ id: "brave", name: "Brave", effects: [] }] });
    expect(knight.traits.brave).toBeGreaterThan(npc().traits.brave);
    expect(npc({ features: ["pack-tactics"], items: [{ id: "pack-tactics", name: "Pack Tactics", effects: [] }] }).traits.loyal).toBeGreaterThan(npc().traits.loyal);
  });

  test("one summoned serves its summoner; a loyalty score says how loyal", () => {
    expect(npc({ hasMaster: true }).traits.loyal).toBe(85);
    expect(npc({ loyalty: 20 }).traits.loyal).toBeGreaterThan(npc({ loyalty: 10 }).traits.loyal);
    expect(npc({ loyalty: 2 }).traits.loyal).toBeLessThan(npc().traits.loyal);
  });

  test("the mindless don't change: nothing but what can't touch them moves them", () => {
    const zombie = deriveDnd5eTraits({ type: "npc", creature: "undead", int: 3, wis: -2, level: 0.25, wisSave: 0, alignment: "ne", features: [], items: [{ id: "undead-fortitude", name: "Undead Fortitude", effects: [] }], heals: ["Mending"] });
    expect(zombie.traits).toEqual({ tactical: 5, brave: 100, selfish: 50, loyal: 90 });
    expect(zombie.flags.mindless).toBe(true);
  });

  test("its reasons list what moved it", () => {
    const { reasons } = npc({ creature: "fiend", subtype: "Devil", alignment: "le" });
    expect(reasons.loyal).toContain("Devil");
  });
});
