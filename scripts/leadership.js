/**
 * D&D 5e leadership: who leads a side, and what that's worth. The best Persuasion or Intimidation for the level,
 * and features that read like command (Leadership, Rallying Cry, Commander's Strike, Bardic Inspiration ...).
 */
import { proficiency } from "./rules.js";
import { listItems, signedNumber } from "./core.js";
import { t } from "./words.js";

// ("Pack Tactics" is how wolves hunt, not command.) Matched against identifiers too, so hyphens count as spaces.
const LEADER_FEATURE = /(leadership|rally|rallying|commander|inspir|battle[ -]cry|warlord|captain|(?<!pack[ -])tactic)/i;

/**
 * @param {object[]} entries  [{id, level, skills: {persuasion, intimidation}, features: [{key, name}]}] (key: the
 *   feature's identifier; plain strings are read as both)
 * @returns {{id, score, reason, bonus: {brave, tacticalFloor, attack, ac}}[]} best first
 */
export function rankLeaders(entries) {
  const out = [];
  for ( const e of entries ) {
    const best = Math.max(e.skills?.persuasion ?? -99, e.skills?.intimidation ?? -99);
    if ( best <= -99 ) continue;
    let score = best - (proficiency(e.level) + 2);
    const reasons = [t("Lead.Best", { n: best === 0 ? "+0" : signedNumber(best) })];
    const commanding = (e.features ?? []).map(f => (typeof f === "string" ? { key: f, name: f } : f))
      .filter(f => LEADER_FEATURE.test(f.key ?? "") || LEADER_FEATURE.test(f.name ?? ""));
    if ( commanding.length ) {
      score += 3;
      reasons.push(listItems(commanding.slice(0, 2).map(f => f.name)));
    }
    out.push({ id: e.id, score, reason: reasons.join("; "), bonus: leaderBonus(score) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Map a leadership score to side-wide effects (5e has no AC or attack auras worth guessing at). */
export function leaderBonus(score) {
  if ( score >= 6 ) return { brave: 20, tacticalFloor: 60, attack: 0, ac: 0 };
  if ( score >= 3 ) return { brave: 15, tacticalFloor: 50, attack: 0, ac: 0 };
  if ( score >= 0 ) return { brave: 10, tacticalFloor: 40, attack: 0, ac: 0 };
  return { brave: 5, tacticalFloor: 0, attack: 0, ac: 0 };
}
