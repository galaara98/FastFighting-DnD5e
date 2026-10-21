/**
 * What a 5e creature's passive features do for the core: auras that make foes save (auras.js: the core's spec.auras),
 * and advantage on some saves (save-vs.js: spec.saveVs), from the sheet's save roll modes and a feature's words. The
 * words are the SRD's (5.1 and 5.2), as dnd5e's compendiums have them, read by reading/en.json.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { auraOf, auraRange, auraTiming, isAuraActivity } from "../scripts/auras.js";
import { damageTags, saveVsFromWords, sheetSaveVs } from "../scripts/save-vs.js";
import { mergeReading } from "../scripts/reading.js";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { effectTags, saveVsApplies } from "../../FastFighting/scripts/engine/behavior/save-vs.js";

/** A save activity as dnd5e prepares one. */
const saveActivity = ({ id = "act", activation = "", condition = "", range = { units: "self" }, template = { type: "radius", size: "5", units: "ft" }, ability = "con", dc = 10, effects = [] } = {}) => ({
  id, type: "save", activation: { type: activation, condition }, range, target: { template, affects: { type: "creature" } },
  save: { ability: new Set([ability]), dc: { value: dc } }, damage: { onSave: "none", parts: [] }, effects
});
const poisoned = { conditions: { poisoned: 1 }, rounds: 10, label: "Poisoned" };

describe("auras (auras.js)", () => {
  const STENCH_2014 = "When a creature starts its turn within 5 feet of the monster Any creature that starts its turn within 5 feet of the monster must succeed on a saving throw or be poisoned until the start of its next turn. On a successful saving throw, the creature is immune to the monster's Stench for 24 hours.";
  const STENCH_2024 = " Constitution Saving Throw: DC 10, any creature (other than a monster) that starts its turn in a 5-foot Emanation originating from the monster. Failure: The target has the Poisoned condition until the start of its next turn. Success: The target is immune to the Stench of all monster for 1 hour.";

  test("a ghast's Stench (2014): turn start, 5 feet, a Constitution save, poisoned to the start of its next turn, immune once saved", () => {
    const activity = saveActivity({ activation: "special", condition: "When a creature starts its turn within 5 feet of the monster" });
    expect(isAuraActivity(activity)).toBe(true);
    expect(auraOf({ id: "stench.act", key: "stench", name: "Stench", activity, text: STENCH_2014, dc: 10, failure: poisoned })).toEqual({
      id: "stench.act", key: "stench", label: "Stench", range: 5, save: { type: "con", dc: 10, basic: false },
      byDegree: [{ ...poisoned, rounds: 1 }, { ...poisoned, rounds: 1 }, null, null],
      when: "turnStart", immuneAfter: "success", immuneAll: false, foesOnly: true
    });
  });

  test("2024's: no activation at all, and immune to every ghast's stench once saved", () => {
    const aura = auraOf({ id: "s", key: "stench", activity: saveActivity(), text: STENCH_2024, dc: 10, failure: poisoned });
    expect(aura).toMatchObject({ range: 5, when: "turnStart", immuneAfter: "success", immuneAll: true });
    expect(aura.byDegree[1].rounds).toBe(1);
  });

  test("a hezrou's (2014): its reach a range in feet, with no area of its own", () => {
    const activity = saveActivity({ activation: "special", range: { units: "ft", value: "10" }, template: { type: "", size: "" } });
    expect(auraRange(activity)).toBe(10);
    expect(auraOf({ id: "h", activity, text: STENCH_2014.replace(/5 feet/g, "10 feet"), dc: 14, failure: poisoned })).toMatchObject({ range: 10, save: { dc: 14 } });
  });

  test("a sea hag's Horrific Appearance: only for those who can see it, frightened for its full minute (averting eyes is no failure)", () => {
    const text = "Any humanoid that starts its turn within 30 feet of the monster and can see the monster's true form must make a DC 11 Wisdom saving throw. On a failed save, the creature is frightened for 1 minute. A creature can repeat the saving throw at the end of each of its turns, with disadvantage if the hag is within line of sight, ending the effect on itself on a success. If a creature's saving throw is successful or the effect ends for it, the creature is immune to the monster's Horrific Appearance for the next 24 hours. Unless the target is surprised or the revelation of the hag's true form is sudden, the target can avert its eyes and avoid making the initial saving throw. Until the start of its next turn, a creature that averts its eyes has disadvantage on attack rolls against the monster.";
    const frightened = { conditions: { frightened: 1 }, rounds: 10, label: "Frightened", repeatSave: { type: "wis", dc: 11 } };
    const aura = auraOf({ id: "ha", activity: saveActivity({ activation: "special", ability: "wis", template: { type: "radius", size: "30", units: "ft" } }), text, dc: 11, failure: frightened });
    expect(aura).toMatchObject({ range: 30, needs: "sight", when: "turnStart", immuneAfter: "success", immuneAll: false });
    expect(aura.byDegree[1]).toEqual(frightened);
  });

  test("hearing, entering, and both", () => {
    expect(auraTiming("Each creature that starts its turn within 20 feet of the monster and can hear the gibbering must succeed on a DC 10 Wisdom saving throw.")).toMatchObject({ when: "turnStart", needs: "hearing", immuneAfter: null });
    expect(auraTiming("A creature that enters the area for the first time on a turn or starts its turn there must make a saving throw.")).toMatchObject({ when: "both" });
    expect(auraTiming("When a creature enters the emanation, it must succeed on a saving throw.")).toMatchObject({ when: "enter" });
  });

  test("none: nothing a failure comes to (2024's Gibbering: a roll on a table), an action, a touch, words of no aura", () => {
    const gibbering = "Wisdom Saving Throw: DC 10, any creature that starts its turn within 20 feet of the monster while it is babbling. Failure: The target rolls 1d8 to determine what it does during the current turn.";
    expect(auraOf({ id: "g", activity: saveActivity({ ability: "wis", template: { type: "radius", size: "20", units: "ft" } }), text: gibbering, dc: 10, failure: null })).toBeNull();
    expect(auraOf({ id: "a", activity: saveActivity({ activation: "action" }), text: STENCH_2014, dc: 10, failure: poisoned })).toBeNull();
    expect(auraOf({ id: "t", activity: saveActivity({ range: { units: "touch" }, template: {} }), text: STENCH_2014, dc: 10, failure: poisoned })).toBeNull();
    expect(auraOf({ id: "d", activity: saveActivity(), text: "When the monster dies, it explodes in a burst of dust. Each creature within 5 feet of it must then succeed on a DC 10 Constitution saving throw or be blinded for 1 minute.", dc: 10, failure: poisoned })).toBeNull();
  });
});

describe("advantage on some saves (save-vs.js)", () => {
  const read = text => saveVsFromWords(text).map(e => ({ ...e, ...(e.vs ? { vs: [...e.vs].sort() } : {}) }));

  test("against magic: Magic Resistance (2014, 2024), Gnome Cunning, Limited Magic Immunity", () => {
    expect(read("The monster has advantage on saving throws against spells and other magical effects.")).toEqual([{ advantage: 1, vs: ["magical"] }]);
    expect(read("The  has Advantage on saving throws against spells and other magical effects.")).toEqual([{ advantage: 1, vs: ["magical"] }]);
    expect(read("You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic.")).toEqual([{ advantage: 1, saves: ["int", "wis", "cha"], vs: ["magical"] }]);
    expect(read("The monster can't be affected or detected by spells of 6th level or lower unless it wishes to be. It has advantage on saving throws against all other spells and magical effects.")).toEqual([{ advantage: 1, vs: ["magical"] }]);
  });

  test("against a condition: Fey Ancestry, Brave (2014, 2024), Sure-Footed, Two Heads", () => {
    expect(read("You have advantage on saving throws against being charmed, and magic can't put you to sleep.")).toEqual([{ advantage: 1, vs: ["inflicts:controlled"] }]);
    expect(read("You have Advantage on saving throws you make to avoid or end the Charmed condition.")).toEqual([{ advantage: 1, vs: ["inflicts:controlled"] }]);
    expect(read("You have advantage on saving throws against being frightened.")).toEqual([{ advantage: 1, vs: ["inflicts:frightened"] }]);
    expect(read("You have Advantage on saving throws you make to avoid or end the Frightened condition.")).toEqual([{ advantage: 1, vs: ["inflicts:frightened"] }]);
    expect(read("The monster has advantage on Strength and Dexterity saving throws made against effects that would knock it prone.")).toEqual([{ advantage: 1, saves: ["str", "dex"], vs: ["inflicts:prone"] }]);
    expect(read("The monster has advantage on Wisdom (Perception) checks and on saving throws against being blinded, charmed, deafened, frightened, stunned, and knocked unconscious.")).toEqual([
      { advantage: 1, vs: ["inflicts:blinded", "inflicts:controlled", "inflicts:deafened", "inflicts:frightened", "inflicts:stunned", "inflicts:unconscious"] }
    ]);
  });

  test("against poison: Dwarven Resilience (2014: poison and being poisoned; 2024: the Poisoned condition), Duergar Resilience", () => {
    expect(read("You have advantage on saving throws against poison, and you have resistance against poison damage.")).toEqual([{ advantage: 1, vs: ["damage:poison", "inflicts:poisoned"] }]);
    expect(read("You have Resistance to Poison damage. You also have Advantage on saving throws you make to avoid or end the Poisoned condition. Foundry Note You will automatically be granted Resistance to Poison damage but not Advantage on saving throws to avoid/end the Poisoned condition.")).toEqual([{ advantage: 1, vs: ["inflicts:poisoned"] }]);
    expect(read("The monster has advantage on saving throws against poison, spells, and illusions, as well as to resist being charmed or paralyzed.")).toEqual([
      { advantage: 1, vs: ["damage:poison", "inflicts:controlled", "inflicts:paralyzed", "inflicts:poisoned", "magical"] }
    ]);
  });

  test("on every save of an ability: 2014's Danger Sense, against what it sees (its examples aren't a limit)", () => {
    expect(read("At 2nd level, you gain an uncanny sense of when things nearby aren't as they should be, giving you an edge when you dodge away from danger. You have advantage on Dexterity saving throws against effects that you can see, such as traps and spells. To gain this benefit, you can't be blinded, deafened, or incapacitated.")).toEqual([{ advantage: 1, saves: ["dex"] }]);
  });

  test("none: only while something holds, for others, or against what the engine doesn't tell apart", () => {
    for ( const text of [
      "While Bloodied, the monster has Advantage on attack rolls and saving throws.",
      "While in a 20-foot Emanation originating from the monster, the monster and its allies have Advantage on attack rolls and saving throws, provided the monster doesn't have the Incapacitated condition.",
      "You have Advantage on Constitution saving throws that you make to maintain Concentration.",
      "The monster and any ghouls within 30 ft. of it have advantage on saving throws against effects that turn undead.",
      "In addition, you have advantage on saving throws against plants that are magically created or manipulated to impede movement, such those created by the Entangle spell.",
      "The monster has five heads. While it has more than one head, the monster has advantage on saving throws against being blinded, charmed, deafened, frightened, stunned, and knocked unconscious.",
      "You have advantage on saving throws against being swallowed."
    ] ) expect(read(text)).toEqual([]);
  });

  test("the sheet's save roll modes: advantage or disadvantage on every save of that ability", () => {
    expect(sheetSaveVs({ dex: 1, wis: -1, con: 0 })).toEqual([{ advantage: 1, saves: ["dex"] }, { advantage: -1, saves: ["wis"] }]);
    expect(sheetSaveVs()).toEqual([]);
  });

  test("the engine's tags they go by: a bite's venom is poison, a stench's poisoning inflicts poisoned", () => {
    const bite = { damage: [{ type: "piercing" }], effects: [{ kind: "save", damage: [{ type: "poison" }] }] };
    expect(damageTags(bite)).toEqual(["damage:piercing", "damage:poison"]);
    const [dwarf] = read("You have advantage on saving throws against poison, and you have resistance against poison damage.");
    expect(saveVsApplies(dwarf, "con", effectTags({ traits: damageTags(bite) }))).toBe(true);
    expect(saveVsApplies(dwarf, "con", effectTags({ traits: [], onSave: [poisoned] }))).toBe(true);
    expect(saveVsApplies(dwarf, "con", effectTags({ traits: ["damage:fire"] }))).toBe(false);
  });
});

describe("the reading words, merged", () => {
  test("a word in both languages is either; an object, key by key, all the way down; the English where a file lacks it", () => {
    const en = { saveVs: { saves: { pattern: "saving throws?" }, tags: { magical: { pattern: "spells?" }, "inflicts:prone": { pattern: "prone" } } } };
    const es = { saveVs: { saves: { pattern: "tiradas? de salvación" }, tags: { magical: { pattern: "conjuros?" } } } };
    expect(mergeReading(en, es)).toEqual({ saveVs: {
      saves: { pattern: "(?:tiradas? de salvación)|(?:saving throws?)" },
      tags: { magical: { pattern: "(?:conjuros?)|(?:spells?)" }, "inflicts:prone": { pattern: "prone" } }
    } });
  });
});

describe("read from a sheet (the adapter)", () => {
  const listOf = list => Object.assign(list, { get: id => list.find(i => i.id === id), getName: name => list.find(i => i.name === name) });
  const feat = (identifier, name, { text = "", activities = [], effects = [] } = {}) => ({
    id: identifier, type: "feat", name, identifier, flags: {}, effects: listOf(effects),
    system: { identifier, activities, description: { value: `<p>${text}</p>` }, properties: new Set(), duration: {} }
  });
  const actorOf = ({ type = "npc", items = [], modes = {} } = {}) => ({
    id: "actor", uuid: "Actor.actor", documentName: "Actor", type, name: "Ghast", img: "", flags: {}, statuses: new Set(), appliedEffects: [], classes: {},
    items: listOf(items), getRollData: () => ({}), toObject() { return { name: this.name }; },
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { value: 10, mod: 0, save: { value: 0, roll: { mode: modes[k] ?? 0 } } }])),
      attributes: { hp: { value: 30, max: 30, temp: 0 }, ac: { value: 13 }, movement: { walk: 30, units: "ft" }, senses: {}, death: {} },
      details: { cr: 2, level: 1, type: { value: "undead" } },
      skills: {}, traits: { size: "med", languages: { value: new Set() }, di: {}, dr: {}, dv: {}, ci: {} }, resources: {}, currency: {}, spells: {}
    }
  });
  const specOf = actor => new Dnd5eAdapter().toCombatantSpec({ id: "token", name: actor.name, actor });

  beforeEach(() => { globalThis.Roll = { replaceFormulaData: f => String(f) }; });
  afterEach(() => { delete globalThis.Roll; });

  test("a ghast's Stench: its effect's Poisoned, until the start of the target's next turn", async () => {
    const effect = { id: "fx", name: "Poisoned", statuses: new Set(["poisoned"]), changes: [], duration: {} };
    const activity = saveActivity({ activation: "special", condition: "When a creature starts its turn within 5 feet of the [[lookup @name lowercase]]{monster}", effects: [{ _id: "fx" }] });
    const stench = feat("stench", "Stench", { activities: [activity], effects: [effect],
      text: "Any creature that starts its turn within 5 feet of the [[lookup @name lowercase]]{monster} must succeed on a [[/save]] saving throw or be &amp;reference[poisoned] until the start of its next turn. On a successful saving throw, the creature is immune to the [[lookup @name lowercase]]{monster}'s [[lookup @item.name]] for 24 hours." });
    const [aura] = (await specOf(actorOf({ items: [stench] }))).auras;
    expect(aura).toMatchObject({ id: "stench.act", key: "stench", label: "Stench", range: 5, save: { type: "con", dc: 10 }, when: "turnStart", immuneAfter: "success" });
    expect(aura.byDegree[1]).toMatchObject({ conditions: { poisoned: 1 }, rounds: 1 });
  });

  test("2024's Danger Sense by the sheet's roll mode its effect sets (its words not read again); 2014's Dwarven Resilience by its words; Rage, an action, not at all", async () => {
    const dangerSense = feat("danger-sense", "Danger Sense", { text: "You have Advantage on Dexterity saving throws unless you have the Incapacitated condition.",
      effects: [{ id: "ds", transfer: true, disabled: false, system: { changes: [{ key: "system.abilities.dex.save.roll.mode", value: 1, type: "add" }] } }] });
    const resilience = feat("dwarven-resilience", "Dwarven Resilience", { text: "You have advantage on saving throws against poison, and you have resistance against poison damage." });
    const rage = feat("rage", "Rage", { text: "While raging, you gain the following benefits: You have advantage on Strength checks and Strength saving throws.", activities: [{ id: "r", type: "utility", activation: { type: "bonus" } }] });
    const spec = await specOf(actorOf({ type: "character", items: [dangerSense, resilience, rage], modes: { dex: 1 } }));
    expect(spec.saveVs).toEqual([{ advantage: 1, saves: ["dex"] }, { advantage: 1, vs: ["inflicts:poisoned", "damage:poison"] }]);
    expect(spec.auras).toBeUndefined();
  });
});
