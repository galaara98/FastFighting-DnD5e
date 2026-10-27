/**
 * Food in D&D 5e, for the core (API 27: its foundry/food.js). What 5e's creatures eat, how likely they come to a fight
 * hungry, what a body leaves when it dies, and what counts as food. The SRD keeps no diets, so it goes by creature type:
 *   - Eats nothing: constructs, elementals, undead, and the mindless (traits.js isMindless: a zombie, an ooze).
 *   - A beast, monstrosity or dragon that bites (an attack whose identifier is a bite, jaws, fangs, a beak or
 *     mandibles) eats meat; any other of them eats anything; any other living creature too, rarely hungry in a fight.
 *   - Corpses (core API 30): an undead's is a Rotten Corpse and a construct's a Scrap Corpse, neither of them food
 *     (dnd5e's loot, junk and material); none from an elemental, ooze, plant, swarm or incorporeal body (Incorporeal
 *     Movement); else a Fresh Corpse, dnd5e's food, its portions by size (tiny 1 to gargantuan 32) in the core's portions
 *     flag, eaten a portion at a time. Its weight is a creature's of that size, roughly.
 *   - Food: a fresh corpse, and dnd5e's food consumables (Rations).
 * The core weighs the rest: wisdom against hunger, and the chance any creature that eats is famished.
 */
import { MODULE_ID } from "./core.js";
import { t } from "./words.js";
import { isMindless } from "./traits.js";

/** Creature types that never eat. */
const EATS_NOTHING = Object.freeze(["construct", "elemental", "undead"]);
/** Creature types that hunt and eat as animals do. */
const ANIMALS = Object.freeze(["beast", "monstrosity", "dragon"]);
/** Creature types with no body to leave (a corpse only as ROTTEN or SCRAP say). */
const NO_FLESH = Object.freeze(["elemental", "ooze", "plant"]);
/** An attack made with the mouth: its identifier. */
const BITES = Object.freeze(["bite", "jaws", "fangs", "beak", "mandibles"]);
/** A body that can't be touched leaves nothing: its feature's identifier. */
const INCORPOREAL = "incorporeal-movement";
/** Each kind of corpse: its name's key (and its hint's, with Hint), icon and dnd5e item. */
export const CORPSES = Object.freeze({
  fresh: { key: "FreshCorpse", img: "icons/consumables/meat/steak-raw-red-pink.webp", type: "consumable", subtype: "food" },
  rotten: { key: "RottenCorpse", img: "icons/commodities/bones/bones-stack-worn-brown.webp", type: "loot", subtype: "junk" },
  scrap: { key: "ScrapCorpse", img: "icons/commodities/tech/cog-gear-crank-steel.webp", type: "loot", subtype: "material" }
});
/** Portions of meat a body leaves, by dnd5e size. */
const MEAT_BY_SIZE = Object.freeze({ tiny: 1, sm: 2, med: 4, lg: 8, huge: 16, grg: 32 });
/** A body's weight in pounds, by dnd5e size: roughly a creature's. */
const POUNDS_BY_SIZE = Object.freeze({ tiny: 8, sm: 35, med: 150, lg: 1000, huge: 6000, grg: 24000 });
/** How likely each kind comes to a fight hungry (the core's chance, before wisdom). */
export const HUNGER = Object.freeze({ biter: 0.4, beast: 0.3, living: 0.1 });

const typeOf = actor => String(actor?.system?.details?.type?.value ?? (actor?.type === "character" ? "humanoid" : "")).toLowerCase();
const identifiers = actor => new Set((actor?.items ?? []).map(i => i.system?.identifier).filter(Boolean));
const eatsNothing = actor => EATS_NOTHING.includes(typeOf(actor)) || (actor?.type === "npc" && isMindless(actor.system?.abilities?.int?.value, typeOf(actor)));

/** What it eats, and how likely it comes to a fight hungry. */
export function dnd5eAppetite(actor) {
  if ( !actor || !["character", "npc"].includes(actor.type) ) return null;
  if ( eatsNothing(actor) ) return { diet: null, hunger: 0, cannibal: false };
  if ( ANIMALS.includes(typeOf(actor)) ) {
    const bites = (actor.items ?? []).some(i => i.type === "weapon" && BITES.includes(i.system?.identifier));
    return bites ? { diet: "meat", hunger: HUNGER.biter, cannibal: false } : { diet: "any", hunger: HUNGER.beast, cannibal: false };
  }
  return { diet: "any", hunger: HUNGER.living, cannibal: false };
}

/** The kind of corpse its body leaves (CORPSES), or null for none. */
export function dnd5eCorpseKind(actor) {
  if ( !actor || !["character", "npc"].includes(actor.type) ) return null;
  if ( identifiers(actor).has(INCORPOREAL) || actor.system?.details?.type?.swarm ) return null;
  const type = typeOf(actor);
  if ( type === "undead" ) return "rotten";
  if ( type === "construct" ) return "scrap";
  return NO_FLESH.includes(type) ? null : "fresh";
}

/** The corpse its body leaves when it dies (core API 30): {item, quantity: its portions, 0 for no food}, or null. */
export function dnd5eMeatFor(actor) {
  const kind = dnd5eCorpseKind(actor);
  if ( !kind ) return null;
  const size = actor.system?.traits?.size;
  const portions = kind === "fresh" ? MEAT_BY_SIZE[size] ?? MEAT_BY_SIZE.med : 0;
  const { key, img, type, subtype } = CORPSES[kind];
  return {
    quantity: portions,
    item: {
      name: t(key),
      type,
      img,
      system: {
        type: { value: subtype },
        quantity: 1,
        weight: { value: POUNDS_BY_SIZE[size] ?? POUNDS_BY_SIZE.med, units: "lb" },
        description: { value: `<p>${t(`${key}Hint`)}</p>` }
      },
      flags: { [MODULE_ID]: { corpse: kind, ...(portions ? { food: "meat", portions } : {}) } }
    }
  };
}

/** Whether a thing can be eaten: {portions, meat}, or null. A fresh corpse (its portions left), dnd5e's food. */
export function dnd5eIsFood(item) {
  if ( !item ) return null;
  const quantity = Math.max(1, Number(item.system?.quantity ?? 1) || 1);
  const flags = item.flags?.[MODULE_ID] ?? (typeof item.getFlag === "function" ? { food: item.getFlag(MODULE_ID, "food"), portions: item.getFlag(MODULE_ID, "portions") } : {});
  if ( flags?.food === "meat" ) {
    const portions = flags.portions ?? null;
    if ( portions === null ) return { portions: quantity, meat: true };
    return Number(portions) > 0 ? { portions: Math.round(Number(portions)), meat: true } : null;
  }
  if ( item.type === "consumable" && item.system?.type?.value === "food" ) return { portions: quantity, meat: false };
  return null;
}
