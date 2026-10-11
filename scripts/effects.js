/**
 * Reading dnd5e spell and feature effects into the engine's buffs and debuffs. Pure, unit-tested: no Foundry globals.
 *
 * What a 5e effect does is mostly in its changes (Bless: +1d4 to attack rolls and saves; Shield of Faith: +2 AC;
 * Slow: -2 AC and half speed). What isn't (Faerie Fire's advantage, Blur's disadvantage, Haste's extra action) is
 * read from the spell's words. Anything the engine doesn't play out is simply left out.
 *
 * Everything here works from the free SRD alone (the 2014 SRD 5.1 and the 2024 SRD 5.2, whose wordings differ); the
 * Player's Handbook and the Dungeon Master's Guide only add more spells and features to read the same way.
 */

import { describeMods } from "./core.js";

const ADD = 2;
const MULTIPLY = 1;
const ATTACK_BONUS = /^system\.bonuses\.(?:mwak|rwak|msak|rsak)\.attack$/;
const DAMAGE_BONUS = /^system\.(?:bonuses\.(?:mwak|rwak|msak|rsak)\.damage|rolls\.damage\.(?:mwak|rwak|msak|rsak)\.bonus)$/;
const SPEED_BONUS = /^system\.attributes\.movement\.(?:walk|all|bonus|speed)$/;
const UPGRADE = 4;
const OVERRIDE = 5;

/** "1d4", "-1d4", "+2", "- 1d8", "1d4[radiant]": a lone die ({die: 4}, {die: -4}) or a number (dice as their average). */
export function bonusOf(raw) {
  const s = String(raw ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "");
  const dice = /^([+-]?)(\d*)d(\d+)$/i.exec(s);
  if ( dice ) {
    const sign = dice[1] === "-" ? -1 : 1;
    const n = Number(dice[2] || 1);
    const faces = Number(dice[3]);
    return n === 1 ? { die: sign * faces } : { flat: (sign * n * (faces + 1)) / 2 };
  }
  const n = Number(s);
  return s && Number.isFinite(n) ? { flat: n } : null;
}

const average = b => (b?.flat ?? (b?.die ? (Math.sign(b.die) * (Math.abs(b.die) + 1)) / 2 : 0));

/** An effect's changes as engine bonuses and penalties, plus any temporary hit points (Aid's extra maximum). */
export function modsFromChanges(changes) {
  const mods = {};
  let tempHp = 0;
  const iwr = { resist: {}, immune: [] };
  const put = (flatKey, dieKey, b) => {
    if ( !b ) return;
    if ( b.die && dieKey ) mods[dieKey] = b.die;
    else if ( average(b) ) mods[flatKey] = Math.round(average(b));
  };
  for ( const c of changes ?? [] ) {
    const key = String(c?.key ?? "");
    const mode = Number(c?.mode);
    if ( mode === ADD && ATTACK_BONUS.test(key) ) put("attack", "attackDie", bonusOf(c.value));
    else if ( mode === ADD && key === "system.bonuses.abilities.save" ) put("saves", "saveDie", bonusOf(c.value));
    else if ( mode === ADD && DAMAGE_BONUS.test(key) ) put("damage", null, bonusOf(c.value));
    else if ( mode === ADD && key === "system.attributes.ac.bonus" ) put("ac", null, bonusOf(c.value));
    else if ( mode === ADD && SPEED_BONUS.test(key) ) put("speed", null, bonusOf(c.value));
    else if ( mode === MULTIPLY && key === "system.attributes.movement.multiplier" ) {
      const m = Number(c.value);
      if ( Number.isFinite(m) && m !== 1 ) mods.speed = Math.round((m - 1) * 30);
    } else if ( mode === ADD && /^system\.attributes\.hp\.(?:tempmax|temp)$/.test(key) ) tempHp = Math.max(tempHp, Number(c.value) || 0);
    // Rage, Stoneskin: resistance (a 5e resistance halves); immunity.
    else if ( mode === ADD && key === "system.traits.dr.value" && c.value ) iwr.resist[String(c.value)] = 1;
    else if ( mode === ADD && key === "system.traits.di.value" && c.value ) iwr.immune.push(String(c.value));
    // Magic Weapon: a +1 (or better) weapon, to attack and damage.
    else if ( (mode === UPGRADE || mode === ADD || mode === OVERRIDE) && key === "system.magicalBonus" ) {
      const v = Number(c.value) || 0;
      if ( v ) { mods.attack = Math.max(mods.attack ?? 0, v); mods.damage = Math.max(mods.damage ?? 0, v); }
    }
  }
  return { mods, tempHp, iwr: Object.keys(iwr.resist).length || iwr.immune.length ? iwr : null };
}

/** Words that say what the changes can't. Each: [pattern, what it adds]. */
const WORDED = [
  // Faerie Fire: "Attack rolls against an affected creature or object have Advantage"
  [/attack rolls against (?:an |the |that |each )?(?:affected )?(?:creature|target|it)\b[^.]*?\bhave advantage/i, { mods: { defAdv: 1 } }],
  // Blur: "any creature has Disadvantage on attack rolls against you"
  [/disadvantage on attack rolls against (?:you|it|the target|that creature)/i, { mods: { defAdv: -1 } }],
  // Vicious Mockery: "Disadvantage on the next attack roll it makes"
  [/disadvantage on the next attack roll/i, { mods: { adv: -1 }, rounds: 1 }],
  // Haste: "it gains an additional action on each of its turns"
  [/gains? an additional action/i, { mods: { actions: 1 } }],
  // Slow: "it can take either an action or a Bonus Action, not both"
  [/either an action or a bonus action, not both/i, { conditions: { slowed: 1 } }],
  // Command (Halt, the gentlest of its five words): "takes no action"
  [/takes no action/i, { conditions: { incapacitated: 1 }, rounds: 1 }],
  // An attacker taking 1d4 off its attack rolls against the warded (about two points of AC)
  [/attacker subtracts 1d4 from the attack roll/i, { mods: { ac: 2 } }],
  // Mirror Image: its duplicates take the hits more often than not
  [/illusory duplicates of yourself/i, { mods: { defAdv: -1 } }],
  // A duel it's compelled into: disadvantage against anyone but the caster
  [/disadvantage on attack rolls against creatures other than you/i, { mods: { adv: -1 } }],
  // Bardic Inspiration: a die to add to one roll, once (about a point on its rolls while it lasts)
  [/add the number rolled to (?:the d20|one ability check, attack roll, or saving throw)/i, { mods: { attack: 1, saves: 1 } }],
  // Confusion: it mostly does nothing useful (a d10 each turn decides)
  [/roll (?:a |1)d10 at the start of each of its turns to determine its behavior|roll (?:from|on) the [\w\s]{1,30}table at the start of each of its turns to determine its behavior/i, { conditions: { incapacitated: 1 } }]
];

/**
 * What a spell's words add: bonuses and conditions the changes don't carry, a save repeated each turn (Hold
 * Person) or when hurt (Dominate Person), a charm that breaks when its caster's side does harm (Charm Person), and a
 * save made with advantage in a fight. `has` says which mods the changes already set (so words never double them).
 */
export function fromWords(text, has = {}) {
  const t = String(text ?? "");
  const out = { mods: {}, conditions: {}, rounds: null };
  for ( const [re, add] of WORDED ) {
    if ( !re.test(t) ) continue;
    for ( const [k, v] of Object.entries(add.mods ?? {}) ) if ( has[k] === undefined ) out.mods[k] = v;
    Object.assign(out.conditions, add.conditions ?? {});
    if ( add.rounds ) out.rounds = add.rounds;
  }
  out.repeatSave = /repeats? the sav|repeat the saving throw|makes? (?:another|a new) [^.]{0,60}saving throw/i.test(t);
  out.endsOnHarm = /(?:if|until) you or (?:any of )?your (?:allies|companions) (?:do anything harmful to|damage|harm)/i.test(t);
  out.saveAdvantage = /(?:with|has) advantage[^.]{0,30} if you or your (?:allies|companions) are fighting/i.test(t)
    || /if you or creatures that are friendly to you are fighting it, it has advantage/i.test(t);
  out.mark = /(?:extra|additional) [^.]{0,40}damage to the target whenever you hit it/i.test(t);
  // Invisibility that ends the moment its bearer attacks is for getting away, not for fighting.
  out.endsOnAttack = /ends early immediately after the target makes an attack roll|spell ends for a target that attacks/i.test(t);
  if ( /(?:before|until) the end of (?:its|your|the target's) next turn|until the start of your next turn/i.test(t) && out.rounds === null ) out.rounds = 1;
  return out;
}

/** A name for how it leaves its target, for the story ("{target} is blessed", "is weakened", "is shielded"). */
export function effectLabel({ statuses = [], names = [], mods = {}, tempHp = 0, conditions = {} } = {}) {
  // An effect named for what it does ("Blessed", "Dominated", "Outlined") says it best; then its conditions.
  const named = names.find(n => /ed$/i.test(String(n).trim().split(/\s+/).pop() ?? ""));
  if ( named ) return String(named).toLowerCase();
  if ( statuses.length ) return statuses.join(", ");
  const worded = Object.keys(conditions).map(k => ({ incapacitated: "halted", slowed: "slowed", controlled: "charmed" }[k])).filter(Boolean);
  if ( worded.length ) return worded.join(", ");
  // Otherwise the core's word for what the bonuses do (the same words in every system).
  return describeMods(mods, { tempHp });
}

/** Rounds from a dnd5e duration {value, units} ("1 minute" = 10 rounds), or null. */
export function durationRounds(duration) {
  const v = Number(duration?.value) || 0;
  const per = { round: 1, turn: 1, minute: 10, hour: 600, day: 14400 }[duration?.units];
  return v > 0 && per ? v * per : null;
}

/** Do these bonuses help whoever has them (a buff) or hurt them (a debuff)? */
export function helps(mods = {}, conditions = {}) {
  if ( Object.keys(conditions).length ) return false;
  let score = 0;
  for ( const [k, v] of Object.entries(mods) ) {
    const n = Array.isArray(v) ? v.reduce((s, x) => s + Math.sign(x), 0) : Math.sign(Number(v) || 0);
    score += k === "defAdv" ? -n : n; // easier to hit is bad for you
  }
  return score > 0;
}
