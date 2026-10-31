/**
 * What this helper takes up of the core's API 38 to 42: a grapple that ends once the grappled creature is out of the
 * grappler's reach (rules.grabEndsOnMove "reach", API 42), and dnd5e's own turn and recharge cards taken with their
 * creature's turn for Rewind (systemTurnCard, API 40).
 */
import { describe, expect, test } from "vitest";
import { beginRun, beginRound, prepareBattle, answerMove } from "../../FastFighting/scripts/engine/simulator.js";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { systemTurnCard } from "../scripts/cards.js";
import { dnd5eRules } from "../scripts/rules.js";
import { parseFormula } from "../scripts/core.js";

let n = 0;
const fighter = (id, side, x, reach = 5) => ({
  id, name: id, side, kind: "npc", level: 3, hp: { value: 300, max: 300, temp: 0 }, defenses: { ac: 15, str: 2, dex: 2, con: 2, int: 0, wis: 0, cha: 0 },
  initiative: { mod: 2 }, speeds: { walk: 30 }, iwr: {}, flags: { fearless: true }, diesAtZero: false,
  actions: [{ id: `s${++n}`, name: "Claw", kind: "strike", bonus: 5, melee: true, reach, damage: [parseFormula("1d8+3", "slashing")], hands: 1 }],
  traits: { tactical: { base: 60, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
  escapeWork: { mod: 2, ath: 2, acr: 0, str: 1, dex: 0 }, escapeDC: 13, position: { x, y: 0, size: 5 }
});
function fight(list) {
  const battle = { combatants: list, sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } }, options: { positioning: true, opening: "fight", maxRounds: 6 } };
  const run = beginRun(prepareBattle(battle, dnd5eRules), 3, { log: true });
  beginRound(run, 1);
  return run;
}
const moveTo = (run, u, x, y = u.pos.y) => {
  const from = { ...u.pos };
  Object.assign(u.pos, { x, y });
  answerMove(run, u, { feet: Math.hypot(x - from.x, y - from.y), from, to: { ...u.pos }, reached: false });
};

describe("a grapple ends once the grappled creature is out of reach", () => {
  test("a step that keeps it in reach keeps the grapple; walking off ends it, told", () => {
    const run = fight([fighter("hero", "friendly", 0), fighter("orc", "hostile", 5)]);
    const [hero, orc] = ["hero", "orc"].map(id => run.byId.get(id));
    orc.grabbedBy = hero.id;
    moveTo(run, hero, 5, 5);
    expect(orc.grabbedBy).toBe(hero.id);
    moveTo(run, hero, -20, 0);
    expect(orc.grabbedBy).toBeNull();
    expect(run.log.some(e => e.type === "letGo" && e.actorId === "orc" && e.byId === "hero")).toBe(true);
  });

  test("a grappler with a 10-foot reach holds 10 feet off", () => {
    const run = fight([fighter("ogre", "hostile", 0, 10), fighter("hero", "friendly", 5)]);
    const [ogre, hero] = ["ogre", "hero"].map(id => run.byId.get(id));
    hero.grabbedBy = ogre.id;
    moveTo(run, ogre, -5);
    expect(hero.grabbedBy).toBe(ogre.id);
    moveTo(run, ogre, -10);
    expect(hero.grabbedBy).toBeNull();
  });
});

describe("dnd5e's own cards as turns go (systemTurnCard)", () => {
  test("its turn card and a recharge roll; never a roll, a usage card or a line of chat", () => {
    expect(["turn", "recharge"].map(type => systemTurnCard({ type }))).toEqual([true, true]);
    expect(["attack", "damage", "save", "usage", "check", "base", undefined].map(type => systemTurnCard({ type }))).toEqual(Array(7).fill(false));
    expect(systemTurnCard(null)).toBe(false);
    expect(new Dnd5eAdapter().systemTurnCard({ type: "turn" })).toBe(true);
  });
});
