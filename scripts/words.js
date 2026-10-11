/**
 * Words for the table, in its language: the D&D 5e system's own names where it has them (skills, conditions, coins:
 * in Spanish, French ... when a translation of the system is installed), a character's features by their own names,
 * and this module's words (FFDND5E in languages/) for the rest. English without Foundry (the tests).
 */
import { localize } from "./core.js";

/** This module's words. */
export const t = (key, english, data = null) => localize(`FFDND5E.${key}`, english, data);

/** A word from the system's CONFIG: a translation key, or the text the system has already translated it to. */
function sys(value, english) {
  if ( typeof value !== "string" || !value ) return english;
  const i18n = globalThis.game?.i18n;
  return i18n?.has?.(value) ? i18n.localize(value) : value;
}

/** A skill's name ("Persuasion"), as the system calls it. */
export const skillName = (key, english) => sys(globalThis.CONFIG?.DND5E?.skills?.[key]?.label, english);

/** A condition's name, lower case ("frightened"), as the system calls it. */
export function conditionName(key, english = key) {
  const c = globalThis.CONFIG?.DND5E?.conditionTypes?.[key];
  return sys(c?.label ?? c?.name, english).toLocaleLowerCase();
}

/** A coin's abbreviation ("gp"), as the system writes it. */
export const coin = c => sys(globalThis.CONFIG?.DND5E?.currencies?.[c]?.abbreviation, c);
