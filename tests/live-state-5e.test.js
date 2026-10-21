/**
 * A live battle's read of a 5e sheet between turns (readLiveState): its hit points, statuses and conditions, its death
 * saves, and what's left of each pool its spec began with, read off the sheet with no spec read again; and the rules
 * taking up the death saves a player rolled at the table (syncUnit, core API 24).
 */
import { describe, expect, test, vi } from "vitest";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";

const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id) });
const item = (id, type, system = {}, identifier = id) => ({ id, type, name: id, identifier, system: { identifier, ...system } });

function sheet({ hp = 0, death = { success: 1, failure: 2 }, statuses = [] } = {}) {
  return {
    id: "pc", type: "character", statuses: new Set(statuses), effects: [], appliedEffects: [],
    items: listOf([
      item("sup", "feat", { uses: { max: 4, spent: 1 } }),
      item("relentless-item", "feat", { uses: { max: 1, spent: 0 } }, "relentless-endurance"),
      item("potion", "consumable", { quantity: 2, uses: { max: 1, spent: 0 } }),
      item("arrows", "consumable", { quantity: 14, type: { value: "ammo", subtype: "arrow" } }),
      item("more", "consumable", { quantity: 6, type: { value: "ammo", subtype: "arrow" } })
    ]),
    system: {
      attributes: { hp: { value: hp, max: 40, temp: 3 }, death, inspiration: true },
      spells: { spell1: { value: 1, max: 4 }, pact: { value: 0, max: 2 } },
      resources: { legres: { value: 2, max: 3 } }
    }
  };
}
const spec = {
  hp: { max: 40 }, diesAtZero: false,
  resources: { "slots:1": 4, pact: 2, fate: 1, legres: 3, "feature:sup": 4, "feature:relentless-endurance": 1, "item:potion": 2, "ammo:arrow": 30, "item:gone": 1, odd: 5 }
};

describe("readLiveState", () => {
  test("the sheet's numbers for the spec's own pools, its death saves, its state; no spec read again", async () => {
    const adapter = new Dnd5eAdapter();
    const whole = vi.spyOn(adapter, "toCombatantSpec");
    const s = await adapter.readLiveState({ actor: sheet() }, { unit: { spec } });
    expect(whole).not.toHaveBeenCalled();
    expect(s).toMatchObject({ hp: 0, temp: 3, maxHp: 40, dying: 2, status: "down", stable: false, deathSaves: { success: 1, failure: 2 } });
    expect(s.resources).toEqual({ "slots:1": 1, pact: 0, fate: 1, legres: 2, "feature:sup": 3, "feature:relentless-endurance": 1, "item:potion": 2, "ammo:arrow": 20, "item:gone": 0 });
  });

  test("on its feet, no stable said; three successes, stable; marked dead, dead", async () => {
    const adapter = new Dnd5eAdapter();
    expect(await adapter.readLiveState({ actor: sheet({ hp: 12 }) }, { unit: { spec } })).not.toHaveProperty("stable");
    expect((await adapter.readLiveState({ actor: sheet({ death: { success: 3, failure: 0 } }) }, { unit: { spec } })).stable).toBe(true);
    expect((await adapter.readLiveState({ actor: sheet({ statuses: ["dead"] }) }, { unit: { spec } })).status).toBe("dead");
  });
});

describe("the rules take up the death saves (syncUnit)", () => {
  test("its successes and failures as the sheet has them; nothing said, nothing changed", () => {
    const u = { deathSuccesses: 0, deathFailures: 0, dying: 0 };
    dnd5eRules.syncUnit(u, { deathSaves: { success: 1, failure: 2 } });
    expect(u).toEqual({ deathSuccesses: 1, deathFailures: 2, dying: 2 });
    dnd5eRules.syncUnit(u, { hp: 4 });
    expect(u).toEqual({ deathSuccesses: 1, deathFailures: 2, dying: 2 });
  });
});
