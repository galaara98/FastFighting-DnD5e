/**
 * Ways to gain an edge in 5e, as the core's buffs (see the core's behavior/support.js). Pure, unit-tested.
 *
 *  - Help (anyone with a mind, an action): advantage on a friend's next attack at a foe within 5 feet of the helper,
 *    or on its next ability check (its words, a Medicine check) toward whoever it's set on.
 *  - Insight, before talking (a creature proficient in it, that can talk; an action): a Wisdom (Insight) check
 *    against DC 15 to read the one it means to talk round, for advantage on its next words to them.
 *  - Study (2024), to size a foe up (a Lore-Collector): its best knowledge skill, Arcana, History, Investigation,
 *    Nature or Religion.
 * (Guidance, Bardic Inspiration, True Strike, Steady Aim and Guiding Bolt are read from their words: effects.js.)
 * Everything here is in the free SRD (5.1 and 5.2).
 */

/** Skills that recall what's known about a creature (the 2024 Study action). */
export const STUDY_SKILLS = Object.freeze(["arc", "his", "inv", "nat", "rel"]);
/** DC to read someone with Insight in a fight (a moderate task). */
export const INSIGHT_DC = 15;

/** The Help action. */
export function helpAction(actorId) {
  return {
    id: `${actorId}.help`, name: "Help", kind: "buff", cost: 1, traits: [], includeSelf: false, besideFoe: 5,
    // (The friend can be anywhere; the foe has to be beside the helper.)
    range: { increment: 600, max: 600, noPenalty: true },
    outcome: { mods: { adv: 1, checkAdv: 1 }, uses: 1, vsFocus: true, rounds: 1, label: "helped" }
  };
}

/** Reading the one it means to talk round, with Insight. */
export function insightAction(actorId, mod) {
  return {
    id: `${actorId}.insight`, name: "Insight", kind: "buff", targets: "self", cost: 1, traits: [],
    check: { mod, dc: INSIGHT_DC, label: "Insight" },
    outcome: { mods: { checkAdv: 1 }, uses: 1, vsFocus: true, rounds: 2, label: "sees through them" }
  };
}

const total = s => (s ? Number(s.total ?? s.mod) : NaN);
const proficient = s => (Number(s?.proficient ?? s?.value) || 0) >= 1;

/** The Study check: its best knowledge skill, or undefined without one. */
export function studyCheck(sys) {
  let best = null;
  for ( const key of STUDY_SKILLS ) {
    const mod = total(sys?.skills?.[key]);
    if ( Number.isFinite(mod) && (!best || mod > best.mod) ) best = { mod, label: "Study" };
  }
  return best ?? undefined;
}

/**
 * The edges a creature can try for: Help for anyone with a mind; Insight for one proficient in it that has words.
 * @param {object} o
 * @param {string} o.id
 * @param {object} o.sys        the actor's system data (skills, languages)
 * @param {boolean} o.mindless
 */
export function edgeActions({ id, sys, mindless }) {
  if ( mindless ) return [];
  const out = [helpAction(id)];
  const ins = sys?.skills?.ins;
  const langs = sys?.traits?.languages?.value;
  const speaks = (langs instanceof Set ? langs.size : Array.isArray(langs) ? langs.length : 0) > 0;
  if ( speaks && proficient(ins) && Number.isFinite(total(ins)) ) out.push(insightAction(id, total(ins)));
  return out;
}
