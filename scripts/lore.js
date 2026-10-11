/**
 * The Lore-Collector's payoff for sizing a foe up in 5e: how much likelier its next rolls are to succeed, a
 * world setting from 1.25× to 2.5×. The default: Study takes the whole turn and works only a little over half the time, so the payoff has to be large to be worth it.
 */

export const LORE_BOOST = Object.freeze({ min: 1.25, max: 2.5, step: 0.05, default: 2.5 });
const MODULE_ID = "fast-fighting-dnd5e";

/** Register the setting (on init). */
export function registerLoreBoost() {
  game.settings.register(MODULE_ID, "loreBoost", {
    name: "FFDND5E.Settings.loreBoost.Name",
    hint: "FFDND5E.Settings.loreBoost.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: LORE_BOOST.min, max: LORE_BOOST.max, step: LORE_BOOST.step },
    default: LORE_BOOST.default
  });
}

/** The world's setting, within its bounds (the default if there's none to read). */
export function loreBoost() {
  let v = LORE_BOOST.default;
  try {
    v = Number(game.settings.get(MODULE_ID, "loreBoost"));
  } catch ( err ) {
    return LORE_BOOST.default;
  }
  return Number.isFinite(v) && v > 0 ? Math.min(LORE_BOOST.max, Math.max(LORE_BOOST.min, v)) : LORE_BOOST.default;
}
