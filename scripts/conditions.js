/**
 * D&D 5e's statuses and the engine's conditions, both ways, for a live battle: what a sheet's statuses mean to the
 * engine (read at every turn), and which status shows each of the engine's conditions (written by commit.js). A
 * condition a sheet carries is written as its status and read back as the same key, so the sheet says whether it's
 * still there; the engine's others (off guard, dazed, held in place) the core keeps itself.
 *
 * The statuses are dnd5e's ids, the same in every language. Only CONFIG.statusEffects is read here, to ask whether this
 * world's dnd5e has a status at all (an older one may have no Hiding or Sleeping).
 */
import { statusEntry } from "./core.js";

/**
 * A dnd5e sheet's statuses, read as the engine's conditions: first the condition the status shows (written back as that
 * status: SHEET_STATUSES), then what else it means to the engine's rules: held in place (immobilized), or unable to act
 * at all (incapacitated, as dnd5e's own Paralyzed, Petrified, Stunned and Unconscious are).
 */
const READ = {
  prone: ["prone"],
  blinded: ["blinded"],
  charmed: ["charmed"],
  deafened: ["deafened"],
  frightened: ["frightened"],
  grappled: ["grabbed", "immobilized"],
  incapacitated: ["incapacitated"],
  invisible: ["invisible"],
  paralyzed: ["paralyzed", "incapacitated"],
  petrified: ["petrified", "incapacitated"],
  poisoned: ["poisoned"],
  restrained: ["restrained", "immobilized"],
  stunned: ["stunned", "incapacitated"],
  unconscious: ["unconscious", "incapacitated"],
  sleeping: ["asleep", "unconscious", "incapacitated"],
  silenced: ["silenced"],
  hiding: ["hidden"],
  // (The SRD 5.2's Burning hazard, dnd5e's status: the core's burning, on or off, 1d4 fire a turn by 5e's rules.)
  burning: ["burning"]
};

/** The engine's conditions a dnd5e sheet carries, each by the status that shows it (prone's is its own change). */
export const SHEET_STATUSES = Object.freeze(Object.fromEntries(Object.entries(READ).map(([status, [key]]) => [key, status])));

/** What a status means to the engine, as its conditions: the one it shows first, then what else it means. */
export const statusKeys = status => (Object.hasOwn(READ, status) ? READ[status] : []);

/**
 * The statuses the engine's conditions are written as: those the sheet carries, and control (a charm, domination),
 * shown as Charmed though the engine keeps who holds it (it's read back as charmed, not as control).
 */
export const WRITES = Object.freeze({ ...SHEET_STATUSES, controlled: "charmed" });

/** Does this world's dnd5e have the status? Without Foundry's list to ask (outside Foundry), yes. */
export function hasStatus(id) {
  return !globalThis.CONFIG?.statusEffects || !!statusEntry(id);
}

/**
 * Is the status on by its own effect, the one toggleStatusEffect puts on and takes off (not only as part of another's:
 * Incapacitated with Stunned, Unconscious with Sleeping)?
 */
export function ownStatus(actor, id) {
  const entry = statusEntry(id);
  if ( entry?._id && typeof actor?.effects?.get === "function" ) return !!actor.effects.get(entry._id);
  return !!actor?.statuses?.has?.(id);
}

/** Does a dnd5e sheet carry this engine condition: written as its status (exhaustion, as its level), read back as it? */
export function sheetCarries(key) {
  if ( key === "exhaustion" ) return true;
  return Object.hasOwn(SHEET_STATUSES, key) && hasStatus(SHEET_STATUSES[key]);
}

/** The engine's conditions on a dnd5e sheet: its statuses (READ), and its level of exhaustion. */
export function sheetConditions(actor) {
  const out = {};
  for ( const status of actor?.statuses ?? [] ) for ( const key of statusKeys(status) ) out[key] = 1;
  const exhaustion = Number(actor?.system?.attributes?.exhaustion) || 0;
  if ( exhaustion > 0 ) out.exhaustion = exhaustion;
  return out;
}

/**
 * dnd5e's own conditions, as the engine's keys, for the GM to put on a creature: those this world's dnd5e has, and
 * exhaustion, counted.
 */
export function sheetConditionChoices() {
  const own = Object.entries(SHEET_STATUSES).filter(([, status]) => hasStatus(status)).map(([key]) => ({ key }));
  return [...own, { key: "exhaustion", valued: true }];
}

/** The most levels of exhaustion dnd5e has (6: dead). */
export const exhaustionLevels = () => Number(globalThis.CONFIG?.DND5E?.conditionTypes?.exhaustion?.levels) || 6;
