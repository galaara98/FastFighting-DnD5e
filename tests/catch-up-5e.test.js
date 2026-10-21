/**
 * Caught up with the core (API 20 to 24):
 *  - aptitudes (API 23): smart, strong, fast, wise, charismatic from the ability modifiers; the mindless as dumb as it gets;
 *  - a player's death save (API 23): told from its card, as the engine tells its own; never from the sheet alone;
 *  - the dice the rules roll themselves, each a table roll a live battle shows (the core's recording rng): a death save,
 *    persistent damage's end, a hider's Stealth, putting out a fire (2014), an escape, the holder's save to keep down
 *    what it swallowed;
 *  - hidden from one creature at a time (API 20, hiddenFrom): one found by a Search is seen by it;
 *  - the engine's advantage on dnd5e's own saves and checks (API 24);
 *  - playstyle hints: the monk's Speed Runner is DPS and Kiter now.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { createRng } from "../../FastFighting/scripts/engine/rng.js";
import { recordingRng } from "../../FastFighting/scripts/engine/table-rolls.js";
import { APTITUDES } from "../scripts/core.js";
import { aptitudeBand, aptitudesOf } from "../scripts/traits.js";
import { deathSaveOf, readDnd5eTurn } from "../scripts/read-turn.js";
import { dnd5eRules } from "../scripts/rules.js";
import { breakFree } from "../scripts/holds.js";
import { spitUp } from "../scripts/inside.js";
import { rollDnd5eSave, rollDnd5eCheck } from "../scripts/adapter.js";
import { dnd5eHints } from "../scripts/auto.js";
import { text } from "./foundry-i18n.js";

const rolls = rng => rng.tray.rolls;

describe("aptitudes", () => {
  test("each modifier banded: -3 or lower 0, -2 to -1 1, +0 to +2 2, +3 to +4 3, +5 or higher 4", () => {
    expect([-5, -3, -2, -1, 0, 2, 3, 4, 5, 10].map(aptitudeBand)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  test("all five, from the ability each is read from; a zombie dumb whatever its modifier says", () => {
    const a = aptitudesOf({ abilities: { str: 4, dex: -2, int: 5, wis: 0, cha: -4 }, int: 20, creature: "humanoid" });
    expect(a).toEqual({ smart: 4, strong: 3, fast: 1, wise: 2, charismatic: 0 });
    expect(Object.keys(a)).toEqual([...APTITUDES]);
    expect(aptitudesOf({ abilities: { str: 1, int: -4 }, int: 3, creature: "undead" }).smart).toBe(0);
    // (A wolf: animal wits, not mindless; its Intelligence -4 is dumb all the same.)
    expect(aptitudesOf({ abilities: { str: 1, dex: 2, int: -4, wis: 1, cha: -2 }, int: 3, creature: "beast" })).toMatchObject({ smart: 0, fast: 2 });
  });
});

describe("a player's death save, read off its card", () => {
  /** A death save card as dnd5e 6 makes one: a save message of type "death", its outcome once applied. */
  const card = (total, outcome = null, token = "pc") => ({ type: "save", speaker: { token }, system: { type: "death", outcome }, rolls: [{ total, options: { target: 10 } }] });

  test("what dnd5e wrote on it: a success or a failure, a 20 back on its feet, stable on a third success, dead on a third failure", () => {
    expect(deathSaveOf(card(14))).toEqual({ success: true, outcome: null });
    expect(deathSaveOf(card(7))).toEqual({ success: false, outcome: null });
    expect(deathSaveOf({ type: "save", system: { type: "ability" }, rolls: [{ total: 12 }] })).toBeNull();
    expect(deathSaveOf({ type: "check", system: {}, rolls: [{ total: 12 }] })).toBeNull();
  });

  test("its turn read: a recovery event, as the core tells the engine's own, with the tally the sheet has now", () => {
    const read = messages => readDnd5eTurn(messages, { tokenId: "pc", ids: {}, death: { success: 2, failure: 1 } });
    expect(read([card(14)])).toEqual([{ type: "recovery", better: true, text: text("FFDND5E.Death.Success", { s: 2, f: 1 }), sure: true }]);
    expect(read([card(5)])).toEqual([{ type: "recovery", better: false, text: text("FFDND5E.Death.Failure", { s: 2, f: 1 }), sure: true }]);
    expect(read([card(20, "revive")])[0]).toMatchObject({ better: true, revived: true, text: text("FFDND5E.Death.Twenty") });
    expect(read([card(12, "stable")])[0]).toMatchObject({ better: true, stable: true, text: text("FFDND5E.Death.Stable") });
    expect(read([card(3, "death")])[0]).toMatchObject({ better: false, text: text("FFDND5E.Death.Dies") });
    // (Another's card isn't this turn's.)
    expect(read([card(14, null, "other")])).toEqual([]);
  });

  test("never from the sheet alone (the rules' recoveryRead: nothing to tell)", () => {
    expect(dnd5eRules.recoveryRead({}, { before: { dying: 1 }, now: { dying: 2 } })).toBeNull();
  });
});

describe("the rules' own dice, each a table roll a live battle shows", () => {
  test("a death save: a save against 10, the dying creature's", () => {
    const rng = recordingRng(createRng(4));
    const hero = { id: "hero", status: "down", stable: false, dying: 0, spec: { name: "hero" } };
    dnd5eRules.recoveryCheck(hero, rng);
    const [roll, ...more] = rolls(rng);
    expect(more).toEqual([]);
    expect(roll).toMatchObject({ by: "hero", kind: "save", what: "recovery", dc: 10 });
    expect(roll.total).toBe(roll.dice[0].result);
  });

  test("persistent damage's end: DC 11, its bearer's", () => {
    const rng = recordingRng(createRng(9));
    dnd5eRules.persistentFlatCheck(rng, { unit: { id: "hero" }, type: "fire" });
    expect(rolls(rng)).toEqual([expect.objectContaining({ by: "hero", kind: "flat", dc: 11 })]);
  });

  test("a hider's Stealth as the fight begins, against its foes' best passive Perception: one each", () => {
    const rng = recordingRng(createRng(2));
    const unit = (id, side, spec = {}) => ({ id, side, spec: { perception: 3, initiative: { stealth: 5 }, ...spec } });
    const units = [unit("sneak", "hostile", { hidden: true }), unit("lookout", "friendly", { perception: 6 }), unit("hero", "friendly")];
    const run = { rng, units, prep: { sides: { friendly: { enemies: new Set(["hostile"]) }, hostile: { enemies: new Set(["friendly"]) } } } };
    dnd5eRules.surprise(run);
    expect(rolls(rng)).toEqual([expect.objectContaining({ by: "sneak", kind: "check", what: "stealth", mod: 5, dc: 17 })]);
  });

  test("putting out a fire on itself, the 2014 rules: a DC 10 Dexterity check, labelled", () => {
    const rng = recordingRng(createRng(5));
    const u = { id: "hero", conds: { burning: 1 }, effects: [], spec: { rulesVersion: "legacy", escapeWork: { dex: 2 } } };
    const run = { rng, prep: { rules: dnd5eRules } };
    const douse = dnd5eRules.remedies(run, u).find(r => r.condition === "burning");
    douse.try(run, u);
    expect(rolls(rng)).toEqual([expect.objectContaining({ by: "hero", kind: "check", mod: 2, dc: 10 })]);
    expect(rolls(rng)[0].label).toBeTruthy();
  });

  test("an escape the engine rolls, and the holder's save to keep down what it swallowed", () => {
    const rng = recordingRng(createRng(7));
    const u = { id: "hero", side: "friendly", status: "standing", conds: {}, effects: [], adjacent: new Set(), spec: { level: 1, escapeWork: { mod: 4, ath: 4, acr: 1, str: 2, dex: 1 } } };
    const run = { rng, prep: { rules: dnd5eRules, sides: {} }, units: [u], byId: new Map([[u.id, u]]) };
    breakFree(run, u, { key: "grabbed", dc: 13 }, { held: u });
    expect(rolls(rng)).toEqual([expect.objectContaining({ by: "hero", kind: "check", dc: 13, label: "grabbed" })]);

    const srng = recordingRng(createRng(3));
    const worm = { id: "worm", side: "hostile", status: "standing", conds: {}, effects: [], spec: { name: "Worm", defenses: { con: 3 }, inside: { key: "swallowed", spit: { after: 10, save: { type: "con", dc: 21 } } } } };
    const hero = { id: "hero", side: "friendly", status: "standing", conds: { swallowed: 1 }, effects: [{ key: "swallowed", conditions: { swallowed: 1 }, sourceId: "worm" }], spec: { name: "Hero" } };
    const srun = { rng: srng, round: 1, turn: 2, prep: { rules: dnd5eRules, sides: {} }, units: [worm, hero], byId: new Map([[worm.id, worm], [hero.id, hero]]) };
    spitUp(srun, worm, 15, srng, hero);
    expect(rolls(srng)).toEqual([expect.objectContaining({ by: "worm", kind: "save", mod: 3, dc: 21 })]);
  });

  test("a simulation's plain rng records nothing", () => {
    const rng = createRng(4);
    const hero = { id: "hero", status: "down", stable: false, dying: 0, spec: { name: "hero" } };
    expect(() => dnd5eRules.recoveryCheck(hero, rng)).not.toThrow();
    expect(dnd5eRules.persistentFlatCheck(rng, { unit: hero })).toEqual(expect.any(Boolean));
  });
});

describe("hidden from one creature at a time", () => {
  const at = (attacker, target) => dnd5eRules.modifiers.attack({ attacker, target, action: { melee: true }, distance: 5 }).advantage;
  const unit = (id, conds = {}, foundBy = []) => ({ id, conds, spec: { flags: {} }, foundBy: new Set(foundBy) });

  test("its blows have advantage on one that hasn't found it; one that found it with a Search sees it", () => {
    expect(at(unit("sneak", { hidden: 1 }), unit("guard"))).toBe(1);
    expect(at(unit("sneak", { hidden: 1 }, ["guard"]), unit("guard"))).toBe(0);
    expect(at(unit("guard"), unit("sneak", { hidden: 1 }))).toBe(-1);
    expect(at(unit("guard"), unit("sneak", { hidden: 1 }, ["guard"]))).toBe(0);
  });
});

describe("the engine's advantage on dnd5e's own saves and checks", () => {
  const actor = () => {
    const a = {
      system: { abilities: { dex: { mod: 2, save: { value: 4 } } }, skills: { prc: { total: 3 } } },
      items: []
    };
    for ( const k of ["rollSavingThrow", "rollSkill", "rollAbilityCheck"] ) a[k] = vi.fn(async () => [{ total: 15, d20: { total: 12 } }]);
    return a;
  };

  test("advantage, disadvantage, or neither, as dnd5e's roll settings", async () => {
    const a = actor();
    const token = { actor: a };
    await rollDnd5eSave(token, { save: "dex", dc: 14, advantage: 1 });
    expect(a.rollSavingThrow.mock.calls[0][0]).toEqual({ ability: "dex", target: 14, advantage: true });
    await rollDnd5eSave(token, { save: "dex", dc: 14, advantage: -1 });
    expect(a.rollSavingThrow.mock.calls[1][0]).toEqual({ ability: "dex", target: 14, disadvantage: true });
    await rollDnd5eSave(token, { save: "dex", dc: 14 });
    expect(a.rollSavingThrow.mock.calls[2][0]).toEqual({ ability: "dex", target: 14 });
    // (A Search: Perception, the core's seek.)
    await rollDnd5eCheck(token, { purpose: "seek", dc: 15, advantage: 1 });
    expect(a.rollSkill.mock.calls[0][0]).toEqual({ skill: "prc", target: 15, advantage: true });
  });
});

describe("playstyle hints", () => {
  test("a monk leans DPS and Kiter; Speed Runner is named nowhere", () => {
    const hints = dnd5eHints({ classes: ["monk"] });
    expect(hints.dps).toBeGreaterThan(0);
    expect(hints.kiter).toBeGreaterThan(0);
    expect(hints.speedRunner ?? 0).toBe(0);
    const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
    for ( const f of fs.readdirSync(scripts).filter(n => n.endsWith(".js")) ) expect(fs.readFileSync(path.join(scripts, f), "utf8")).not.toContain("speedRunner");
  });
});
