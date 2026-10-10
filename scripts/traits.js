/** Too simple to reason with: barely-thinking undead, constructs, oozes and plants. Beasts are animals, not mindless. */
export function isMindless(int, creature) {
  return (int ?? 10) <= 3 && !["beast", "monstrosity", "dragon"].includes(creature);
}

/**
 * D&D 5e personality defaults from an actor's data. Pure: takes plain numbers, unit-testable.
 *
 * @param {object} d
 * @param {string} d.type        "character" | "npc"
 * @param {string} d.creature    Creature type: humanoid, beast, undead, construct, fiend ...
 * @param {number} d.int         Intelligence score
 * @param {number} d.wis         Wisdom modifier
 * @param {number} d.level       Level or challenge rating
 * @param {number} d.wisSave     Wisdom save bonus
 * @param {boolean} d.hasMaster  A familiar, steed or companion
 * @param {string[]} d.features  Feature names (lower case)
 * @returns {{traits, flags, reasons}}
 */
export function deriveDnd5eTraits(d) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const reasons = {};
  const flags = {};
  const features = d.features ?? [];
  const has = name => features.some(f => f.includes(name));
  if ( has("pack tactics") ) flags.packTactics = true;
  if ( has("sneak attack") ) flags.sneakAttack = true;
  // Disengage as a bonus action.
  if ( has("cunning action") || has("nimble escape") ) flags.nimble = true;

  if ( d.type === "character" ) {
    return {
      traits: { tactical: 65, brave: 75, selfish: 25, loyal: 80 },
      flags,
      reasons: { tactical: "Player character", brave: "Player character", selfish: "Player character", loyal: "Player character" }
    };
  }

  const intMod = Math.floor(((d.int ?? 10) - 10) / 2);
  const mindless = isMindless(d.int, d.creature);
  let tactical = clamp(35 + intMod * 8 + (d.wis ?? 0) * 2, 5, 95);
  reasons.tactical = `Intelligence ${d.int ?? 10}`;
  if ( d.creature === "beast" ) {
    tactical = clamp(15 + (d.wis ?? 0) * 3, 5, 35);
    reasons.tactical = "Beast";
  }
  if ( mindless ) {
    tactical = Math.min(tactical, 10);
    reasons.tactical = "Barely thinks";
  }
  if ( flags.packTactics ) {
    tactical = Math.max(tactical, 25);
    reasons.tactical += "; hunts as a pack";
  }

  const typicalSave = 3 + Math.floor((d.level ?? 0) / 4);
  let brave = clamp(50 + ((d.wisSave ?? 0) - typicalSave) * 5, 10, 90);
  reasons.brave = "Wisdom save";
  if ( ["undead", "construct"].includes(d.creature) && mindless ) {
    brave = 100;
    flags.fearless = true;
    reasons.brave = "Mindless: never flees";
  } else if ( d.creature === "construct" ) {
    brave = 95;
    reasons.brave = "Construct";
  } else if ( d.creature === "beast" ) {
    brave = Math.min(brave, 45);
    reasons.brave = "Beast: flees when hurt";
  }
  if ( mindless ) flags.mindless = true;

  let selfish = 50;
  reasons.selfish = "Typical";
  if ( d.creature === "fiend" ) { selfish = 75; reasons.selfish = "Fiend"; }
  else if ( d.creature === "celestial" ) { selfish = 20; reasons.selfish = "Celestial"; }
  else if ( d.creature === "beast" ) { selfish = 55; reasons.selfish = "Beast"; }

  let loyal = 50;
  reasons.loyal = "Typical";
  if ( d.hasMaster ) { loyal = 85; reasons.loyal = "Serves a master"; }
  else if ( ["construct", "undead"].includes(d.creature) && mindless ) { loyal = 90; reasons.loyal = "Bound to obey"; }

  return { traits: { tactical, brave, selfish, loyal }, flags, reasons };
}
