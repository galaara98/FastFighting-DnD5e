import { describe, expect, test } from "vitest";
import { dnd5eRules, proficiency } from "../scripts/rules.js";
import { parseMultiattackOptions } from "../scripts/multiattack.js";

/** The first (most likely) way to make a Multiattack. */
const parseMultiattack = (description, strikes) => parseMultiattackOptions(description, strikes)[0] ?? null;
import { payFrom, sideChange } from "../scripts/commit.js";
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
  test("2024 wording", () => {
    expect(parseMultiattack("The monster makes one Bite attack and one Claw attack.", ["Bite", "Claw"])).toEqual(["Bite", "Claw"]);
    expect(parseMultiattack("The dragon makes three Rend attacks. It can replace one attack with a use of Spellcasting.", ["Rend"])).toEqual(["Rend", "Rend", "Rend"]);
    expect(parseMultiattack("The knight makes two Longsword attacks or two Longbow attacks.", ["Longsword", "Longbow"])).toEqual(["Longsword", "Longsword"]);
  });
  test("two with one weapon and one with another", () => {
    expect(parseMultiattack("The monster makes three melee attacks: two with its scimitar and one with its dagger. Or the monster makes two ranged attacks with its daggers.", ["Scimitar", "Dagger"])).toEqual(["Scimitar", "Scimitar", "Dagger"]);
  });
  test("melee and ranged mean the right kind of weapon", () => {
    const thug = [{ name: "Heavy Crossbow", melee: false }, { name: "Mace", melee: true }];
    expect(parseMultiattack("The thug makes two melee attacks.", thug)).toEqual(["Mace", "Mace"]);
    expect(parseMultiattackOptions("The scout makes two melee attacks or two ranged attacks.", [{ name: "Shortsword", melee: true }, { name: "Longbow", melee: false }]))
      .toEqual([["Shortsword", "Shortsword"], ["Longbow", "Longbow"]]);
  });
  test("each way of making it is an option", () => {
    const opts = parseMultiattackOptions("The monster makes two attacks, using Scimitar or Pistol in any combination.", ["Pistol", "Scimitar"]);
    expect(opts).toEqual([["Pistol", "Pistol"], ["Scimitar", "Scimitar"]]);
    expect(parseMultiattackOptions("The monster makes one Bite attack and three other attacks, using Claw or Tail in any combination.", ["Bite", "Claw", "Tail"]))
      .toEqual([["Bite", "Claw", "Claw", "Claw"], ["Bite", "Tail", "Tail", "Tail"]]);
    expect(parseMultiattackOptions("The medusa makes either three melee attacks - one with its snake hair and two with its shortsword - or two ranged attacks with its longbow.", ["Shortsword", "Snake Hair", "Longbow"]))
      .toEqual([["Snake Hair", "Shortsword", "Shortsword"], ["Longbow", "Longbow"]]);
  });
  test("limits and conditions", () => {
    const vampire = ["Bite (Bat or Vampire Form Only)", "Unarmed Strike (Vampire Form Only)"];
    expect(parseMultiattack("The vampire makes two attacks, only one of which can be a bite attack.", vampire)).toEqual([vampire[1], vampire[1]]);
    expect(parseMultiattackOptions("The monster makes two Slam attacks, or it makes three Slam attacks if it used Hasten this turn.", ["Slam"])).toEqual([["Slam", "Slam"]]);
    expect(parseMultiattack("The monster makes three Rend attacks. It can replace one attack with a use of Spellcasting.", ["Rend"])).toEqual(["Rend", "Rend", "Rend"]);
    expect(parseMultiattack("The monster makes three tentacle attacks, each of which it can replace with one use of Fling.", ["Tentacle"])).toEqual(["Tentacle", "Tentacle", "Tentacle"]);
  });
  test("stat-block oddities", () => {
    expect(parseMultiattack("The monster two attacks: one with its bite and one with its tail.", ["Bite", "Tail"])).toEqual(["Bite", "Tail"]);
    expect(parseMultiattack("The monster makes 1d4 rotting touch attacks.", ["Rotting Touch"])).toHaveLength(3);
    expect(parseMultiattack("The hydra makes as many bite attacks as it has heads.", ["Bite"])).toHaveLength(5);
    expect(parseMultiattack("The monster makes two attacks: one with its bite and one with its claws or spear.", ["Bite (Wolf or Hybrid Form Only)", "Claws (Hybrid Form Only)", "Spear"]))
      .toEqual(["Bite (Wolf or Hybrid Form Only)", "Claws (Hybrid Form Only)"]);
    expect(parseMultiattack("The behir makes two attacks: one with its bite and one to constrict.", ["Bite", "Constrict"])).toEqual(["Bite", "Constrict"]);
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

describe("reading spell text", () => {
  test("darts, rays and beams", async () => {
    const { projectileCount } = await import("../scripts/adapter.js");
    expect(projectileCount("<p>You create three glowing darts of magical force.</p>", 1)).toBe(3);
    expect(projectileCount("You create three rays of fire and hurl them at targets within range.", 3)).toBe(3);
    const blast = "A beam of crackling energy streaks toward a creature. The spell creates more than one beam when you reach higher levels: two beams at 5th level, three beams at 11th level, and four beams at 17th level.";
    expect([1, 5, 11, 17].map(l => projectileCount(blast, l))).toEqual([1, 2, 3, 4]);
    expect(projectileCount("The spell creates two beams at level 5, three beams at level 11, and four beams at level 17.", 12)).toBe(3);
    expect(projectileCount("A flame, equivalent in brightness to a torch, springs from an object.", 1)).toBe(1);
  });
  test("enrichers become words", async () => {
    const { plainText } = await import("../scripts/adapter.js");
    const actor = { items: { get: id => ({ mmBite0000000000: { name: "Bite" } })[id], getName: () => null } };
    expect(plainText("The [[lookup @name lowercase]]{monster} makes one [[/item .mmBite0000000000]] attack and one [[/item .x1]]{claw} attack.", actor))
      .toBe("The monster makes one Bite attack and one claw attack.");
  });
  test("beasts are animals, not mindless; zombies and oozes are", async () => {
    const { isMindless } = await import("../scripts/traits.js");
    expect(isMindless(3, "beast")).toBe(false);
    expect(isMindless(3, "undead")).toBe(true);
    expect(isMindless(1, "ooze")).toBe(true);
    expect(isMindless(6, "undead")).toBe(false);
  });
});

describe("features by identifier", () => {
  test("identifiers work alone (the same in every book and language)", () => {
    const wolf = deriveDnd5eTraits({ type: "npc", creature: "beast", int: 3, wis: 1, level: 0.25, features: ["pack-tactics", "rudel-taktik"] });
    expect(wolf.flags.packTactics).toBe(true);
    expect(deriveDnd5eTraits({ type: "character", features: ["cunning-action"] }).flags.nimble).toBe(true);
  });

  test("a wolf's Pack Tactics isn't leadership; a Rallying Cry is", async () => {
    const { rankLeaders } = await import("../scripts/leadership.js");
    const [wolf] = rankLeaders([{ id: "w", level: 1, skills: { persuasion: 0, intimidation: 0 }, features: [{ key: "pack-tactics", name: "Pack Tactics" }] }]);
    expect(wolf.reason).not.toMatch(/Pack Tactics/);
    const [captain] = rankLeaders([{ id: "c", level: 1, skills: { persuasion: 0, intimidation: 0 }, features: [{ key: "rallying-cry", name: "Cri de ralliement" }] }]);
    expect(captain.reason).toMatch(/Cri de ralliement/);
    expect(captain.score).toBe(wolf.score + 3);
  });
});

describe("whose side a token ends up on", () => {
  test("won over, talked out of the fight, or a neutral that turned on the party", () => {
    expect(sideChange({ swayed: "switched", side: "friendly", status: "standing" })).toBe("friendly");
    expect(sideChange({ swayed: "neutral", side: "neutralParty", status: "standing", against: [] })).toBe("neutral");
    expect(sideChange({ swayed: null, side: "neutralParty", status: "standing", against: ["friendly"] })).toBe("hostile");
    // A neutral that only fought the enemy, or never took a side, stays as it was.
    expect(sideChange({ swayed: null, side: "neutralParty", status: "standing", against: ["hostile"] })).toBeNull();
    expect(sideChange({ swayed: "neutral", side: "neutralParty", status: "dead", against: [] })).toBeNull();
    expect(sideChange({ swayed: null, side: "hostile", status: "down" })).toBeNull();
  });
});

describe("abilities that recharge", () => {
  test("Recharge 5–6 comes back on a d6 of 5 or more; Recharge 6 on a 6", async () => {
    const { rechargeOf } = await import("../scripts/adapter.js");
    expect(rechargeOf({ max: 1, recovery: [{ period: "recharge", formula: "5" }] })).toEqual({ recharge: { on: 5, die: 6 } });
    expect(rechargeOf({ max: 1, recovery: [{ period: "recharge" }] })).toEqual({ recharge: { on: 6, die: 6 } });
    expect(rechargeOf({ max: 3, recovery: [{ period: "lr" }] })).toEqual({});
  });
});

describe("legendary", () => {
  test("a legendary action's cost: its activation, else its name", async () => {
    const { legendaryCost } = await import("../scripts/adapter.js");
    expect(legendaryCost({ activation: { type: "legendary", value: 2 } }, { name: "Wing Attack" })).toBe(2);
    expect(legendaryCost({ activation: { type: "legendary" } }, { name: "Wing Attack (Costs 2 Actions)" })).toBe(2);
    expect(legendaryCost({ activation: { type: "legendary" } }, { name: "Detect" })).toBe(1);
  });

  test("a legendary action that names one of its attacks makes that attack", async () => {
    const { legendaryAttack } = await import("../scripts/adapter.js");
    expect(legendaryAttack("The dragon makes a tail attack.", ["Bite", "Claw", "Tail"])).toBe("Tail");
    expect(legendaryAttack("The lich makes one Paralyzing Touch attack.", ["Paralyzing Touch"])).toBe("Paralyzing Touch");
    expect(legendaryAttack("The dragon beats its wings. Each creature within 10 feet must succeed on a DC 22 Dexterity saving throw.", ["Bite"])).toBeNull();
  });
});

describe("mending", () => {
  test("Regeneration: so much a turn, stopped by the damage it names", async () => {
    const { regenerationFrom } = await import("../scripts/adapter.js");
    expect(regenerationFrom("The troll regains 10 hit points at the start of its turn. If the troll takes acid or fire damage, this trait doesn't function at the start of the troll's next turn."))
      .toEqual({ amount: 10, stoppedBy: ["acid", "fire"] });
    expect(regenerationFrom("The troll regains 15 Hit Points at the start of each of its turns. If the troll takes Acid or Fire damage, this trait doesn't function on the troll's next turn."))
      .toEqual({ amount: 15, stoppedBy: ["acid", "fire"] });
    expect(regenerationFrom("It can fly.")).toBeNull();
    // (Words a player wrote, long and crafted: read a sentence at a time, at once.)
    const start = Date.now();
    expect(regenerationFrom(`It regains 10 hit points at the start of its turn. ${"takes fire damage or ".repeat(3000)}`)).toMatchObject({ amount: 10, stoppedBy: [] });
    expect(Date.now() - start).toBeLessThan(1000);
    // The amount only in the trait's own healing; "if it has at least 1 hit point": it can die at 0.
    expect(regenerationFrom("The vampire regains [[/healing]] at the start of its turn if it has at least 1 hit point. If the vampire takes radiant damage or damage from holy water, this trait doesn't function.", 20))
      .toEqual({ amount: 20, stoppedBy: ["radiant"], needsHp: true });
  });

  test("Undead Fortitude: a Constitution save against 5 + the damage, never against radiant or a critical hit", async () => {
    const { holdOnFrom } = await import("../scripts/adapter.js");
    expect(holdOnFrom("If damage reduces the zombie to 0 hit points, it must make a Constitution saving throw with a DC of 5 + the damage taken, unless the damage is radiant or from a critical hit. On a success, the zombie drops to 1 hit point instead.", "Undead Fortitude"))
      .toEqual({ save: "con", base: 5, except: ["radiant"], notOnCrit: true, label: "Undead Fortitude" });
    expect(holdOnFrom("If damage reduces the zombie to 0 Hit Points, it makes a Constitution saving throw (DC 5 plus the damage taken) unless the damage is Radiant or from a Critical Hit.", "Undead Fortitude"))
      .toEqual({ save: "con", base: 5, except: ["radiant"], notOnCrit: true, label: "Undead Fortitude" });
  });

  const POOL = "feature:relentless-endurance";
  const RELENTLESS = { save: "con", base: -Infinity, except: [], notOnCrit: false, label: "Relentless Endurance", pool: POOL };

  test("Relentless Endurance: no roll to make, only its use to spend; nothing once it's spent, or when the blow kills outright", () => {
    const orc = (hp, left = 1) => ({ spec: { holdOn: RELENTLESS }, hp, maxHp: 20, resources: { [POOL]: left } });
    const asked = { kind: "save", label: "Relentless Endurance" };
    const u = orc(-3);
    expect(dnd5eRules.adjustRoll(null, u, { degree: 2 }, asked).degree).toBe(2);
    expect(u.resources[POOL]).toBe(0);
    expect(dnd5eRules.adjustRoll(null, u, { degree: 2 }, asked).degree).toBe(1);
    // (20 past 0, its whole maximum: killed outright, and the use is kept.)
    const struck = orc(-20);
    expect(dnd5eRules.adjustRoll(null, struck, { degree: 2 }, asked).degree).toBe(1);
    expect(struck.resources[POOL]).toBe(1);
    // Every other roll is as it was: its other saves, its attacks, a zombie's Undead Fortitude.
    const roll = { degree: 1 };
    expect(dnd5eRules.adjustRoll(null, orc(-3), roll, { kind: "save", label: "Fireball" })).toBe(roll);
    expect(dnd5eRules.adjustRoll(null, orc(-3), roll, { kind: "attack", label: "Relentless Endurance" })).toBe(roll);
    expect(dnd5eRules.adjustRoll(null, { spec: { holdOn: { save: "con", base: 5, label: "Undead Fortitude" } }, hp: -3, maxHp: 20, resources: {} }, roll, { kind: "save", label: "Undead Fortitude" })).toBe(roll);
  });

  test("Relentless Endurance in a fight: up at 1 hit point the first time, down the second", async () => {
    const { replay } = await import("../../fast-fighting/scripts/engine/simulator.js");
    const { parseFormula } = await import("../scripts/core.js");
    const traits = { tactical: { base: 50, fudge: 0 }, brave: { base: 95, fudge: 0 }, selfish: { base: 20, fudge: 0 }, loyal: { base: 60, fudge: 0 } };
    const blow = (bonus, damage) => ({ id: `blow${bonus}`, name: "Greataxe", kind: "strike", bonus, melee: true, reach: 5, damage: [parseFormula(damage, "slashing")] });
    const fighter = (id, side, over) => ({
      id, name: id, side, kind: "npc", level: 1, hp: { value: 20, max: 20, temp: 0 }, defenses: { ac: 10, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      initiative: { mod: 0 }, speeds: { walk: 30 }, iwr: {}, traits, flags: {}, diesAtZero: true, actions: [blow(-50, "1")], ...over
    });
    const fight = (orcHp, damage) => replay({
      combatants: [
        fighter("orc", "friendly", { hp: { value: orcHp, max: 20, temp: 0 }, holdOn: RELENTLESS, resources: { [POOL]: 1 } }),
        fighter("brute", "hostile", { initiative: { mod: 30 }, actions: [blow(50, damage)] })
      ],
      sides: { friendly: { label: "Party", enemies: ["hostile"] }, hostile: { label: "Foes", enemies: ["friendly"] } },
      options: { positioning: false, opening: "fight", maxRounds: 8 }
    }, dnd5eRules, 7);
    const r = fight(5, "8");
    expect(r.log.filter(e => e.type === "holdOn" && e.label === "Relentless Endurance")).toHaveLength(1);
    expect(r.units.orc.status).toBe("dead");
    expect(r.units.orc.final.resources[POOL]).toBe(0);
    // (A blow that leaves 20 past 0: killed outright.)
    const outright = fight(5, "25");
    expect(outright.log.some(e => e.type === "holdOn")).toBe(false);
    expect(outright.units.orc.final.resources[POOL]).toBe(1);
  });
});

describe("upcasting", () => {
  test("more darts or rays for each slot level above the spell's own", async () => {
    const { moreProjectilesPerLevel } = await import("../scripts/adapter.js");
    expect(moreProjectilesPerLevel("<p><strong>Using a Higher-Level Spell Slot.</strong> The spell creates one more dart for each spell slot level above 1.</p>")).toBe(1);
    expect(moreProjectilesPerLevel("When you cast this spell using a spell slot of 3rd level or higher, you create one additional ray for each slot level above 2nd.")).toBe(1);
    expect(moreProjectilesPerLevel("The damage increases by 1d6 for each spell slot level above 1.")).toBe(0);
  });
});
