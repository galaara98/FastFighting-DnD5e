/**
 * Surprise as 5e has it (the planner's Follow System, rules.surprise): those hiding as it starts roll Stealth; anyone
 * against them that notices none of them (passive Perception under every roll) is surprised: the 2014 rules, its first
 * turn lost and no reaction until then; the 2024 rules, initiative at a disadvantage. No surprise round.
 */
import { describe, expect, test } from "vitest";
import { beginRun, prepareBattle } from "../../FastFighting/scripts/engine/simulator.js";
import { dnd5eRules } from "../scripts/rules.js";

const unit = (id, side, over = {}) => ({
  id, name: id, side, kind: "npc", level: 1, hp: { value: 20, max: 20 }, defenses: { ac: 13, str: 0, dex: 2, con: 1, int: 0, wis: 0, cha: 0 },
  initiative: { mod: 2, stealth: 4 }, perception: 2, speeds: { walk: 30 }, actions: [], iwr: {}, flags: { fearless: true }, diesAtZero: true, ...over
});
const begin = combatants => beginRun(prepareBattle({ combatants, sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { maxRounds: 2, surprise: "system" } }, dnd5eRules), 1);
// (Stealth +40: always unnoticed by Perception +2; Stealth -40: always noticed.)
const sneaky = (id, stealth = 40) => unit(id, "hostile", { hidden: true, initiative: { mod: 2, stealth } });

describe("5e's surprise", () => {
  test("nobody hiding: none", () => {
    expect(dnd5eRules.surprise(begin([unit("hero", "friendly"), unit("orc", "hostile")]))).toBeNull();
  });

  test("unnoticed by them: the 2014 rules lose it its first turn; the 2024 rules, initiative at a disadvantage", () => {
    const run = begin([unit("old", "friendly", { rulesVersion: "legacy" }), unit("new", "friendly", { rulesVersion: "modern" }), sneaky("orc")]);
    expect(run.surprise).toMatchObject({ by: ["hostile"], round: false, surprised: ["old"], disadvantage: ["new"] });
    expect(run.byId.get("old").reactionsLeft).toBe(0);
  });

  test("one that notices any of them isn't surprised; nor is anyone on their own side", () => {
    const run = begin([unit("hero", "friendly"), unit("ally", "hostile"), sneaky("orc"), sneaky("clumsy", -40)]);
    expect(run.surprise.surprised).toEqual([]);
    expect(run.surprise.disadvantage).toEqual([]);
  });
});
