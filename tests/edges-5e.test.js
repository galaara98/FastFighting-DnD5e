import { describe, expect, test } from "vitest";
import { replay } from "../../FastFighting/scripts/engine/simulator.js";
import { parseFormula } from "../scripts/core.js";
import { dnd5eRules } from "../scripts/rules.js";
import { fromWords } from "../scripts/effects.js";
import { helpAction, insightAction, edgeActions, studyCheck, INSIGHT_DC } from "../scripts/edges.js";

let n = 0;
const strike = (over = {}) => ({ id: `s${++n}`, name: "Longsword", kind: "strike", bonus: 5, melee: true, reach: 5, damage: [parseFormula("1d8+3", "slashing")], ...over });
const minded = { tactical: { base: 70, fudge: 0 }, brave: { base: 90, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
const creature = (over = {}) => ({
  id: over.id ?? `c${++n}`, name: over.name ?? over.id, side: "friendly", kind: "pc", level: 3,
  hp: { value: 40, max: 40, temp: 0 }, defenses: { ac: 15, str: 2, dex: 2, con: 2, int: 0, wis: 0, cha: 0 },
  initiative: { mod: 2 }, speeds: { walk: 30 }, actions: [strike()], iwr: {}, traits: minded, flags: {}, diesAtZero: false, ...over
});
const battle = (combatants, options = {}) => ({
  combatants,
  sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } },
  options: { positioning: false, opening: "fight", ...options }
});

describe("edges read from the words (SRD 5.1 and 5.2)", () => {
  test("Guidance, Bardic Inspiration, Vicious Mockery: one roll's worth", () => {
    expect(fromWords("Once before the spell ends, the target can roll a d4 and add the number rolled to one ability check of its choice.")).toMatchObject({ mods: { checkDie: 4 }, uses: 1 });
    const now = fromWords("You touch a willing creature and choose a skill. Until the spell ends, the creature adds 1d4 to any ability check using the chosen skill.");
    expect(now.mods).toEqual({ checkDie: 4 });
    expect(now.uses).toBeUndefined();
    expect(fromWords("Once within the next 10 minutes, the creature can roll the die and add the number rolled to one ability check, attack roll, or saving throw it makes."))
      .toMatchObject({ mods: { attackDie: 6, checkDie: 6, saveDie: 6 }, uses: 1, inspiration: true });
    expect(fromWords("it must succeed on a Wisdom saving throw or take 1d4 psychic damage and have disadvantage on the next attack roll it makes before the end of its next turn."))
      .toMatchObject({ mods: { adv: -1 }, uses: 1, rounds: 1 });
  });

  test("Guiding Bolt marks the target for the next attack; Steady Aim and True Strike are the caster's own", () => {
    expect(fromWords("On a hit, the target takes 4d6 radiant damage, and the next attack roll made against this target before the end of your next turn has advantage."))
      .toMatchObject({ mods: { defAdv: 1 }, uses: 1, rounds: 1 });
    expect(fromWords("As a bonus action, you give yourself advantage on your next attack roll on the current turn.")).toMatchObject({ mods: { adv: 1 }, uses: 1, self: true });
    expect(fromWords("On your next turn, you gain advantage on your first attack roll against the target, provided that this spell hasn't ended."))
      .toMatchObject({ mods: { adv: 1 }, uses: 1, vsFocus: true, self: true });
  });
});

describe("Help, Insight and Study", () => {
  test("who gets what", () => {
    expect(helpAction("a")).toMatchObject({ kind: "buff", besideFoe: 5, includeSelf: false, outcome: { mods: { adv: 1, checkAdv: 1 }, uses: 1, vsFocus: true } });
    expect(insightAction("a", 5)).toMatchObject({ targets: "self", check: { mod: 5, dc: INSIGHT_DC }, outcome: { mods: { checkAdv: 1 }, uses: 1, vsFocus: true } });
    const sys = { skills: { ins: { proficient: 1, total: 5 }, arc: { total: 2 }, his: { total: 6 }, inv: { total: 4 } }, traits: { languages: { value: new Set(["common"]) } } };
    expect(edgeActions({ id: "a", sys, mindless: false }).map(a => a.name)).toEqual(["Help", "Insight"]);
    expect(edgeActions({ id: "a", sys: { ...sys, traits: { languages: { value: new Set() } } }, mindless: false }).map(a => a.name)).toEqual(["Help"]);
    expect(edgeActions({ id: "a", sys, mindless: true })).toEqual([]);
    expect(studyCheck(sys)).toEqual({ mod: 6, label: "Study" });
  });

  test("a friend beside the foe who can't do much against it helps instead, and the advantage is spent on the next swing", () => {
    const at = (x, y = 0) => ({ x, y, size: 5 });
    const page = creature({ id: "page", position: at(10), initiative: { mod: -20 }, actions: [strike({ id: "jab", bonus: -2, damage: [parseFormula("1", "bludgeoning")] }), helpAction("page")] });
    const knight = creature({ id: "knight", position: at(0), initiative: { mod: 20 }, actions: [strike({ id: "lance", bonus: 4, damage: [parseFormula("2d6+4", "slashing")] })] });
    const ogre = creature({ id: "ogre", side: "hostile", kind: "npc", position: at(5), hp: { value: 300, max: 300, temp: 0 }, defenses: { ac: 18, str: 4, dex: 0, con: 4, int: -2, wis: 0, cha: 0 }, flags: { fearless: true },
      actions: [strike({ id: "club", bonus: 0, damage: [parseFormula("1d4", "bludgeoning")] })] });
    const r = replay(battle([knight, page, ogre], { positioning: true, maxRounds: 3 }), dnd5eRules, 2);
    const help = r.log.find(e => e.type === "buff" && e.actorId === "page");
    expect(help?.targetIds).toEqual(["knight"]);
    expect(help.against).toEqual(["ogre"]);
    const next = r.log.find(e => e.type === "attack" && e.actorId === "knight" && e.round > help.round);
    expect(next.advantage).toBe(1);
  });
});
