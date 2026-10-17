/**
 * Saves and checks rolled with dnd5e's own rolls in a live battle (core API 19 rollSave and rollCheck): the save the
 * spec keys (a shove's Strength or Dexterity, its better; a concentration save, dnd5e's own), the check's skill by what
 * the engine says of it (the helper's own actions by their key, the skill it names, a pitch by its kind, the purpose),
 * against the DC, with no dialog, its card the token's, for the GMs only when secret; graded as the rules grade it,
 * with the kept d20; and null where it can't tell or wasn't rolled. Never a GM's say.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { Dnd5eAdapter, checkOf, rollDnd5eSave, rollDnd5eCheck } from "../scripts/adapter.js";

const was = { ChatMessage: globalThis.ChatMessage };
afterEach(() => {
  for ( const [k, v] of Object.entries(was) ) {
    if ( v === undefined ) delete globalThis[k];
    else globalThis[k] = v;
  }
});

/** A save or a check as dnd5e's D20Roll gives it back: its total and its kept d20. */
const d20 = (natural, total) => ({ total, d20: { total: natural } });

/** A spell of its own: Bless takes concentration. */
const spell = (name, concentration = false) => ({ id: name, type: "spell", name, system: { properties: new Set(concentration ? ["vocal", "concentration"] : ["vocal"]) } });

/**
 * An orc as dnd5e prepares one, with only what the rolls look at: its saves (Dexterity its best of Strength and
 * Dexterity), its skills (Acrobatics better than Athletics); its rollers give back the roll a test sets.
 */
function orc({ items = [] } = {}) {
  const actor = {
    id: "orc", uuid: "Actor.orc", type: "npc", name: "Orc", items,
    system: {
      abilities: { str: { mod: 3, save: { value: 1 } }, dex: { mod: 1, save: { value: 5 } }, con: { mod: 2, save: { value: 2 } }, wis: { mod: 0, save: 0 } },
      skills: { ath: { total: 3 }, acr: { total: 5 }, ste: { total: 4 }, ins: { total: 1 }, per: { total: 2 }, itm: { total: 4 }, dec: { total: 0 }, slt: { total: 3, label: "Sleight of Hand" }, med: { total: 0 } }
    },
    next: d20(12, 15)
  };
  for ( const k of ["rollSavingThrow", "rollConcentration", "rollSkill", "rollAbilityCheck"] ) actor[k] = vi.fn(async () => (actor.next ? [actor.next] : null));
  return { token: { uuid: "Scene.s.Token.tokA", name: "Orc", actor }, actor };
}
const NO_DIALOG = { configure: false };

describe("a save, dnd5e's own", () => {
  test("the spec's save key against the DC: no dialog, its card the token's, for the GMs only when secret", async () => {
    const { token, actor } = orc();
    expect(await rollDnd5eSave(token, { save: "dex", dc: 14, action: { id: "pc.fireball.cast", name: "Fireball" } })).toEqual({ degree: 2, natural: 12, total: 15 });
    expect(actor.rollSavingThrow).toHaveBeenCalledWith({ ability: "dex", target: 14 }, NO_DIALOG, {});
    const getSpeaker = vi.fn(({ token: t }) => ({ scene: "s", token: "tokA", actor: t.actor.id, alias: t.name }));
    globalThis.ChatMessage = { implementation: { getSpeaker } };
    await rollDnd5eSave(token, { save: "wis", dc: 13, action: { id: null, name: "Frightened" }, secret: true });
    expect(getSpeaker).toHaveBeenCalledWith({ token });
    expect(actor.rollSavingThrow).toHaveBeenLastCalledWith({ ability: "wis", target: 13 }, NO_DIALOG,
      { rollMode: "gm", data: { speaker: { scene: "s", token: "tokA", actor: "orc", alias: "Orc" } } });
  });

  test("of a shove's Strength or Dexterity, its better (as the engine takes it); never a GM's say", async () => {
    const { token, actor } = orc();
    const out = await new Dnd5eAdapter().rollSave(token, { save: ["str", "dex"], dc: 13, action: { id: "pc.shove", name: "Shove" } });
    expect(actor.rollSavingThrow.mock.calls[0][0]).toEqual({ ability: "dex", target: 13 });
    expect(out.gm).toBeUndefined();
  });

  test("a Constitution save for what it concentrates on: dnd5e's concentration save; any other, a plain one", async () => {
    const { token, actor } = orc({ items: [spell("Bless", true), spell("Fire Bolt")] });
    // (By the action's id, as the engine sends it: its own, of a spell that takes concentration.)
    await rollDnd5eSave(token, { save: "con", dc: 12, action: { id: "orc.Bless.cast", name: "Bless" } });
    expect(actor.rollConcentration).toHaveBeenCalledWith({ target: 12 }, NO_DIALOG, {});
    // (With no id, by its name, or one of its activities', "<item>: <activity>".)
    await rollDnd5eSave(token, { save: "con", dc: 10, action: { id: null, name: "Bless" } });
    await rollDnd5eSave(token, { save: "con", dc: 10, action: { id: null, name: "Bless: Cast" } });
    expect(actor.rollConcentration).toHaveBeenCalledTimes(3);
    for ( const action of [{ id: "pc.Bless.cast", name: "Bless" }, { id: "orc.Fire Bolt.cast", name: "Fire Bolt" }, { id: null, name: "Fire Bolt" }, { id: null, name: "Poisoned" }] ) {
      await rollDnd5eSave(token, { save: "con", dc: 12, action });
    }
    expect(actor.rollConcentration).toHaveBeenCalledTimes(3);
    expect(actor.rollSavingThrow).toHaveBeenCalledTimes(4);
  });
});

describe("a check, with what the engine says of it", () => {
  const skillOf = (request, actor = orc().actor) => checkOf(actor, request);

  test("the helper's own actions by their key: Hide's Stealth, Insight", () => {
    expect(skillOf({ purpose: "aid", action: { id: "orc.hide", name: "Hide" } })).toEqual({ skill: "ste" });
    expect(skillOf({ purpose: "aid", action: { id: "orc.insight", name: "Insight" } })).toEqual({ skill: "ins" });
  });

  test("the skill it names: a dnd5e key, or this client's name for it (a pitch's, a theft's), or an ability's key", () => {
    expect(skillOf({ purpose: "talk", skill: "Persuasion", action: { id: null, name: "persuade" } })).toEqual({ skill: "per" });
    expect(skillOf({ purpose: "theft", skill: "sleight of hand" })).toEqual({ skill: "slt" });
    expect(skillOf({ purpose: "control", skill: "ath" })).toEqual({ skill: "ath" });
    expect(skillOf({ purpose: "control", skill: "str" })).toEqual({ ability: "str" });
    // (A taunt, the core's: its pitch's skill, Intimidation or Deception.)
    expect(skillOf({ purpose: "talk", skill: "Deception", action: { id: "tokA.goad", name: "" } })).toEqual({ skill: "dec" });
  });

  test("a pitch by its kind where its skill's name is another language's; a theft, first aid, an escape by their purpose", () => {
    expect(skillOf({ purpose: "talk", skill: "Einschüchtern", action: { id: null, name: "intimidate" } })).toEqual({ skill: "itm" });
    expect(skillOf({ purpose: "talk", skill: "deceive" })).toEqual({ skill: "dec" });
    expect(skillOf({ purpose: "theft" })).toEqual({ skill: "slt" });
    expect(skillOf({ purpose: "firstAid", action: { id: null, name: "grabbed" } })).toEqual({ skill: "med" });
    // (Athletics or Acrobatics, its better.)
    expect(skillOf({ purpose: "escape", action: { id: null, name: "grabbed" } })).toEqual({ skill: "acr" });
  });

  test("none it can't tell: a taunt in another language, a spell check, a check the spec doesn't name", () => {
    expect(skillOf({ purpose: "talk", skill: "Täuschen", action: { id: "tokA.goad", name: "" } })).toBeNull();
    for ( const purpose of ["cast", "heal", "disengage", "control", "aid", null] ) expect([purpose, skillOf({ purpose, action: { id: "orc.x.y", name: "" } })]).toEqual([purpose, null]);
  });

  test("rolled with dnd5e's skill or ability check against the DC: no dialog, for the GMs only when secret", async () => {
    const { token, actor } = orc();
    expect(await new Dnd5eAdapter().rollCheck(token, { purpose: "aid", dc: 15, action: { id: "orc.hide", name: "Hide" } })).toEqual({ degree: 2, natural: 12, total: 15 });
    expect(actor.rollSkill).toHaveBeenCalledWith({ skill: "ste", target: 15 }, NO_DIALOG, {});
    await rollDnd5eCheck(token, { purpose: "control", skill: "str", dc: 12, action: { id: "orc.x", name: "" }, secret: true });
    expect(actor.rollAbilityCheck).toHaveBeenCalledWith({ ability: "str", target: 12 }, NO_DIALOG, { rollMode: "gm" });
  });

  test("none it can't tell is rolled at all", async () => {
    const { token, actor } = orc();
    expect(await rollDnd5eCheck(token, { purpose: "cast", dc: 12, action: { id: "orc.spell.cast", name: "" } })).toBeNull();
    expect(actor.rollSkill).not.toHaveBeenCalled();
    expect(actor.rollAbilityCheck).not.toHaveBeenCalled();
  });
});

describe("what the roll came to", () => {
  const save = async (natural, total, dc = 14) => {
    const { token, actor } = orc();
    actor.next = d20(natural, total);
    return rollDnd5eSave(token, { save: "dex", dc, action: null });
  };

  test("the DC met: degree 2; short of it: 1; a natural 20 or 1 on a save or a check is no more than its total (5e)", async () => {
    expect(await save(12, 14)).toEqual({ degree: 2, natural: 12, total: 14 });
    expect(await save(12, 13)).toEqual({ degree: 1, natural: 12, total: 13 });
    expect(await save(20, 18, 19)).toEqual({ degree: 1, natural: 20, total: 18 });
    expect(await save(1, 16)).toEqual({ degree: 2, natural: 1, total: 16 });
  });

  test("the kept d20, with advantage or disadvantage (its die's total); else the roll's d20 among its dice", async () => {
    const { token, actor } = orc();
    actor.next = { total: 21, d20: { total: 17, results: [{ result: 4, active: false }, { result: 17, active: true }] } };
    expect(await rollDnd5eCheck(token, { purpose: "theft", dc: 15 })).toEqual({ degree: 2, natural: 17, total: 21 });
    actor.next = { total: 9, dice: [{ faces: 4, total: 2 }, { faces: 20, total: 6 }] };
    expect(await rollDnd5eCheck(token, { purpose: "theft", dc: 15 })).toEqual({ degree: 1, natural: 6, total: 9 });
  });
});

describe("null, for the engine's own dice", () => {
  test("cancelled (a module stopped it), or failed: nothing to read", async () => {
    const { token, actor } = orc();
    actor.next = null;
    expect(await rollDnd5eSave(token, { save: "dex", dc: 14 })).toBeNull();
    expect(await rollDnd5eCheck(token, { purpose: "theft", dc: 14 })).toBeNull();
    actor.rollSavingThrow.mockRejectedValueOnce(new Error("no"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    actor.next = d20(12, 15);
    expect(await rollDnd5eSave(token, { save: "dex", dc: 14 })).toBeNull();
    quiet.mockRestore();
  });

  test("no actor, no DC, or a save it doesn't have: nothing is rolled", async () => {
    const { token, actor } = orc();
    expect(await rollDnd5eSave({ actor: null }, { save: "dex", dc: 14 })).toBeNull();
    expect(await rollDnd5eSave(token, { save: "dex", dc: null })).toBeNull();
    expect(await rollDnd5eSave(token, { save: "fortitude", dc: 14 })).toBeNull();
    expect(await rollDnd5eCheck(token, { purpose: "theft", dc: undefined })).toBeNull();
    expect(actor.rollSavingThrow).not.toHaveBeenCalled();
    expect(actor.rollSkill).not.toHaveBeenCalled();
  });
});
