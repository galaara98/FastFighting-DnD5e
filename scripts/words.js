/**
 * Words for the table, in its language: the D&D 5e system's own names where it has them (skills, conditions, coins:
 * in Spanish, French ... when a translation of the system is installed), a character's features by their own names,
 * and this module's words (FFDND5E in languages/) for the rest. The words are in the language files, never here.
 * A translation of the 5e compendiums (Babele: translate-dnd5e-sdr2-es and the like) doesn't translate the system's own
 * words; where the system isn't translated into a reader's language and this module is, this module's words stand in.
 */
import { localize, hasWords, language } from "./core.js";

/** This module's words. */
export const t = (key, data = null) => localize(`FFDND5E.${key}`, data);

/** This module's word for a key, if its language files have one (else `otherwise`). */
const own = (key, otherwise) => (hasWords(`FFDND5E.${key}`) ? t(key) : otherwise);

/** A word from the system's CONFIG: a translation key, or the text the system has already translated it to (null: none). */
function sys(value) {
  if ( typeof value !== "string" || !value ) return null;
  return hasWords(value) ? localize(value) : value;
}

/**
 * Is the system translated into the reader's language? One of its own keys, read without falling back to English
 * (Foundry's has(key, false)), tells.
 */
const systemTranslated = () => language() === "en" || !!globalThis.game?.i18n?.has?.("DND5E.SkillPer", false);

/** Is this module's word for a key translated into the reader's language (not English standing in)? */
const ownTranslated = key => !!globalThis.game?.i18n?.has?.(`FFDND5E.${key}`, false);

/** The system's word, or this module's: where the system has none, or isn't translated into the reader's language. */
function sysOr(value, ownKey, otherwise) {
  const word = sys(value);
  if ( !word ) return own(ownKey, otherwise);
  return !systemTranslated() && ownTranslated(ownKey) ? t(ownKey) : word;
}

/** A skill's name ("Persuasion"), as the system calls it. */
export const skillName = key => sysOr(globalThis.CONFIG?.DND5E?.skills?.[key]?.label, `Skill.${key}`, key);

/** A condition's name, lower case ("frightened"), as the system calls it. */
export function conditionName(key) {
  const c = globalThis.CONFIG?.DND5E?.conditionTypes?.[key];
  return sysOr(c?.label ?? c?.name, `Cond.${key}`, key).toLocaleLowerCase();
}

/** A coin's abbreviation ("gp"), as the system writes it. */
export const coin = c => sysOr(globalThis.CONFIG?.DND5E?.currencies?.[c]?.abbreviation, `Coin.${c}`, c);

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
