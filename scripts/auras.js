/**
 * Auras that make foes save, as dnd5e keeps them: the core's spec.auras (API 20). A feature with no activation of its
 * own (a passive one: 2024's blank, or 2014's "special" with the trigger in words) whose save activity reaches round
 * its bearer (range self with a radius, or a range in feet), and whose words say whoever starts its turn there (or
 * enters it) must save: a ghast's or a hezrou's Stench, a gibbering mouther's Gibbering, a sea hag's appearance.
 *   - range, save and DC: the activity's (its prepared DC);
 *   - what failing lays: the activity's effects, read as any save's are (the adapter's #effects), for a round where its
 *     words say "until the start (or end) of its next turn";
 *   - when it goes off, what a save makes it immune to (that bearer's, or every one of its kind: 2024's "the Stench of
 *     all ghasts"; the rest of the fight, as 24 hours or an hour is), and the sense it takes ("can see", "can hear"):
 *     its words, by the reading words' "auras" section (reading/<lang>.json).
 * A creature immune to what it lays the core judges as for any save (rules.isImmune).
 * Pure: plain values in, the core's aura out.
 */
import { currentReading, wordPattern } from "./reading.js";

/** One of the reading words' patterns, compiled (null for none, or one that won't compile). */
const patternOf = (words, key) => wordPattern(words?.[key]);

/** Activations that are no use of the creature's own: an aura goes off by itself (and a passive feature just is). */
export const PASSIVE_ACTIVATIONS = new Set(["", "special", "none"]);

/** How far an activity reaches round its bearer, in feet: range self and a radius, or a range in feet; else null. */
export function auraRange(activity) {
  const range = activity?.range ?? {};
  const template = activity?.target?.template ?? {};
  const feet = v => (Number(v) > 0 ? Number(v) : null);
  if ( range.units === "self" ) return ["radius", "sphere", "emanation"].includes(template.type) && (template.units ?? "ft") === "ft" ? feet(template.size) : null;
  return range.units === "ft" ? feet(range.value) : null;
}

/** Is this activity one an aura goes off by: a save, no activation of the creature's own, reaching round it? */
export function isAuraActivity(activity) {
  return activity?.type === "save" && PASSIVE_ACTIVATIONS.has(String(activity.activation?.type ?? "")) && !!auraRange(activity);
}

/**
 * When an aura goes off and who's immune once saved, from its words: {when, immuneAfter, immuneAll, needs, nextTurn},
 * or null where its words say nothing of a creature starting its turn there or entering it (a death burst, a passive
 * save that's no aura).
 */
export function auraTiming(text, words = currentReading().auras ?? {}) {
  const said = String(text ?? "").replace(/\s+/g, " ");
  const start = !!patternOf(words, "turnStart")?.test(said);
  const enter = !!patternOf(words, "enter")?.test(said);
  if ( !start && !enter ) return null;
  const immune = patternOf(words, "immune");
  const sentence = immune ? said.split(/(?<=[.!?;])\s+/).find(s => immune.test(s)) : null;
  const immuneAfter = !sentence ? null : patternOf(words, "immuneAny")?.test(sentence) ? "save" : patternOf(words, "immuneSuccess")?.test(sentence) ? "success" : "save";
  const needs = patternOf(words, "sight")?.test(said) ? "sight" : patternOf(words, "hearing")?.test(said) ? "hearing" : null;
  return {
    when: start && enter ? "both" : start ? "turnStart" : "enter", immuneAfter, immuneAll: !!sentence && !!patternOf(words, "immuneAll")?.test(sentence),
    needs, nextTurn: !!patternOf(words, "nextTurn")?.test(said)
  };
}

/**
 * One aura of the core's (spec.auras), or null: no aura activity, no DC, nothing its words say goes off, or nothing a
 * failed save comes to.
 * @param {object} d
 * @param {string} d.id          the adapter's id for it (its actor's, its item's)
 * @param {string} [d.key]       its kind (the item's identifier: "stench")
 * @param {string} [d.name]      its name, for the log and the story
 * @param {object} d.activity    the save activity
 * @param {string} d.text        its words, as plain text (the activity's trigger and the item's description)
 * @param {number} d.dc          its save's DC, as dnd5e prepared it
 * @param {object} [d.failure]   what a failed save lays (an outcome: conditions, rounds, label ...), or null
 * @param {object[]} [d.damage]  what it deals (DamagePart[])
 * @param {object} [d.words]     the reading words' "auras" section (reading.js, by default)
 */
export function auraOf({ id, key = "", name = "", activity, text = "", dc, failure = null, damage = [], words = currentReading().auras ?? {} }) {
  if ( !isAuraActivity(activity) || !Number.isFinite(Number(dc)) ) return null;
  // (dnd5e's is a set of abilities, the creature's choice: the first.)
  const ability = activity.save?.ability;
  const type = (typeof ability === "string" ? [ability] : [...(ability ?? [])]).find(a => typeof a === "string") ?? null;
  if ( !type ) return null;
  const timing = auraTiming(text, words);
  if ( !timing ) return null;
  const fail = failure ? { ...failure, ...(timing.nextTurn ? { rounds: 1 } : {}) } : null;
  if ( !fail && !damage.length ) return null;
  return {
    id, key: String(key || id), label: name, range: auraRange(activity), save: { type, dc: Number(dc), basic: activity.damage?.onSave === "half" },
    byDegree: [fail, fail, null, null], ...(damage.length ? { damage } : {}),
    when: timing.when, immuneAfter: timing.immuneAfter, immuneAll: timing.immuneAll, ...(timing.needs ? { needs: timing.needs } : {}), foesOnly: true
  };
}
