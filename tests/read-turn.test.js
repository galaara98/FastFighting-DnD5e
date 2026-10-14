import { describe, expect, test } from "vitest";
import { readDnd5eTurn, cardOf } from "../scripts/read-turn.js";

const roll = (total, natural, options = {}, extra = {}) => ({ total, dice: [{ faces: 20, total: natural }], options, ...extra });
const context = { tokenId: "tokA", ids: { tokA: "A", tokB: "B" } };

/** A card as dnd5e 6 makes it: its type, and the rest in its system data. */
const card6 = (type, system, rolls) => ({ type, speaker: { token: "tokA" }, flags: {}, system, rolls });
const goblin = { ac: 15, token: "Scene.s.Token.tokB", actor: "Scene.s.Token.tokB.Actor.x" };

describe("a player's turn read from dnd5e's cards", () => {
  test("dnd5e 6: an attack (by its type), and its damage on the next card", () => {
    const events = readDnd5eTurn([
      card6("attack", { item: { name: "Fire Bolt" }, activity: { uuid: null }, targets: [goblin] }, [roll(17, 14, { rollType: "attack" })]),
      card6("damage", { item: { name: "Fire Bolt" }, targets: [goblin] }, [{ total: 7, options: { rollType: "damage", type: "fire" } }])
    ], context);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "attack", targetId: "B", action: "Fire Bolt", degree: 2, dc: 15, total: 17, damage: 7, damageType: "fire", sure: true });
    // (A spell isn't a shot from a weapon; a longbow's is.)
    expect(events[0].launched).toBe(false);
    const bow = readDnd5eTurn([card6("attack", { item: { name: "Longbow", type: "weapon" }, targets: [goblin] }, [roll(17, 14, { rollType: "attack", attackMode: "ranged" })])], context)[0];
    expect(bow).toMatchObject({ ranged: true, launched: true });
  });

  test("dnd5e 6: a miss, a critical; Persuasion is words (its skill id: per); Perception isn't", () => {
    const at = (total, natural, extra) => readDnd5eTurn([card6("attack", { item: { name: "Dagger" }, targets: [goblin] }, [roll(total, natural, { rollType: "attack" }, extra)])], context)[0];
    expect(at(12, 10).degree).toBe(1);
    expect(at(25, 20, { isCritical: true }).degree).toBe(3);
    const [talk] = readDnd5eTurn([card6("check", { skill: "per", ability: "cha", targets: [] }, [roll(14, 11, { rollType: "check" })])], context);
    expect(talk).toMatchObject({ type: "talk", kind: "persuade", sure: false });
    expect(readDnd5eTurn([card6("check", { skill: "prc", targets: [] }, [roll(14, 11, { rollType: "check" })])], context)).toEqual([]);
  });

  test("earlier dnd5e: the same, from flags.dnd5e", () => {
    const old = { speaker: { token: "tokA" }, flags: { dnd5e: { roll: { type: "attack" }, targets: [{ uuid: "Scene.s.Token.tokB.Actor.x", ac: 13 }], activity: { attack: { type: "rwak" } } } }, rolls: [roll(15, 9)] };
    expect(cardOf(old)).toMatchObject({ type: "attack", ranged: true });
    expect(readDnd5eTurn([old], context)[0]).toMatchObject({ type: "attack", targetId: "B", degree: 2, ranged: true });
  });

  test("another creature's cards, and cards that aren't rolls, are left out", () => {
    expect(readDnd5eTurn([{ ...card6("attack", { targets: [goblin] }, [roll(20, 15)]), speaker: { token: "tokB" } }], context)).toEqual([]);
    expect(readDnd5eTurn([{ type: "base", speaker: { token: "tokA" }, flags: {}, system: {}, rolls: [] }], context)).toEqual([]);
  });
});
