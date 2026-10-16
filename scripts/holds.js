/**
 * Breaking free in 5e, for the core's holds (its behavior/holds.js): what it takes to get out of a grapple, out of the
 * webs, grasping plants or net that restrain a creature, or out of the bonds FastFighting ties it up with; and to free
 * a friend. Pure: no Foundry globals. Everything here is in the free SRD (5.1 and 5.2):
 *  - A grapple: an action, and a Strength (Athletics) or Dexterity (Acrobatics) check, the creature's better. 2024:
 *    against the grapple's escape DC, 8 + the grappler's Strength modifier + its proficiency bonus. 2014: contested by
 *    the grappler's Strength (Athletics), played as a DC of 10 + its Athletics (its passive Athletics: the SRD's way of
 *    turning a check into a number to meet). A creature's own grab has the DC its words give ("grappled (escape DC
 *    13)"). A friend can't break a grapple for it.
 *  - Webs, grasping plants, a net: an action, and the check their words name (escapeWords), against the DC they give
 *    or the spell's save DC; a net, by the one caught in it or anyone beside it.
 *  - Bonds: FastFighting's are whatever was to hand, taken as rope. 2024: a DC 15 Dexterity (Acrobatics) check to get
 *    out of them, or DC 20 Strength (Athletics) to burst them; 2014: a DC 17 Strength check to burst them. A friend
 *    unties them with no roll.
 * Each try is an action, and so is freeing a friend (2024: the Utilize action).
 */
import { STATUS, rollD20, edgeDistance } from "./core.js";

/** Rope, the SRD's: what it takes to get out of it (2024), or to burst it. */
export const ROPE = Object.freeze({ modern: Object.freeze({ escape: 15, burst: 20 }), legacy: Object.freeze({ burst: 17 }) });

/** An action: a try at breaking free, or at freeing a friend. */
export const HOLD_COST = Object.freeze({ action: 1 });

/** dnd5e's keys for the abilities and skills a hold is broken with, and the SRD's words for them. */
const ABILITIES = Object.freeze({ str: "str", strength: "str", dex: "dex", dexterity: "dex" });
const SKILLS = Object.freeze({ ath: "ath", athletics: "ath", acr: "acr", acrobatics: "acr", slt: "slt", "sleight of hand": "slt" });
const SKILL_ABILITY = Object.freeze({ ath: "str", acr: "dex", slt: "dex" });

/** It's out of the hold: what follows a check made to break one ("If it succeeds, it is no longer Restrained"). */
const FREED = /\b(?:free[sd]?|freeing|no longer|escape[sd]?|breaks? free)\b/i;
/** Taking an action to make a check, and what the check is (its words, or a dnd5e enricher, held as ⟦n⟧). */
const ACTION_CHECK = /\b(?:use (?:its|their) action|takes? an action|as an action)\s+to make\s+(?:a |an |its choice of (?:a |an )?)?(.*?)\bcheck\b/i;
/** Someone else may make it, for the one held: "freeing itself or another creature", "the target or a creature within". */
const OTHERS = /\bitself or another creature\b|\bor (?:a|another) creature within\b/i;

/** A dnd5e check enricher's arguments ("ability=str skill=ath dc=@attributes.spell.dc", "ath 10") as checks and a DC. */
function enricherCheck(args, saveDc) {
  let dc = null;
  const abilities = [];
  const skills = [];
  for ( const token of String(args).trim().split(/\s+/) ) {
    const [key, value] = token.includes("=") ? token.split("=", 2) : [null, token];
    for ( const v of String(value ?? "").toLowerCase().split("/") ) {
      if ( key === "dc" ) dc = /^\d+$/.test(v) ? Number(v) : saveDc; // (a formula: the spell's save DC)
      else if ( !key && /^\d+$/.test(v) ) dc = Number(v);
      else if ( (!key || key === "ability") && ABILITIES[v] ) abilities.push(ABILITIES[v]);
      else if ( (!key || key === "skill") && SKILLS[v] ) skills.push(SKILLS[v]);
    }
  }
  const checks = skills.length ? skills.map(skill => ({ ability: abilities[0] ?? SKILL_ABILITY[skill], skill })) : abilities.map(ability => ({ ability, skill: null }));
  return { dc, checks };
}

/** A check in words ("a DC 10 Strength check", "a DC 15 Strength (Athletics) or Dexterity (Acrobatics) check"). */
function wordedCheck(words) {
  const dc = /\bDC (\d+)/i.exec(words);
  const checks = [...words.matchAll(/\b(strength|dexterity)\b(?:\s*\((athletics|acrobatics|sleight of hand)\))?/gi)]
    .map(m => ({ ability: ABILITIES[m[1].toLowerCase()], skill: m[2] ? SKILLS[m[2].toLowerCase()] : null }));
  return { dc: dc ? Number(dc[1]) : null, checks };
}

/**
 * How a hold its words describe is broken (webs, grasping plants, a net): an action and a Strength or Dexterity check,
 * against the DC they give or the spell's save DC (`dc`), and whether someone beside it can do it for the one held. The
 * 2014 SRD's words ("can use its action to make a Strength check against your spell save DC"; "a DC 10 Strength check,
 * freeing itself or another creature within its reach") and the 2024 SRD's, with dnd5e's enrichers ("can take an action
 * to make a [[/check ability=str skill=ath dc=@attributes.spell.dc]] check"; "the target or a creature within 5 feet of
 * it must take an action to make a [[/skill ath 10]] check"). {dc, others: "check" | null, checks: [{ability, skill}]}
 * (skill null: the ability alone), or null.
 */
export function escapeWords(html, { dc: saveDc = null } = {}) {
  const enrichers = [];
  const text = String(html ?? "")
    .replace(/\[\[\/(?:check|skill)\s+([^\]]*)\]\](?:\{[^}]*\})?/gi, (m, args) => `⟦${enrichers.push(args) - 1}⟧`)
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const sentences = text.split(/(?<=[.!?])\s+/);
  for ( const [i, s] of sentences.entries() ) {
    const m = ACTION_CHECK.exec(s);
    if ( !m || !(FREED.test(s) || FREED.test(sentences[i + 1] ?? "")) ) continue;
    const held = /⟦(\d+)⟧/.exec(m[1]);
    const check = held ? enricherCheck(enrichers[Number(held[1])], saveDc) : wordedCheck(m[1]);
    const checks = check.checks.filter(c => c.ability === "str" || c.ability === "dex");
    if ( !checks.length ) continue;
    const dc = check.dc ?? (/spell save DC/i.test(s) ? saveDc : null);
    return { dc: Number.isFinite(dc) ? dc : null, others: OTHERS.test(s) ? "check" : null, checks };
  }
  return null;
}

/**
 * The escape DC a grab's words give: "the target is grappled (escape DC 13)" (2014), "has the Grappled condition
 * (escape DC 13)" (2024); dnd5e's 2024 creatures write the creature's own number there, "(escape DC [[lookup
 * @skills.ath.passive]])", which `lookup(path)` finds. Null when they give none.
 */
export function grabEscapeDC(html, lookup = () => null) {
  const m = /\bescape DC\s*(?:(\d+)|\[\[\s*lookup\s+@([\w.-]+)[^\]]*\]\])/i.exec(String(html ?? ""));
  if ( !m ) return null;
  const n = m[1] ? Number(m[1]) : Number(lookup(m[2]));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* -------------------------------------------- */
/*  The rules' say (rules.js)                   */
/* -------------------------------------------- */

const legacy = u => u?.spec?.rulesVersion === "legacy";

/** How far a creature's grip reaches: its longest melee reach. */
const reachOf = u => Math.max(5, ...(u.spec?.actions ?? []).filter(a => a.melee).map(a => Number(a.reach) || 5));

/**
 * A condition its sheet shows that an action breaks: Grappled, with nothing of the engine's to say who holds it.
 * Whoever has it in its grip is within its reach (engaged with it, or that close on the map), so the hardest grab
 * among the foes there; with none there, a typical DC for its level (10 + its proficiency bonus, about what a
 * grappler of its level has). Restrained can't be told apart from the sheet alone (webs, a net, a constrictor's
 * coils): only what the engine laid says (an effect's escape).
 */
export function escapeFrom(run, u, key) {
  if ( key !== "grabbed" ) return null;
  const enemies = run.prep.sides?.[u.side]?.enemies;
  const holds = o => {
    if ( u.adjacent?.has?.(o.id) ) return true;
    const d = edgeDistance(u, o);
    return d !== null && d <= reachOf(o);
  };
  const dcs = run.units.filter(o => o !== u && o.status === STATUS.STANDING && enemies?.has?.(o.side) && Number.isFinite(o.spec?.escapeDC) && holds(o))
    .map(o => o.spec.escapeDC);
  return { dc: dcs.length ? Math.max(...dcs) : run.prep.rules.typical.dc(u.spec.level ?? 0), others: null };
}

/** How hard FastFighting's bonds are to get out of, taken as rope: 2024, to slip them (DC 15); 2014, to burst them (17). */
export function bondsDC(u) {
  return legacy(u) ? ROPE.legacy.burst : ROPE.modern.escape;
}

/**
 * The checks that break a hold an effect of the engine's is behind (on the one held: `held`, or whoever has it): its
 * escape's, else those of the action that laid it (an effect keeps its action's id), as the adapter read them.
 */
function escapeChecks(run, held, hold) {
  if ( !hold.effectKey ) return null;
  const on = u => (u?.effects ?? []).find(e => e.key === hold.effectKey && (e.sourceId ?? null) === (hold.byId ?? null) && e.escape);
  const e = held ? on(held) : run.units.map(on).find(Boolean);
  if ( e?.escape?.checks?.length ) return e.escape.checks;
  const action = run.byId?.get(hold.byId)?.spec?.actions?.find(a => a.id === hold.effectKey);
  return [action?.outcome, ...(action?.onSave ?? []), ...(action?.effects ?? [])].find(o => o?.escape?.checks?.length)?.escape.checks ?? null;
}

/** Its modifier for a check (spec.escapeWork: the skill's, else the ability's own). */
const checkMod = (work, { ability, skill }) => (skill && Number.isFinite(work[skill]) ? work[skill] : work[ability]);

/**
 * One try at breaking a hold, 5e's way, by `who`: the one held, or a friend beside it freeing `held`. Each way out is a
 * check against a DC; it makes the one it's likeliest to pass, with what its conditions say (poisoned, frightened:
 * disadvantage; exhaustion). A grapple: Athletics or Acrobatics. Bonds: 2024, Acrobatics against 15 or Athletics against
 * 20; 2014, Strength against 17; a friend unties them (null: the core's, no roll). Webs, plants, a net: the check their
 * words name (escapeWords); without it, as a grapple. Null when there's nothing to go on.
 */
export function breakFree(run, who, hold, { freeing = false, held = null } = {}) {
  const work = who?.spec?.escapeWork;
  if ( !work || (freeing && hold.key === "bound") ) return null;
  let ways;
  if ( hold.key === "bound" ) {
    ways = legacy(who) ? [{ mod: work.str, dc: hold.dc ?? ROPE.legacy.burst }]
      : [{ mod: work.acr, dc: hold.dc ?? ROPE.modern.escape }, { mod: work.ath, dc: ROPE.modern.burst }];
  } else {
    const checks = hold.key === "grabbed" ? null : escapeChecks(run, held ?? (freeing ? null : who), hold);
    ways = checks ? checks.map(c => ({ mod: checkMod(work, c), dc: hold.dc })) : [{ mod: work.mod, dc: hold.dc }];
  }
  ways = ways.filter(w => Number.isFinite(w.mod) && Number.isFinite(w.dc));
  if ( !ways.length ) return null;
  const way = ways.reduce((a, b) => (b.mod - b.dc > a.mod - a.dc ? b : a));
  const rules = run.prep.rules;
  const { bonus = 0, advantage = 0 } = rules.modifiers?.check?.({ unit: who }) ?? {};
  const mod = way.mod + bonus;
  const roll = rollD20(rules, run.rng, mod, way.dc, { advantage, kind: "check" });
  return { success: roll.degree >= 2, degree: roll.degree, natural: roll.natural, mod, total: roll.total, dc: way.dc };
}
