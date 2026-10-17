/**
 * A spell's or a feature's own card in a live battle (core API 19 useAction), and its damage rolled once for all it
 * catches (rollDamage): the activity the action came from, found by its id as the spec makes it (the slot it's cast
 * with; a Multiattack's part by its name); its usage card with nothing consumed, created, begun or rolled after it, at
 * the action's targets, for the GMs only when secret, and none for an attack; its damage as its card's Damage button
 * rolls it (scaled as the card is, the card its origin, at the card's targets), by type, applied by no one; null for
 * darts dnd5e rolls one at a time, or what isn't damage. Each target's share is applied with applyDamageCard.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dnd5eAdapter, activityOf, useDnd5eAction, rollDnd5eDamage } from "../scripts/adapter.js";
import { applyDnd5eDamageCard } from "../scripts/commit.js";

const was = { dnd5e: globalThis.dnd5e, ChatMessage: globalThis.ChatMessage, Roll: globalThis.Roll };
afterEach(() => {
  for ( const [k, v] of Object.entries(was) ) {
    if ( v === undefined ) delete globalThis[k];
    else globalThis[k] = v;
  }
});

/** Foundry's Roll.replaceFormulaData, as far as these tests need it. */
const replaceFormulaData = (formula, data) => String(formula).replace(/@([a-z.0-9_-]+)/gi, (m, term) => String(term.split(".").reduce((o, k) => o?.[k], data) ?? 0));
beforeEach(() => { globalThis.Roll = { replaceFormulaData }; });

const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });

/** A damage roll as dnd5e gives it back: its total and type, and the card it made. */
const damageRoll = (total, type, card = "dmg-1") => ({ total, options: { type }, parent: { id: card } });

/**
 * An activity as dnd5e prepares one, with only what the spec and these hooks look at: `dice` its damage (for the spec);
 * its use gives back the card a test sets (`next.card`), its rollDamage the rolls (`next.rolls`).
 */
function activity(id, type, { name = "", dice = [], ...extra } = {}) {
  const a = {
    id, type, name, canUse: true, activation: { type: "action" }, range: { units: "ft", value: 60 }, target: { affects: {}, template: {} }, effects: [],
    damage: { onSave: "half", parts: [] }, labels: {},
    getDamageConfig: () => ({ rolls: dice.map(([formula, damageType]) => ({ parts: [formula], options: { types: [damageType] } })) }),
    next: { card: "use-1", rolls: [] },
    ...extra
  };
  a.use = vi.fn(async () => (a.next.card ? { message: { id: a.next.card } } : undefined));
  a.rollDamage = vi.fn(async () => a.next.rolls);
  return a;
}

/** A save, Dexterity against DC 13, its damage halved by a success. */
const saving = (id, dice, extra = {}) => activity(id, "save", { dice, save: { ability: new Set(["dex"]), dc: { value: 13 } }, ...extra });

/**
 * An item with these activities: a spell (its level and casting method), or a feature. Its scaledClone is dnd5e's: a
 * copy at that scaling, whose activities roll their damage on their own (`rollDamage`).
 */
function item(id, type, activities, { name = id, level, method, description = "", properties = [] } = {}) {
  const it = {
    id, type, name, identifier: id, flags: {}, effects: [],
    system: { identifier: id, activities: listOf(activities), level, method, description: { value: description }, properties: new Set(properties), range: {}, activation: { type: "action" }, uses: {} }
  };
  for ( const a of activities ) a.item = it;
  it.scaledClone = vi.fn(scaling => ({ system: { activities: listOf(activities.map(a => ({ ...a, scaling, rollDamage: vi.fn(async () => a.next.rolls) }))) } }));
  return it;
}

/** A mage as dnd5e prepares one, with only what these tests look at: slots of the 1st to 3rd level, and a pact slot (3rd). */
function mage(items = [], type = "npc") {
  const slot = level => ({ level, max: 2, value: 2 });
  const actor = {
    id: "mage", uuid: "Actor.mage", type, name: "Mage", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items), getRollData: () => ({}), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: 0 }])),
      attributes: { hp: { value: 40, max: 40, temp: 0 }, ac: { value: 12 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {}, spell: { dc: 13, level: 5 } },
      details: { cr: 6, level: 5, type: { value: "humanoid" } },
      skills: { ath: { total: 0, passive: 10 }, acr: { total: 0, passive: 10 }, ste: { total: 0 }, prc: { total: 0, passive: 10 }, ins: { total: 0, passive: 10 } },
      traits: { size: "med", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} },
      resources: {}, currency: {}, spells: { spell1: slot(1), spell2: slot(2), spell3: slot(3), pact: slot(3) }
    }
  };
  return { token: { uuid: "Scene.s.Token.tokA", name: "Mage", actor }, actor };
}

/** The goblin it's aimed at, and dnd5e's descriptor of it on a card. */
const goblin = () => ({
  uuid: "Scene.s.Token.tokB", name: "Goblin", texture: { src: "goblin.webp" },
  actor: { uuid: "Scene.s.Token.tokB.Actor.gob", statuses: new Set(), system: { attributes: { ac: { value: 15 } } } }
});
const GOBLIN = { actor: "Scene.s.Token.tokB.Actor.gob", ac: 15, img: "goblin.webp", name: "Goblin", token: "Scene.s.Token.tokB" };

/** Burning Hands: a 1st-level save spell, 3d6 fire, 1d6 more for each slot level above 1st. */
const burningHands = () => item("burning-hands", "spell", [saving("cast", [["3d6", "fire"]], {
  range: { units: "self" }, target: { affects: {}, template: { type: "cone", size: 15, units: "ft" } },
  damage: { onSave: "half", parts: [{ number: 3, denomination: 6, types: new Set(["fire"]), scaling: { mode: "whole", number: 1 } }] }
})],
  { name: "Burning Hands", level: 1, method: "spell" });
/** A breath weapon: a feature's save, 8d6 fire. */
const breath = () => item("fire-breath", "feat", [saving("breath", [["8d6", "fire"]], { range: { units: "self" }, target: { affects: {}, template: { type: "cone", size: 30, units: "ft" } } })],
  { name: "Fire Breath" });
/** Fire Bolt: a cantrip's attack. */
const fireBolt = () => item("fire-bolt", "spell", [activity("bolt", "attack", { dice: [["1d10", "fire"]], attack: { type: { value: "ranged" } } })], { name: "Fire Bolt", level: 0, method: "spell" });
/** Magic Missile: a damage activity whose dice are one dart's. */
const magicMissile = () => item("magic-missile", "spell", [activity("darts", "damage", { dice: [["1d4 + 1", "force"]] })], {
  name: "Magic Missile", level: 1, method: "spell",
  description: "<p>You create three glowing darts of magical force. ... one more dart for each spell slot level above 1st.</p>"
});
/** Cure Wounds: healing. */
const cureWounds = () => item("cure-wounds", "spell", [activity("heal", "heal", { dice: [["2d8", "healing"]] })], { name: "Cure Wounds", level: 1, method: "spell" });

const USE = { consume: false, create: false, concentration: { begin: false }, subsequentActions: false };
const NO_DIALOG = { configure: false };

describe("the activity an action came from, found by its id", () => {
  test("the spec's own ids: a save spell at each slot it can be cast with, the pact slot too; a feature's", async () => {
    const { actor } = mage([burningHands(), breath()]);
    const spec = await new Dnd5eAdapter().toCombatantSpec({ id: "tokA", name: "Mage", actor });
    const casts = spec.actions.filter(a => a.itemId === "burning-hands");
    expect(casts.map(a => [a.id, a.rank])).toEqual([["mage.burning-hands.cast", 1], ["mage.burning-hands.cast@slots:2", 2], ["mage.burning-hands.cast@slots:3", 3], ["mage.burning-hands.cast@pact", 3]]);
    const spell = actor.items.get("burning-hands");
    expect(casts.map(a => activityOf(actor, a))).toEqual([null, "spell2", "spell3", "pact"].map(slot => ({ item: spell, activity: spell.system.activities[0], slot })));
    const fire = spec.actions.find(a => a.itemId === "fire-breath");
    expect(activityOf(actor, fire)).toEqual({ item: actor.items.get("fire-breath"), activity: actor.items.get("fire-breath").system.activities[0], slot: null });
  });

  test("whatever the actions add after it (a projectile, Extra Attack); none for the helper's own actions, or what it doesn't have", () => {
    const { actor } = mage([burningHands()]);
    const cast = actor.items.get("burning-hands").system.activities[0];
    for ( const id of ["mage.burning-hands.cast.0", "mage.burning-hands.cast.extra", "mage.burning-hands.cast@slots:3.more0"] ) expect([id, activityOf(actor, { id })?.activity]).toEqual([id, cast]);
    for ( const id of ["mage.dodge", "mage.shove", "mage.wand.zap", "", undefined] ) expect([id, activityOf(actor, { id, name: "Burning Hands" })]).toEqual([id, null]);
    expect(activityOf(actor)).toBeNull();
  });

  test("a Multiattack's part (its id the Multiattack's) and a legendary copy: by the name it goes by", () => {
    const glare = saving("glare", [], { name: "Dreadful Glare" });
    const fist = activity("fist", "attack", { dice: [["2d6", "bludgeoning"]] });
    const { actor } = mage([item("multiattack", "feat", []), item("mummy-gaze", "feat", [glare, activity("other", "save", { name: "Rot" })], { name: "Gaze" }), item("rotting-fist", "feat", [fist], { name: "Rotting Fist" })]);
    expect(activityOf(actor, { id: "multiattack.0.1", name: "Gaze: Dreadful Glare" })?.activity).toBe(glare);
    expect(activityOf(actor, { id: "multiattack.0.0", name: "Rotting Fist" })?.activity).toBe(fist);
    expect(activityOf(actor, { id: "mage.rotting-fist.legendary", name: "Rotting Fist" })?.activity).toBe(fist);
    // (An item of several activities named by the item alone is its plain one: none here.)
    expect(activityOf(actor, { id: "multiattack.0.1", name: "Gaze" })).toBeNull();
    expect(activityOf(actor, { id: "multiattack.0.1", name: "Bite" })).toBeNull();
  });
});

describe("its own card (useAction)", () => {
  test("dnd5e's use, no dialog: nothing consumed, created (a template, summons), begun (concentration) or rolled after it; at the action's targets, the token its speaker", async () => {
    const { token, actor } = mage([burningHands()]);
    globalThis.game.user = { targets: new Set(["someone else"]) };
    const getSpeaker = vi.fn(({ token: t }) => ({ scene: "s", token: "tokA", actor: t.actor.id, alias: t.name }));
    globalThis.ChatMessage = { implementation: { getSpeaker } };
    const out = await useDnd5eAction(token, { action: { id: "mage.burning-hands.cast", name: "Burning Hands" }, targets: [goblin()] });
    expect(out).toEqual({ card: "use-1" });
    const cast = actor.items.get("burning-hands").system.activities[0];
    expect(cast.use).toHaveBeenCalledWith(USE, NO_DIALOG, { data: { speaker: { scene: "s", token: "tokA", actor: "mage", alias: "Mage" }, system: { targets: [GOBLIN] } } });
    expect(cast.rollDamage).not.toHaveBeenCalled();
    expect([...globalThis.game.user.targets]).toEqual(["someone else"]);
    // (With dnd5e loaded: its own descriptor of each target.)
    const getDescriptors = vi.fn(tokens => tokens.map(() => ({ ...GOBLIN, ac: 16 })));
    globalThis.dnd5e = { dataModels: { chatMessage: { fields: { TargetsField: { getDescriptors } } } } };
    await useDnd5eAction(token, { action: { id: "mage.burning-hands.cast" }, targets: [goblin(), goblin()] });
    expect(cast.use.mock.calls[1][2].data.system.targets).toEqual([{ ...GOBLIN, ac: 16 }, { ...GOBLIN, ac: 16 }]);
  });

  test("cast with the slot the action is cast with: a higher one, the pact slot; with none, dnd5e's own", async () => {
    const { token, actor } = mage([burningHands()]);
    const cast = actor.items.get("burning-hands").system.activities[0];
    for ( const id of ["mage.burning-hands.cast@slots:3", "mage.burning-hands.cast@pact", "mage.burning-hands.cast"] ) await useDnd5eAction(token, { action: { id } });
    expect(cast.use.mock.calls.map(c => c[0])).toEqual([{ ...USE, spell: { slot: "spell3" } }, { ...USE, spell: { slot: "pact" } }, USE]);
  });

  test("a feature's (a breath weapon), at no one; secret, for the GMs only", async () => {
    const { token, actor } = mage([breath()]);
    expect(await new Dnd5eAdapter().useAction(token, { action: { id: "mage.fire-breath.breath" }, secret: true })).toEqual({ card: "use-1" });
    expect(actor.items.get("fire-breath").system.activities[0].use).toHaveBeenCalledWith(USE, NO_DIALOG, { rollMode: "gm", data: { system: { targets: [] } } });
  });

  test("none: an attack (its strike's card shows it), the helper's own, a summoning, one dnd5e won't use; no card made, or use failing", async () => {
    const summon = activity("call", "summon");
    const hidden = activity("hidden", "utility", { canUse: false });
    const { token, actor } = mage([fireBolt(), item("conjure", "spell", [summon], { level: 3, method: "spell" }), item("trick", "feat", [hidden]), burningHands()]);
    for ( const id of ["mage.fire-bolt.bolt", "mage.dodge", "mage.conjure.call", "mage.trick.hidden"] ) expect([id, await useDnd5eAction(token, { action: { id } })]).toEqual([id, null]);
    expect(actor.items.get("fire-bolt").system.activities[0].use).not.toHaveBeenCalled();
    expect(summon.use).not.toHaveBeenCalled();
    expect(hidden.use).not.toHaveBeenCalled();
    const cast = actor.items.get("burning-hands").system.activities[0];
    cast.next.card = null;
    expect(await useDnd5eAction(token, { action: { id: "mage.burning-hands.cast" } })).toBeNull();
    cast.use.mockRejectedValueOnce(new Error("no"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await useDnd5eAction(token, { action: { id: "mage.burning-hands.cast" } })).toBeNull();
    quiet.mockRestore();
    expect(await useDnd5eAction({}, { action: { id: "mage.burning-hands.cast" } })).toBeNull();
  });
});

describe("its damage, once for all it catches (rollDamage)", () => {
  test("as its card's Damage button rolls it: no dialog, on the item scaled as the card is, the card its origin and its targets; by type, as rolled", async () => {
    const { token, actor } = mage([burningHands()]);
    const spell = actor.items.get("burning-hands");
    spell.system.activities[0].next.rolls = [damageRoll(14, "fire"), damageRoll(3, "fire"), damageRoll(-1, "cold")];
    globalThis.game.messages = new Map([["use-1", { id: "use-1", system: { scaling: 2, targets: [GOBLIN] } }]]);
    const out = await rollDnd5eDamage(token, { action: { id: "mage.burning-hands.cast@slots:3" }, card: "use-1" });
    expect(out).toEqual({ damage: { byType: { fire: 17, cold: 0 } }, card: "dmg-1" });
    expect(spell.scaledClone).toHaveBeenCalledWith(2);
    const scaled = spell.scaledClone.mock.results[0].value.system.activities[0];
    expect(scaled.rollDamage).toHaveBeenCalledWith({}, NO_DIALOG, { data: { system: { targets: [GOBLIN], origin: "use-1" } } });
    expect(spell.system.activities[0].rollDamage).not.toHaveBeenCalled();
  });

  test("with no card: at the slot the action is cast with (a pact spell with none, at its pact slot's level), at no one; its own level, unscaled", async () => {
    const { token, actor } = mage([burningHands(), item("shatter", "spell", [saving("cast", [["3d8", "thunder"]])], { name: "Shatter", level: 2, method: "pact" })]);
    const spell = actor.items.get("burning-hands");
    spell.system.activities[0].next.rolls = [damageRoll(9, "fire")];
    actor.items.get("shatter").system.activities[0].next.rolls = [damageRoll(13, "thunder")];
    // (A slot whose level dnd5e doesn't give: as its key says.)
    delete actor.system.spells.spell2.level;
    await rollDnd5eDamage(token, { action: { id: "mage.burning-hands.cast@slots:2" } });
    await rollDnd5eDamage(token, { action: { id: "mage.burning-hands.cast@pact" }, card: "gone" });
    await rollDnd5eDamage(token, { action: { id: "mage.shatter.cast" } });
    expect(spell.scaledClone.mock.calls).toEqual([[1], [2]]);
    expect(actor.items.get("shatter").scaledClone).toHaveBeenCalledWith(1);
    expect(spell.scaledClone.mock.results[0].value.system.activities[0].rollDamage).toHaveBeenCalledWith({}, NO_DIALOG, { data: { system: { targets: [] } } });
    expect(await rollDnd5eDamage(token, { action: { id: "mage.burning-hands.cast" } })).toEqual({ damage: { byType: { fire: 9 } }, card: "dmg-1" });
    expect(spell.system.activities[0].rollDamage).toHaveBeenCalledTimes(1);
    expect(spell.scaledClone).toHaveBeenCalledTimes(2);
  });

  test("a breath weapon's, secret for the GMs only; damage of no type, untyped", async () => {
    const { token, actor } = mage([breath()]);
    const fire = actor.items.get("fire-breath").system.activities[0];
    fire.next.rolls = [damageRoll(28, "fire"), { total: 2, options: {}, parent: { id: "dmg-2" } }];
    expect(await new Dnd5eAdapter().rollDamage(token, { action: { id: "mage.fire-breath.breath" }, secret: true })).toEqual({ damage: { byType: { fire: 28, untyped: 2 } }, card: "dmg-1" });
    expect(fire.rollDamage).toHaveBeenCalledWith({}, NO_DIALOG, { rollMode: "gm", data: { system: { targets: [] } } });
    expect(actor.items.get("fire-breath").scaledClone).not.toHaveBeenCalled();
  });

  test("null: an attack's (rollStrike's), healing, darts dnd5e rolls one at a time (the engine's dice), the helper's own; nothing rolled, or the roll failing", async () => {
    const { token, actor } = mage([fireBolt(), cureWounds(), magicMissile(), breath()]);
    for ( const id of ["mage.fire-bolt.bolt", "mage.cure-wounds.heal", "mage.magic-missile.darts", "mage.magic-missile.darts@slots:2", "mage.dodge"] ) {
      expect([id, await rollDnd5eDamage(token, { action: { id } })]).toEqual([id, null]);
    }
    for ( const id of ["fire-bolt", "cure-wounds", "magic-missile"] ) expect(actor.items.get(id).system.activities[0].rollDamage).not.toHaveBeenCalled();
    const fire = actor.items.get("fire-breath").system.activities[0];
    fire.next.rolls = undefined;
    expect(await rollDnd5eDamage(token, { action: { id: "mage.fire-breath.breath" } })).toBeNull();
    fire.rollDamage.mockRejectedValueOnce(new Error("no"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await rollDnd5eDamage(token, { action: { id: "mage.fire-breath.breath" } })).toBeNull();
    quiet.mockRestore();
    // (Its card where dnd5e gave none: the damage still, the engine's sum applied.)
    fire.next.rolls = [{ total: 30, options: { type: "fire" } }];
    expect(await rollDnd5eDamage(token, { action: { id: "mage.fire-breath.breath" } })).toEqual({ damage: { byType: { fire: 30 } }, card: null });
  });
});

describe("each target's share, applied the dnd5e way", () => {
  /** A creature whose applyDamage keeps each call. */
  const target = () => {
    const actor = { uuid: "Scene.s.Token.tokB.Actor.gob", statuses: new Set(), items: [], effects: [], system: { attributes: { hp: { value: 20, temp: 0, tempmax: 0, max: 20 } }, _source: { attributes: { hp: { value: 20, temp: 0, tempmax: 0 } } } }, applyDamage: vi.fn(async () => {}) };
    return { token: { uuid: "Scene.s.Token.tokB", actor }, actor };
  };
  const card = { id: "dmg-1", type: "damage", system: { targets: [GOBLIN], onSave: "half" }, rolls: [damageRoll(14, "fire"), damageRoll(3, "cold")] };

  test("a save's half: the damage card's damages by type, through the actor's applyDamage at 0.5, the card its origin", async () => {
    const { token, actor } = target();
    const records = await new Dnd5eAdapter().applyDamageCard(card, token, { multiplier: 0.5 });
    expect(actor.applyDamage).toHaveBeenCalledWith([{ type: "fire", properties: new Set(), value: 14 }, { type: "cold", properties: new Set(), value: 3 }],
      { multiplier: 0.5, isDelta: true, originatingMessage: card, origin: card });
    expect(records).toHaveLength(1);
  });

  test("none (a save that leaves it nothing): nothing applied, no record", async () => {
    const { token, actor } = target();
    expect(await applyDnd5eDamageCard(card, token, { multiplier: 0 })).toEqual([]);
    expect(await applyDnd5eDamageCard(card, token, { multiplier: -1 })).toEqual([]);
    expect(actor.applyDamage).not.toHaveBeenCalled();
  });
});
