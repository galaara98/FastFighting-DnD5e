import { describe, expect, test } from "vitest";
import { dnd5eRules, proficiency } from "../scripts/rules.js";
import { parseMultiattack } from "../scripts/multiattack.js";
import { payFrom } from "../scripts/commit.js";
import { deriveDnd5eTraits } from "../scripts/traits.js";
import { degreeDistribution } from "../scripts/core.js";

const unit = (extra = {}) => ({ spec: { diesAtZero: false, speeds: { walk: 30 } }, maxHp: 20, hp: 0, status: "standing", conds: {}, ...extra });

describe("5e rolls", () => {
  test("attacks crit on a 20 and miss on a 1; saves just meet the DC", () => {
    expect(dnd5eRules.degreeOfSuccess(20, 5, 30, "attack")).toBe(3);
    expect(dnd5eRules.degreeOfSuccess(1, 40, 10, "attack")).toBe(1);
    expect(dnd5eRules.degreeOfSuccess(20, 25, 15, "save")).toBe(2);
    expect(dnd5eRules.degreeOfSuccess(10, 14, 15, "save")).toBe(1);
  });

  test("advantage helps, as the odds say", () => {
    const plain = degreeDistribution(dnd5eRules, 5, 15, { kind: "attack" });
    const adv = degreeDistribution(dnd5eRules, 5, 15, { kind: "attack", advantage: 1 });
    expect(adv[2] + adv[3]).toBeGreaterThan(plain[2] + plain[3] + 0.15);
  });

  test("a critical hit doubles the dice, not the modifier", () => {
    const [p] = dnd5eRules.critical([{ dice: [{ n: 1, faces: 8, mult: 1 }], flat: 3, type: "slashing" }]);
    expect(p.dice[0].n).toBe(2);
    expect(p.flat).toBe(3);
  });

  test("resistance halves, vulnerability doubles, immunity ignores", () => {
    const iwr = { immune: ["poison"], resist: { fire: 1 }, weak: { cold: 1 } };
    expect(dnd5eRules.applyIwr(iwr, { poison: 10, fire: 9, cold: 4 })).toBe(4 + 8);
  });

  test("proficiency by level", () => {
    expect([1, 4, 5, 9, 13, 17].map(proficiency)).toEqual([2, 2, 3, 4, 5, 6]);
  });
});

describe("5e dying", () => {
  test("three failed death saves kill, three successes stabilize, a 20 brings you back", () => {
    const c = unit();
    dnd5eRules.onDropped(c, {});
    expect(c.status).toBe("down");
    const rng = (rolls => ({ d20: () => rolls.shift() }))([5, 12, 3, 4]);
    dnd5eRules.recoveryCheck(c, rng); // fail
    dnd5eRules.recoveryCheck(c, rng); // success
    dnd5eRules.recoveryCheck(c, rng); // fail
    expect(c.status).toBe("down");
    dnd5eRules.recoveryCheck(c, rng); // third failure
    expect(c.status).toBe("dead");

    const d = unit();
    dnd5eRules.onDropped(d, {});
    const lucky = { d20: () => 20 };
    expect(dnd5eRules.recoveryCheck(d, lucky)).toMatch(/1 HP/);
    expect(d.status).toBe("standing");
    expect(d.hp).toBe(1);
  });

  test("damage while down is a failed save (two on a critical); massive damage kills outright", () => {
    const c = unit();
    dnd5eRules.onDropped(c, {});
    dnd5eRules.onDropped(c, { crit: true });
    expect(c.deathFailures).toBe(2);
    const big = unit();
    dnd5eRules.onDropped(big, { overflow: 25 });
    expect(big.status).toBe("dead");
  });
});

describe("5e situations", () => {
  const m = dnd5eRules.modifiers;
  test("a prone target: advantage up close, disadvantage from range", () => {
    const attacker = { conds: {}, spec: { flags: {} } };
    const target = { conds: {}, prone: true };
    expect(m.attack({ attacker, target, action: { melee: true }, distance: 5 }).advantage).toBe(1);
    expect(m.attack({ attacker, target, action: { range: { increment: 80 } }, distance: 30 }).advantage).toBe(-1);
  });
  test("advantage and disadvantage cancel", () => {
    const attacker = { conds: { poisoned: 1 }, spec: { flags: {} } };
    const target = { conds: { restrained: 1 } };
    expect(m.attack({ attacker, target, action: { melee: true }, distance: 5 }).advantage).toBe(0);
  });
  test("pack tactics", () => {
    const attacker = { conds: {}, spec: { flags: { packTactics: true } } };
    expect(m.attack({ attacker, target: { conds: {} }, action: { melee: true }, alliesAdjacent: 1 }).advantage).toBe(1);
  });
  test("paralyzed creatures fail Strength and Dexterity saves", () => {
    expect(m.save({ unit: { conds: { paralyzed: 1 } }, type: "dex" }).bonus).toBeLessThan(-50);
    expect(m.save({ unit: { conds: { paralyzed: 1 } }, type: "wis" }).bonus).toBe(0);
  });
});

describe("Multiattack", () => {
  test("one with each weapon", () => {
    expect(parseMultiattack("<p>The goblin makes two attacks: one with its scimitar and one with its shortbow.</p>", ["Scimitar", "Shortbow"])).toEqual(["Scimitar", "Shortbow"]);
  });
  test("one bite and two claws", () => {
    expect(parseMultiattack("The bear makes three attacks: one with its bite and two with its claws.", ["Bite", "Claws"])).toEqual(["Bite", "Claws", "Claws"]);
  });
  test("two of the same", () => {
    expect(parseMultiattack("The ogre makes two greatclub attacks.", ["Greatclub", "Javelin"])).toEqual(["Greatclub", "Greatclub"]);
  });
  test("any combination: the best named", () => {
    expect(parseMultiattack("The captain makes three attacks, using Scimitar or Pistol in any combination.", ["Pistol", "Scimitar"])).toEqual(["Pistol", "Pistol", "Pistol"]);
  });
  test("attacks twice", () => {
    expect(parseMultiattack("The wolf attacks twice.", ["Bite"])).toEqual(["Bite", "Bite"]);
  });
});

describe("paying out coins", () => {
  test("small coins first, breaking a bigger one for change", () => {
    const left = payFrom({ cp: 5, sp: 2, gp: 3 }, 135);
    const total = p => p.cp + p.sp * 10 + p.ep * 50 + p.gp * 100 + p.pp * 1000;
    expect(total(left)).toBe(5 + 20 + 300 - 135);
    expect(payFrom({ gp: 1 }, 500)).toBeNull();
  });
});

describe("5e personality", () => {
  test("beasts are instinctive; the mindless undead are fearless", () => {
    expect(deriveDnd5eTraits({ type: "npc", creature: "beast", int: 3, wis: 1, level: 1, features: [] }).traits.tactical).toBeLessThan(20);
    const zombie = deriveDnd5eTraits({ type: "npc", creature: "undead", int: 3, wis: -2, level: 0.25, features: [] });
    expect(zombie.flags.fearless).toBe(true);
    expect(deriveDnd5eTraits({ type: "npc", creature: "beast", int: 3, wis: 1, level: 0.25, features: ["pack tactics"] }).flags.packTactics).toBe(true);
  });
});
