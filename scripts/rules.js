/**
 * D&D Fifth Edition rules for the FastFighting engine. Pure functions only: no Foundry globals.
 *
 * Turns are an action, a bonus action and a move (Dash trades the action for another move). Attacks crit on a
 * natural 20 and miss on a 1; saves and checks simply meet the DC or don't. Situations give advantage or
 * disadvantage, which cancel each other out. A creature at 0 HP makes death saves; three successes stabilize it,
 * three failures kill it, and taking damage while down counts as a failure (two on a critical).
 */
import { DOWNED_MODELS, STATUS, rollD20, rollCheck, systemRolled, hiddenFrom, bestReactionStrike, dropCondition, part, areEnemies } from "./core.js";
import { t, conditionName } from "./words.js";
import { escapeFrom, bondsDC, breakFree, HOLD_COST } from "./holds.js";
import { insideHolds, spitUp, outOfCorpse } from "./inside.js";

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

/**
 * How badly the frightened want to keep away from whatever frightens them (the core's desire levels: driven), the rule
 * being that they can't come any closer: enough not to go for it while there's anything else to do.
 */
const FRIGHTENED_AVOID = 60;

/** How badly being on fire bothers a creature: as the core's own burning profile has it. */
const BURNING_BOTHERS = 60;
/** The DC to put out a fire on oneself, under the 2014 rules (the SRD 5.1's alchemist's fire). */
const DOUSE_DC = 10;

/**
 * One try at putting out the fire on itself (rules.remedies): out, and Prone (2024); or a DC 10 Dexterity check (2014),
 * in a live battle dnd5e's own (systemRolled, purpose "douse": a Dexterity check), else the engine's d20, shown in the
 * chat as a table roll (the core's rollCheck).
 */
function douse(run, u) {
  if ( u.spec?.rulesVersion === "legacy" ) {
    const rules = run.prep.rules;
    const { bonus = 0, advantage = 0 } = rules.modifiers?.check?.({ unit: u }) ?? {};
    const label = conditionName("burning");
    const rolled = systemRolled(run, u, "check", { dc: DOUSE_DC, purpose: "douse", skill: "dex", label, advantage });
    const roll = rollCheck(rules, run.rng, (Number(u.spec.escapeWork?.dex) || 0) + bonus, DOUSE_DC, { advantage, kind: "check", by: u, rolled, label, stat: "dex" });
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
/** The damage types a trait's bypasses let through (dnd5e's physical ones). */
const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing"]);

const STORY_TYPES = { lightning: "electricity", thunder: "sonic", necrotic: "void", radiant: "radiant", psychic: "mental" };

/** The SRD's typical Difficulty Classes (5.1 and 5.2 alike): easy, medium, hard, very hard, nearly impossible. */
const TYPICAL_DC = Object.freeze({ easy: 10, medium: 15, hard: 20, veryHard: 25, nearlyImpossible: 30 });
/** One step harder on that scale. */
const DC_STEP = 5;

/**
 * Surprise as 5e has it (the planner's Follow System): those trying not to be seen as it starts (hidden tokens) each
 * roll Stealth, and anyone against them that notices none of them (its passive Perception, 10 + its Perception, under
 * every one's roll) is surprised. The 2014 rules: it loses its first turn, and can't react until it's gone by; the 2024
 * rules: it rolls initiative at a disadvantage. No surprise round either way.
 */
function surprise(run) {
  const hiders = run.units.filter(u => u.spec.hidden);
  if ( !hiders.length ) return null;
  // (Each one's Stealth: in a live battle a roll the table sees, the GMs' while it's unseen; against the best passive
  // Perception it must beat.)
  const stealth = new Map(hiders.map(h => {
    const mod = Number(h.spec.initiative?.stealth) || 0;
    const dc = Math.max(0, ...run.units.filter(o => o !== h && areEnemies(run, h, o)).map(o => 11 + (Number(o.spec.perception) || 0)));
    const at = run.rng.mark?.();
    const natural = run.rng.die(20);
    if ( at !== undefined ) run.rng.record(at, { by: h, kind: "check", what: "stealth", stat: "ste", mod, total: natural + mod, natural, dc });
    return [h, natural + mod];
  }));
  const caught = run.units.filter(o => {
    const against = hiders.filter(h => h !== o && areEnemies(run, h, o));
    return against.length && against.every(h => 10 + (Number(o.spec.perception) || 0) < stealth.get(h));
  });
  const legacy = o => o.spec?.rulesVersion === "legacy";
  return { by: [...new Set(hiders.map(h => h.side))], surprised: caught.filter(legacy).map(o => o.id), disadvantage: caught.filter(o => !legacy(o)).map(o => o.id) };
}

export const dnd5eRules = {
  surprise,
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
   * round any other. A halfling's Nimbleness (spec.throughLarger) takes it through any creature larger than it too, and
   * a swarm (spec.swarm) through anyone, and anyone through it. A move never ends in another's space but a swarm's (or a
   * swarm's in another's: endIn).
   */
  passThrough(run, u, o) {
    const size = c => (Number.isFinite(c.spec.size) ? c.spec.size : 2);
    const through = o.side === u.side || o.status !== STATUS.STANDING || !!o.conds?.incapacitated || size(o) === 0 || Math.abs(size(u) - size(o)) >= 2
      || (!!u.spec.throughLarger && size(o) > size(u)) || !!u.spec.swarm || !!o.spec.swarm;
    return through ? "difficult" : "around";
  },
  /** A swarm may end its move in another creature's space, and another in its (the SRD's swarms). */
  endIn(run, u, o) {
    return !!u?.spec?.swarm || !!o?.spec?.swarm;
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
   * The core's own conditions' harm, in 5e's terms: burning, the SRD 5.2's hazard, 1d4 fire (or what its fire's source
   * says: spec.burns, a 2014 fire elemental's 1d10); corroding, the acid a spell left for the end of its next turn (its
   * caster's spec.lingering, by the name its effect goes by); swallowed or engulfed, what its holder's gullet or body
   * does (spec.inside.harm: a purple worm's 6d6 acid). Undefined: the core's own.
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
  /**
   * What of the core's own conditions is 5e's: Burning's fire at the start of each of its turns (the SRD 5.2's), and a
   * gullet's or an ooze's harm there too (the SRD's: at the start of its holder's turns); inside another creature, no
   * penalty of the core's on top of 5e's own Blinded and Restrained (rules.js has); corroding, a spell's acid left for
   * later, isn't scraped off.
   */
  conditionProfile(key) {
    if ( key === "burning" ) return { harmAt: "start" };
    if ( key === "swallowed" || key === "engulfed" ) return { harmAt: "start", mods: null };
    if ( key === "corroding" ) return { remedy: null };
    return null;
  },
  /** In a gullet: no action gets it out (inside.js); only being brought up, or its holder's death. */
  holds(run, u) {
    return insideHolds(run, u);
  },
  /** Hurt from inside: a gullet may bring up what it holds (inside.js). */
  afterHarm(run, u, amount, rng, ctx = {}) {
    return spitUp(run, u, amount, rng, ctx.by ?? null);
  },
  /** Let go as its holder dies: out of a gullet Prone (inside.js). */
  letGo(run, u, key) {
    outOfCorpse(run, u, key);
  },
  /**
   * Putting out the fire on itself (Burning), an action: the SRD 5.2's, it goes Prone and rolls on the ground; the 2014
   * rules', a DC 10 Dexterity check (the SRD 5.1's alchemist's fire). In place of the core's own way, and as bothersome
   * as it (its burning profile's); a friend beside it beats the flames out, the core's.
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

  /** Half damage on a successful save ("basic"), or none when the effect says so. */
  saveMultiplier(degree, save) {
    if ( degree >= 2 ) return save?.basic === false ? 0 : 0.5;
    return 1;
  },

  /** A critical hit rolls the damage dice twice; modifiers aren't doubled. */
  critical(parts) {
    return (parts ?? []).map(p => ({ ...p, dice: p.dice.map(d => ({ ...d, n: d.n * 2 })) }));
  },

  /**
   * Immunities, resistances and vulnerabilities as dnd5e applies them (Actor5e#calculateDamage): so much off each type
   * first (iwr.reduce: a damage modification), then none of it, half (rounded down) or double. Physical damage gets
   * through a trait whose bypasses (iwr.bypass) name what deals it ("from nonmagical attacks that aren't silvered"):
   * "mgc" magical damage (a spell's, a magic weapon's), "ada" and "sil" an adamantine or silvered weapon's (ctx: the
   * core's iwrContext, its materials the item's own properties).
   */
  applyIwr(iwr, byType, target = null, ctx = {}) {
    const struck = new Set(ctx?.materials ?? []);
    if ( ctx?.magical ) struck.add("mgc");
    const through = kind => (iwr?.bypass?.[kind] ?? []).some(p => struck.has(p));
    let total = 0;
    for ( const [type, amount] of Object.entries(byType) ) {
      if ( amount <= 0 ) continue;
      const counts = kind => !(PHYSICAL.has(type) && through(kind));
      if ( iwr?.immune?.includes(type) && counts("immune") ) continue;
      let value = Math.max(0, amount + (counts("reduce") ? Number(iwr?.reduce?.[type]) || 0 : 0));
      if ( iwr?.resist?.[type] && counts("resist") ) value = Math.floor(value / 2);
      if ( iwr?.weak?.[type] && counts("weak") ) value *= 2;
      total += value;
    }
    return total;
  },

  /** A critical hit on one in adamantine armor is a normal hit (spec.critImmune). */
  critImmune(target) {
    return !!target?.spec?.critImmune;
  },

  /* Dying ----------------------------------------------------------------- */
  /** Death saves already on the sheet when the fight starts. */
  initUnit(u) {
    u.deathFailures = u.spec.deathSaves?.failure ?? 0;
    u.deathSuccesses = u.spec.deathSaves?.success ?? 0;
  },

  /**
   * Death saves as the sheet has them now, in a live battle (the core's syncUnit, API 24: the adapter's readLiveState's
   * `deathSaves`): a player may roll one at the table between FastFighting's turns.
   */
  syncUnit(u, state) {
    const saves = state?.deathSaves;
    if ( !saves ) return;
    if ( Number.isFinite(saves.success) ) u.deathSuccesses = saves.success;
    if ( Number.isFinite(saves.failure) ) u.dying = u.deathFailures = saves.failure;
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

  /**
   * A death saving throw at the start of the turn: DC 10; a 20 brings you back with 1 HP, a 1 counts twice. In a live
   * battle a save the table sees (the core's table rolls).
   */
  recoveryCheck(c, rng) {
    if ( c.status !== STATUS.DOWN || c.stable ) return null;
    const at = rng.mark?.();
    const natural = rng.d20();
    if ( at !== undefined ) rng.record(at, { by: c, kind: "save", what: "recovery", total: natural, natural, dc: 10, degree: natural === 20 ? 3 : natural >= 10 ? 2 : natural === 1 ? 0 : 1 });
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

  /**
   * A player's death save, rolled at the table (the core's API 23): told from its card, which says how it went
   * (read-turn.js deathSaveOf), never from the sheet alone. The tally the sheet keeps is successes and failures apart,
   * so a success changes nothing the core reads (its dying value is the failures).
   */
  recoveryRead() {
    return null;
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

  /** Ongoing damage ends on a save in 5e; without one, give it even odds each turn (in a live battle, a roll the table sees). */
  persistentFlatCheck(rng, { unit = null } = {}) {
    const at = rng.mark?.();
    const natural = rng.d20();
    if ( at !== undefined ) rng.record(at, { by: unit, kind: "flat", what: "persistentEnd", total: natural, natural, dc: 11, degree: natural >= 11 ? 2 : 1 });
    return natural >= 11;
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
    /**
     * Unseen (hidden: the Hide action, or dnd5e's Hiding; 2024's Invisible while hidden), the SRD 5.1's and 5.2's alike:
     * its attacks have advantage, and attacks at it disadvantage. Its attack gives it away once rolled (afterRoll).
     */
    attack({ attacker, target, action, distance, positioning, alliesAdjacent, attackerEngaged }) {
      // (Hidden from the one it's at: unseen by it, unless that one found it with a Search since: the core's hiddenFrom.)
      let adv = HELPLESS.some(k => has(target, k)) || hiddenFrom(target, attacker);
      let dis = HAMPERED.some(k => has(attacker, k)) || !!attacker.prone || hiddenFrom(attacker, target);
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

  /**
   * What 5e's fear makes a creature want while it lasts (the core's conditionWishes; Frightened is on or off, so the core
   * builds how bad it has got itself): it can't willingly move any closer to whatever frightens it (the SRD 5.1's and
   * 5.2's alike), so it keeps away from it, the same however bold it is. Anything else, the core's.
   */
  conditionWishes(run, u, { key, by }) {
    if ( key !== "frightened" ) return null;
    return by ? [{ kind: "avoid", targetId: by.id, level: FRIGHTENED_AVOID }] : [];
  },

  /** Share of a creature's fighting a condition takes away each round. */
  conditionWeight(key) {
    // (Inside another creature: Blinded and Restrained in a gullet, Restrained in an ooze.)
    return { paralyzed: 1, stunned: 1, unconscious: 1, petrified: 1, restrained: 0.4, blinded: 0.35, frightened: 0.25, poisoned: 0.2, charmed: 0.3, slowed: 0.3, swallowed: 0.55, engulfed: 0.4 }[key];
  },
  /**
   * Knocked prone, as numbers: its own attacks at disadvantage, and those against it (up close) at advantage. Hidden
   * (Invisible, from the Hide action): its attacks at advantage, those against it at disadvantage. (For weighing
   * them; the rolls are modifiers.attack's.)
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
  /** Hidden ends when it attacks: after the roll, so only its first attack has advantage (modifiers.attack). */
  afterRoll(run, u, roll, ctx) {
    if ( ctx?.kind === "attack" && u?.conds?.hidden ) dropCondition(u, "hidden");
  },
  /**
   * Knocking a foe out: any melee attack that drops it can (one who spares the fallen does), the SRD 5.1's and 5.2's
   * alike, at no cost to the roll (no pullPenalty).
   */
  pullsBlow(u, action) {
    return !!action?.melee;
  },

  /**
   * Ready (core API 33), the SRD 5.1's and 5.2's: an action to ready an action for a trigger (a foe coming within its
   * reach), taken with its reaction; an Attack readied is a single attack (no Extra Attack off its own turn). Delay
   * isn't in either SRD (the 2024 rules suggest Ready instead): only as the GM's homebrew (dnd5eRulesWith).
   */
  ready: Object.freeze({ cost: Object.freeze({ action: 1 }), most: 1 }),

  /**
   * A minion its master commands (core API 32; spec.flags.command, adapter.js): the creatures Animate Dead or Create
   * Undead made, one bonus action on the master's turn for all those of one spell (API 35's `once`); they do nothing
   * else (the SRD 5.1: only defend themselves; the SRD 5.2: Dodge, and move only to avoid harm). Any other acts on its
   * own: a familiar, a steed, a summoned creature obeying words that cost no action.
   */
  minionCommand(u) {
    return u?.spec?.flags?.command ?? null;
  },

  /**
   * Hearing a fight, or only talk (core API 32), on the SRD's typical DCs: the din of a fight easy (10), raised voices
   * medium (15); a step harder past 30 feet, two past 60, three past 120, and one more for each wall between; talk
   * doesn't carry through a wall, and nothing past nearly impossible (30) is heard. A Wisdom (Perception) check.
   */
  hearDC({ feet, walls = 0, talk = false }) {
    if ( talk && walls > 0 ) return null;
    const far = feet <= 30 ? 0 : feet <= 60 ? 1 : feet <= 120 ? 2 : 3;
    const dc = (talk ? TYPICAL_DC.medium : TYPICAL_DC.easy) + (far + walls) * DC_STEP;
    return dc > TYPICAL_DC.nearlyImpossible ? null : dc;
  },

  /**
   * Knocked out rather than killed: stable at 0 HP, no death saves to make; under the 2024 rules at 1 HP and Unconscious
   * instead (the SRD 5.2's Knocking Out a Creature: commit.js writes it so), out of the fight either way.
   */
  knockOut(u) {
    u.deathSuccesses = 0;
    u.deathFailures = 0;
  },

  /** Death saves, and a knock-out, for a live battle to write onto the sheet and the planner to show. */
  capture(u) {
    return { deathSuccesses: u.deathSuccesses ?? 0, deathFailures: u.deathFailures ?? 0, ...(u.knockedOut ? { knockedOut: true } : {}) };
  },

  storyDamageType(type) {
    return STORY_TYPES[type] ?? type;
  }
};

/** The homebrew Delay (the GM's setting, main.js): a creature may Delay, back at the end of the round (core API 35). */
const HOMEBREW_DELAY = Object.freeze({ toEnd: true });
const withDelay = Object.freeze({ ...dnd5eRules, delay: HOMEBREW_DELAY });

/**
 * The rules as this world plays them (and the planner's background workers, adapter.js workerRules: `data` the
 * settings): with the homebrew Delay where the GM has it on, a creature that would waste its turn delays and comes
 * back at the round's end, its initiative last from then on; reactions as usual while it waits.
 * @param {{homebrewDelay?: boolean}} [data]
 */
export function dnd5eRulesWith(data = null) {
  return data?.homebrewDelay ? withDelay : dnd5eRules;
}
