/**
 * D&D Fifth Edition rules for the FastFighting engine. Pure functions only: no Foundry globals.
 *
 * Turns are an action, a bonus action and a move (Dash trades the action for another move). Attacks crit on a
 * natural 20 and miss on a 1; saves and checks simply meet the DC or don't. Situations give advantage or
 * disadvantage, which cancel each other out. A creature at 0 HP makes death saves; three successes stabilize it,
 * three failures kill it, and taking damage while down counts as a failure (two on a critical).
 */
import { DOWNED_MODELS, STATUS, rollD20, bestReactionStrike, dropCondition, part } from "./core.js";
import { t } from "./words.js";
import { escapeFrom, bondsDC, breakFree, HOLD_COST } from "./holds.js";
import { reachable, insideHolds, insideTurn, spitUp } from "./inside.js";

/** Proficiency bonus for a level or challenge rating. */
export function proficiency(level) {
  return 2 + Math.floor(Math.max(0, (level ?? 0) - 1) / 4);
}

/** Conditions that let attackers strike with advantage. */
const HELPLESS = ["paralyzed", "stunned", "unconscious", "incapacitated", "restrained", "blinded", "petrified"];
/** Cover from the walls (the core's: some of the target hidden, most of it): half cover +2, three-quarters +5. */
const coverBonus = cover => (cover === "some" ? 2 : cover === "most" ? 5 : 0);
/** Conditions that give the creature disadvantage on its own attacks. */
const HAMPERED = ["poisoned", "frightened", "restrained", "blinded", "prone"];

/** What being inside another creature is besides, by the SRD: Blinded and Restrained in a gullet, Restrained in an ooze. */
const INSIDE_MEANS = Object.freeze({ blinded: ["swallowed"], restrained: ["swallowed", "engulfed"] });
const has = (u, key) => (u?.conds?.[key] ?? 0) > 0 || !!INSIDE_MEANS[key]?.some(k => (u?.conds?.[k] ?? 0) > 0);
const exhaustion = u => u?.conds?.exhaustion ?? 0;
/** d20 tests take -2 per level of exhaustion (2024 rules); 0 when fresh. */
const tired = u => (exhaustion(u) ? -2 * exhaustion(u) : 0);

/** An affliction on it, taken hold, that weakens saves of this ability (Contagion's: adapter.js tallied). */
const weakened = (u, type) => (u?.afflictions ?? []).some(a => a.spec?.weakSave === type && a.stage > 0 && !(a.onsetLeft > 0));

/** How badly being on fire bothers a creature: as the core's own burning profile has it. */
const BURNING_BOTHERS = 60;
/** The DC to put out a fire on oneself, under the 2014 rules (the SRD 5.1's alchemist's fire). */
const DOUSE_DC = 10;

/** One try at putting out the fire on itself (rules.remedies): out, and Prone (2024); or a DC 10 Dexterity check (2014). */
function douse(run, u) {
  if ( u.spec?.rulesVersion === "legacy" ) {
    const rules = run.prep.rules;
    const { bonus = 0, advantage = 0 } = rules.modifiers?.check?.({ unit: u }) ?? {};
    const roll = rollD20(rules, run.rng, (Number(u.spec.escapeWork?.dex) || 0) + bonus, DOUSE_DC, { advantage, kind: "check" });
    if ( roll.degree < 2 ) return { success: false };
  } else u.prone = true;
  dropCondition(u, "burning");
  return { success: true };
}

/** Advantage and disadvantage cancel: any of one and none of the other decides. */
function net(adv, dis) {
  if ( adv && !dis ) return 1;
  if ( dis && !adv ) return -1;
  return 0;
}

/** Damage-type imagery for the story (5e's names for the core's families). */
const STORY_TYPES = { lightning: "electricity", thunder: "sonic", necrotic: "void", radiant: "radiant", psychic: "mental" };

export const dnd5eRules = {
  id: "dnd5e",

  /* Turn ------------------------------------------------------------------ */
  mainPool: "action",
  movement: "feet",
  /** An action, a bonus action, your movement, and one spell slot: a turn spends at most one slot on a spell. */
  turn(u) {
    // Slowed (the Slow spell): an action or a bonus action, not both.
    return { action: 1, bonus: has(u, "slowed") ? 0 : 1, move: u.spec.speeds?.walk ?? Math.max(0, ...Object.values(u.spec.speeds ?? { walk: 30 })), slot: 1 };
  },
  /** An action, unless it's a bonus action (Healing Word, an off-hand attack ...); a spell slot too, if it takes one. */
  costOf(action) {
    if ( action.economy === "free" ) return {}; // Reckless Attack, Action Surge: no action at all
    const cost = action.economy === "bonus" ? { bonus: 1 } : { action: 1 };
    if ( /^(?:slots:|pact$)/.test(action.resource ?? "") ) cost.slot = 1;
    return cost;
  },
  basicAction: { action: 1 },
  talkCost: { action: 1 },
  /**
   * A playstyle's taunt: an action. A few words are free, but urging a creature to do something is the Influence action
   * (SRD 5.2).
   */
  tauntCost: { action: 1 },
  firstAidCost: { action: 1 },
  stealCost: { action: 1 },
  /** Stealing in the open: the feint is part of the same action. */
  feintCost: {},
  /**
   * Opportunity attacks: anyone with a melee attack swings once (its reaction) at a foe leaving its reach. Disengage
   * lets you leave safely; rogues (Cunning Action) and goblins (Nimble Escape) do it as a bonus action.
   */
  reactions(u) {
    return has(u, "slowed") ? 0 : 1;
  },
  /**
   * Concentration: one such spell at a time. Taking damage calls for a Constitution save (DC 10 or half the damage,
   * at most 30); being incapacitated ends it.
   */
  concentration: { save: "con", dc: dmg => Math.min(30, Math.max(10, Math.floor(dmg / 2))), breaksOn: ["incapacitated", "paralyzed", "stunned", "unconscious", "petrified"] },
  opportunity(reactor) {
    const c = reactor.conds ?? {};
    if ( c.incapacitated || c.paralyzed || c.stunned || c.unconscious || c.petrified ) return null;
    return bestReactionStrike(reactor);
  },
  disengage(u) {
    return { cost: u.spec.flags?.nimble ? { bonus: 1 } : { action: 1 }, label: t("Disengage") };
  },
  /** A wooden door (AC 15, 18 HP), locked against a DC 15 Strength check or thieves' tools. */
  door: { ac: 15, hp: 18, threshold: 0, forceDC: 15, pickDC: 15 },
  /** Opening a door is a free object interaction; forcing it or picking the lock takes an action. */
  doorCosts: { open: {}, force: { action: 1 }, pick: { action: 1 } },
  /** A damage threshold: a blow below it does nothing at all; one that meets it does it all. */
  doorDamage(door, damage) {
    return damage < (door.threshold ?? 0) ? 0 : damage;
  },
  /** Standing up costs half your movement. */
  standCost(u) {
    return { move: Math.ceil((u.spec.speeds?.walk ?? 30) / 2) };
  },
  /** Every action says how many free hands it needs (adapter.js): one tied up can still use those that need none. */
  handsKnown: true,
  /**
   * A fall (shoved off a ledge: the core's behavior/forced.js): 1d6 bludgeoning for each 10 feet, at most 20d6, and it
   * lands prone if it took any of it (the SRD's, 5.1 and 5.2 alike).
   */
  fallDamage(feet) {
    const dice = Math.min(20, Math.floor((Number(feet) || 0) / 10));
    return dice > 0 ? [part([{ n: dice, faces: 6 }], 0, "bludgeoning")] : [];
  },
  /** Cover is 5e's (half, three-quarters: coverBonus), not the core's. */
  handlesCover: true,

  /**
   * Getting past another creature on the way (the core's behavior/space.js), the SRD 5.2's: through an ally's space, an
   * Incapacitated creature's (or one down), a Tiny creature's, or one two sizes larger or smaller, as Difficult Terrain;
   * round any other. A halfling's Nimbleness (spec.throughLarger) takes it through any creature larger than it too. A
   * move never ends in another's space (the core's, by default).
   */
  passThrough(run, u, o) {
    const size = c => (Number.isFinite(c.spec.size) ? c.spec.size : 2);
    const through = o.side === u.side || o.status !== STATUS.STANDING || !!o.conds?.incapacitated || size(o) === 0 || Math.abs(size(u) - size(o)) >= 2
      || (!!u.spec.throughLarger && size(o) > size(u));
    return through ? "difficult" : "around";
  },
  /** Prone from it only if it hurt (the SRD: a fall that does no damage, nor a resisted one to nothing, leaves it standing). */
  fallProne(t, dealt) {
    return dealt > 0;
  },

  /* Holds ----------------------------------------------------------------- */
  /** Breaking free of a grapple, webs, a net or bonds, and freeing a friend (holds.js): each try an action. */
  escapeFrom,
  bondsDC,
  breakFree,
  escapeCost() {
    return { ...HOLD_COST };
  },
  /** Untying a friend, or pulling a net off one: an action (2024: Utilize). */
  untieCost() {
    return { ...HOLD_COST };
  },

  /* Harm that lasts ------------------------------------------------------- */
  /**
   * The core's own conditions' harm, in 5e's terms (the core's, at the end of the bearer's turn): burning, the SRD
   * 5.2's hazard, 1d4 fire (or what its fire's source says: spec.burns, a 2014 fire elemental's 1d10); corroding, the
   * acid a spell left for the end of its next turn (its caster's spec.lingering, by the name its effect goes by);
   * swallowed or engulfed, what its holder's gullet or body does (spec.inside.harm: a purple worm's 6d6 acid).
   * Undefined: the core's own.
   */
  conditionHarm(key, value, unit, by) {
    if ( key === "burning" ) return by?.spec?.burns ?? [part([{ n: 1, faces: 4 }], 0, "fire")];
    if ( key === "corroding" && by?.spec?.lingering ) {
      const left = (unit.effects ?? []).find(e => e.sourceId === by.id && (Number(e.conditions?.corroding) || 0) > 0 && Object.hasOwn(by.spec.lingering, e.key));
      return left ? by.spec.lingering[left.key] : undefined;
    }
    if ( (key === "swallowed" || key === "engulfed") && by?.spec?.inside?.key === key && by.spec.inside.harm?.length ) return by.spec.inside.harm;
    return undefined;
  },
  /** In a gullet: no action gets it out (inside.js); only being brought up, or its holder's death. */
  holds(run, u) {
    return insideHolds(run, u);
  },
  /** Total Cover between those inside a creature and everything outside it (inside.js). */
  canTarget(run, u, t) {
    return reachable(run, u, t);
  },
  /** Hurt from inside: a gullet may bring up what it holds (inside.js). */
  afterHarm(run, u, amount, rng) {
    return spitUp(run, u, amount, rng);
  },
  /** Inside another creature: its holder's grapple over, and where its holder is (inside.js). */
  startTurn(run, u) {
    return insideTurn(run, u);
  },
  /**
   * Putting out the fire on itself (Burning), an action: the SRD 5.2's, it goes Prone and rolls on the ground; the 2014
   * rules', a DC 10 Dexterity check (the SRD 5.1's alchemist's fire). Offered before the core's own way and as
   * bothersome as it (its burning profile's), so it's the one tried; a friend beside it beats the flames out, the core's.
   */
  remedies(run, u) {
    if ( !((Number(u.conds?.burning) || 0) > 0) || u.coreConds?.owned?.includes("burning") ) return [];
    return [{ key: "dnd5e:burning", condition: "burning", type: "fire", label: null, annoyance: BURNING_BOTHERS, cost: { ...HOLD_COST }, try: douse }];
  },

  /* Rolls ----------------------------------------------------------------- */
  degreeOfSuccess(natural, total, dc, kind = "check") {
    if ( kind === "attack" ) {
      if ( natural === 20 ) return 3;
      if ( natural === 1 ) return 1;
    }
    return total >= dc ? 2 : 1;
  },
  roll(rng, modifier, dc, options = {}) {
    return rollD20(this, rng, modifier, dc, options);
  },
  attackPenalty() {
    return 0;
  },

  /**
   * An affliction (a tallied one, Contagion's: adapter.js) takes hold when what carries it lands: the spell's own save
   * or attack already decided it, so the core's roll on exposure doesn't. Its later saves are counted (the core's
   * tally); were one staged, a failure would worsen it and a success ease it.
   */
  afflictionStep(degree, phase) {
    if ( phase === "exposure" ) return 1;
    return degree <= 1 ? 1 : -1;
  },

  /** Half damage on a successful save ("basic"), or none when the effect says so. */
  saveMultiplier(degree, save) {
    if ( degree >= 2 ) return save?.basic === false ? 0 : 0.5;
    return 1;
  },

  /** A critical hit rolls the damage dice twice; modifiers aren't doubled. */
  critical(parts) {
    return (parts ?? []).map(p => ({ ...p, dice: p.dice.map(d => ({ ...d, n: d.n * 2 })) }));
  },

  /** Immunity ignores, resistance halves (rounded down), vulnerability doubles. */
  applyIwr(iwr, byType) {
    let total = 0;
    for ( const [type, amount] of Object.entries(byType) ) {
      if ( amount <= 0 || iwr?.immune?.includes(type) ) continue;
      let value = amount;
      if ( iwr?.resist?.[type] ) value = Math.floor(value / 2);
      if ( iwr?.weak?.[type] ) value *= 2;
      total += value;
    }
    return total;
  },

  /* Dying ----------------------------------------------------------------- */
  /** Death saves already on the sheet when the fight starts. */
  initUnit(u) {
    u.deathFailures = u.spec.deathSaves?.failure ?? 0;
    u.deathSuccesses = u.spec.deathSaves?.success ?? 0;
  },

  /** At 0 HP: unconscious and making death saves; instant death if the overflow reaches the creature's max HP. */
  onDropped(c, { crit = false, model = DOWNED_MODELS.SIMULATE, overflow = 0 } = {}) {
    if ( model === DOWNED_MODELS.DEAD || c.spec.diesAtZero || overflow >= c.maxHp ) {
      c.status = STATUS.DEAD;
      return c.status;
    }
    if ( model === DOWNED_MODELS.OUT ) {
      c.status = STATUS.DOWN;
      c.stable = true;
      return c.status;
    }
    if ( c.status === STATUS.DOWN ) {
      // Hit while down: a failed death save, two on a critical; any damage ends stability.
      c.deathFailures = (c.deathFailures ?? 0) + (crit ? 2 : 1);
      c.stable = false;
    } else {
      c.status = STATUS.DOWN;
      c.stable = false;
      c.deathFailures = c.deathFailures ?? 0;
      c.deathSuccesses = 0;
    }
    c.prone = true;
    c.dying = c.deathFailures;
    if ( c.deathFailures >= 3 ) c.status = STATUS.DEAD;
    return c.status;
  },

  /**
   * Relentless Endurance (spec.holdOn with a pool, adapter.js), which the core asks for as a save under its name: no
   * roll to make, only its use to spend, while it has one; and nothing when the blow kills it outright (what's left of
   * the damage past 0 at least its hit point maximum, as onDropped has it).
   */
  adjustRoll(run, u, roll, { kind, label } = {}) {
    const h = u?.spec?.holdOn;
    if ( kind !== "save" || !h?.pool || label !== h.label ) return roll;
    if ( -(u.hp ?? 0) >= (u.maxHp ?? 0) || !((u.resources?.[h.pool] ?? 0) > 0) ) return { ...roll, degree: 1 };
    u.resources[h.pool] -= 1;
    return roll;
  },

  /** Healing at 0 HP: conscious again (still prone), death saves reset. */
  onHealed(c, amount) {
    const wasDown = c.status === STATUS.DOWN;
    c.hp = Math.min(c.maxHp, c.hp + amount);
    if ( wasDown && c.hp > 0 ) {
      c.status = STATUS.STANDING;
      c.deathFailures = 0;
      c.deathSuccesses = 0;
      c.dying = 0;
      c.stable = false;
      c.prone = true;
    }
  },

  /** A death saving throw at the start of the turn: DC 10; a 20 brings you back with 1 HP, a 1 counts twice. */
  recoveryCheck(c, rng) {
    if ( c.status !== STATUS.DOWN || c.stable ) return null;
    const natural = rng.d20();
    if ( natural === 20 ) {
      c.hp = 1;
      c.status = STATUS.STANDING;
      c.deathFailures = 0;
      c.deathSuccesses = 0;
      c.dying = 0;
      return t("Death.Twenty");
    }
    if ( natural >= 10 ) c.deathSuccesses = (c.deathSuccesses ?? 0) + 1;
    else c.deathFailures = (c.deathFailures ?? 0) + (natural === 1 ? 2 : 1);
    c.dying = c.deathFailures;
    if ( c.deathFailures >= 3 ) {
      c.status = STATUS.DEAD;
      return t("Death.Dies");
    }
    if ( c.deathSuccesses >= 3 ) {
      c.stable = true;
      c.deathSuccesses = 0;
      c.deathFailures = 0;
      c.dying = 0;
      return t("Death.Stable");
    }
    return { text: t(natural >= 10 ? "Death.Success" : "Death.Failure", { s: c.deathSuccesses ?? 0, f: c.deathFailures ?? 0 }), better: natural >= 10 };
  },

  /** Stabilizing a dying creature: a DC 10 Wisdom (Medicine) check. */
  firstAidDC() {
    return 10;
  },
  firstAid(c, degree) {
    if ( degree >= 2 ) {
      c.stable = true;
      c.deathFailures = 0;
      c.deathSuccesses = 0;
      c.dying = 0;
    }
  },

  /** Ongoing damage ends on a save in 5e; without one, give it even odds each turn. */
  persistentFlatCheck(rng) {
    return rng.d20() >= 11;
  },

  /* What's typical, by level or challenge rating --------------------------- */
  typical: {
    ac: level => 12 + proficiency(level),
    save: level => proficiency(level) + 1,
    skill: level => proficiency(level) + 2,
    dc: level => 10 + proficiency(level)
  },

  /* Situations ------------------------------------------------------------ */
  modifiers: {
    /** Attacks against it have advantage: helpless, or prone and the attacker is right there. */
    exposed({ target, action, distance }) {
      if ( HELPLESS.some(k => has(target, k)) ) return true;
      return !!target.prone && !!action?.melee && (distance ?? 5) <= 5;
    },
    /** Cover from the walls (the core's: some of the target hidden, most of it): half cover, +2 to AC and Dexterity saves; three-quarters, +5. */
    defense({ cover } = {}) {
      return coverBonus(cover);
    },
    attack({ attacker, target, action, distance, positioning, alliesAdjacent, attackerEngaged }) {
      let adv = HELPLESS.some(k => has(target, k));
      let dis = HAMPERED.some(k => has(attacker, k)) || !!attacker.prone;
      if ( target.prone ) {
        if ( action?.melee && (distance ?? 5) <= 5 ) adv = true;
        else dis = true;
      }
      if ( attacker.spec.flags?.packTactics && alliesAdjacent >= 1 ) adv = true;
      const ranged = !!action?.range && !action.melee;
      if ( ranged && attackerEngaged ) dis = true;
      if ( ranged && positioning && action.range.increment && distance > action.range.increment ) dis = true; // long range
      return { bonus: tired(attacker), advantage: net(adv, dis) };
    },
    save({ unit, type, cover }) {
      // Paralyzed, stunned or unconscious creatures automatically fail Strength and Dexterity saves.
      const helpless = ["paralyzed", "stunned", "unconscious", "incapacitated", "petrified"].some(k => has(unit, k));
      if ( helpless && (type === "str" || type === "dex") ) return { bonus: -99, advantage: 0 };
      // (Contagion's Poisoned: Disadvantage on the saves of the ability its caster chose, its weakSave.)
      const dis = (type === "dex" && has(unit, "restrained")) || weakened(unit, type);
      return { bonus: tired(unit) + (type === "dex" ? coverBonus(cover) : 0), advantage: dis ? -1 : 0 };
    },
    check({ unit }) {
      const dis = has(unit, "poisoned") || has(unit, "frightened");
      return { bonus: tired(unit), advantage: dis ? -1 : 0 };
    },
    steal() {
      return { bonus: 0, advantage: 0 };
    },
    /** Paralyzed, stunned, unconscious, petrified: no actions at all. */
    actionsLost(u) {
      return ["paralyzed", "stunned", "unconscious", "petrified"].some(k => has(u, k)) ? 99 : 0;
    }
  },

  /** Immune to a control effect when it's immune to every condition the effect imposes. */
  isImmune(target, action) {
    // Too big to shove (or to swallow, or to push with a weapon's mastery: an outcome's own maxSize).
    const big = most => Number.isFinite(most) && Number.isFinite(target.spec.size) && target.spec.size > most;
    if ( big(action.maxSize) ) return true;
    const immune = new Set(target.spec.iwr?.immune ?? []);
    if ( (action.traits ?? []).some(t => immune.has(t)) ) return true;
    const alias = { incapacitated: "unconscious", immobilized: "restrained", controlled: "charmed" };
    // Every outcome it can have on the target (one that simply happens too; a backfire on the user doesn't count). A
    // grab is Grappled.
    const outcomes = [...(action.onSave ?? []), ...(action.onHit ?? []), action.outcome].filter(o => o && !o.self);
    if ( outcomes.length && outcomes.every(o => big(o.maxSize)) ) return true;
    const keys = [...new Set(outcomes.flatMap(o => [...Object.keys(o.conditions ?? {}), ...(o.grab ? ["grappled"] : [])]))];
    return keys.length > 0 && keys.every(k => immune.has(k) || immune.has(alias[k]));
  },

  /** Share of a creature's fighting a condition takes away each round. */
  conditionWeight(key) {
    return { paralyzed: 1, stunned: 1, unconscious: 1, petrified: 1, restrained: 0.4, blinded: 0.35, frightened: 0.25, poisoned: 0.2, charmed: 0.3, slowed: 0.3 }[key];
  },
  /**
   * Knocked prone, as numbers: its own attacks at disadvantage, and those against it (up close) at advantage. Hidden
   * (Invisible, from the Hide action): its attacks at advantage, those against it at disadvantage.
   */
  conditionMods(key) {
    if ( key === "hidden" ) return { adv: 1, defAdv: -1 };
    return key === "prone" ? { adv: -1, defAdv: 1 } : null;
  },
  /**
   * Hiding takes not having a foe beside it: there's no hiding from one who's right there. A swallow that takes a
   * creature it's grappling (grappledOnly: a behir's, 2024's purple worm's) only at one it has in its grip.
   */
  usable(run, u, action, t = null) {
    if ( action?.grappledOnly && t && t.grabbedBy !== u.id ) return false;
    if ( !action?.hide ) return true;
    return ![...(u.adjacent ?? [])].some(id => { const o = run.byId.get(id); return o && o.status === STATUS.STANDING && run.prep.sides[u.side]?.enemies.has(o.side); });
  },
  /** Hidden ends when it attacks. */
  afterRoll(run, u, roll, ctx) {
    if ( ctx?.kind === "attack" && u?.conds?.hidden ) dropCondition(u, "hidden");
  },
  /** Knocking a foe out: any melee attack that drops it can (one who spares the fallen does). */
  pullsBlow(u, action) {
    return !!action?.melee;
  },

  /** Knocked out rather than killed: stable at 0 HP, no death saves to make. */
  knockOut(u) {
    u.deathSuccesses = 0;
    u.deathFailures = 0;
  },

  /** Death saves, for a live battle to write onto the sheet and the planner to show. */
  capture(u) {
    return { deathSuccesses: u.deathSuccesses ?? 0, deathFailures: u.deathFailures ?? 0 };
  },

  storyDamageType(type) {
    return STORY_TYPES[type] ?? type;
  }
};
