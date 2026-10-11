/**
 * Words for the table, in its language: the D&D 5e system's own names where it has them (skills, conditions, coins:
 * in Spanish, French ... when a translation of the system is installed), a character's features by their own names,
 * and this module's words (FFDND5E in languages/) for the rest. English without Foundry (the tests).
 * A translation of the 5e compendiums (Babele: translate-dnd5e-sdr2-es and the like) doesn't translate the system's own
 * words; where they're still English in a reader's other language, this module's own words stand in.
 */
import { localize, language } from "./core.js";

/** This module's words. */
export const t = (key, english, data = null) => localize(`FFDND5E.${key}`, english, data);

/** A word from the system's CONFIG: a translation key, or the text the system has already translated it to. */
function sys(value, english) {
  if ( typeof value !== "string" || !value ) return english;
  const i18n = globalThis.game?.i18n;
  return i18n?.has?.(value) ? i18n.localize(value) : value;
}

/** The system's word, or (the system not translated into the reader's language: still the English) this module's. */
function sysOr(value, english, ownKey) {
  const word = sys(value, english);
  return language() !== "en" && word.toLocaleLowerCase() === english.toLocaleLowerCase() ? t(ownKey, english) : word;
}

/** A skill's name ("Persuasion"), as the system calls it. */
export const skillName = (key, english) => sysOr(globalThis.CONFIG?.DND5E?.skills?.[key]?.label, english, `Skill.${key}`);

/** A condition's name, lower case ("frightened"), as the system calls it. */
export function conditionName(key, english = key) {
  const c = globalThis.CONFIG?.DND5E?.conditionTypes?.[key];
  return sysOr(c?.label ?? c?.name, english, `Cond.${key}`).toLocaleLowerCase();
}

/** A coin's abbreviation ("gp"), as the system writes it. */
export const coin = c => sysOr(globalThis.CONFIG?.DND5E?.currencies?.[c]?.abbreviation, c, `Coin.${c}`);

/*
 * In a translated world (a Babele translation of the 5e compendiums: translate-dnd5e-sdr2-es and the like), an item
 * taken from a compendium reads in the table's language, and the rules it states are worded that way. The rules are
 * read here from the English (what Babele keeps of the original), so they're understood whatever the language. Without
 * Babele, or for an item it didn't translate: the item as it is.
 */

/** An item's name as the English books have it. */
export const englishName = item => item?.flags?.babele?.originalName ?? item?.name ?? "";

/** An item's description as the English books have it. */
export function englishDescription(item) {
  const original = item?.flags?.babele?.originalPayload?.description;
  return typeof original === "string" && original ? original : item?.system?.description?.value ?? "";
}
