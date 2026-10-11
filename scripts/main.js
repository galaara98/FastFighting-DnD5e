/**
 * FastFighting D&D 5e: teaches FastFighting Core how Dungeons & Dragons Fifth Edition works.
 * Registers the dnd5e adapter (actor data, rules, personality defaults, leadership, Make it So) through the
 * core's public API.
 */
import { Dnd5eAdapter } from "./adapter.js";

export const MODULE_ID = "fast-fighting-dnd5e";

/** The core API this helper is written against (older cores have no api.version: that is 1). */
const NEEDS_API = 7;

Hooks.once("fastFighting.init", api => {
  // module.json limits this module to dnd5e worlds; this guard covers anything that slips past.
  if ( game.system.id !== "dnd5e" ) {
    console.warn(`${MODULE_ID} | not a D&D Fifth Edition world (${game.system.id}); FastFighting D&D 5e stays inactive.`);
    return;
  }
  if ( (api.version ?? 1) < NEEDS_API ) {
    console.error(`${MODULE_ID} | FastFighting Core is too old for this version of FastFighting D&D 5e; update it.`);
    ui.notifications?.error(game.i18n.localize("FFDND5E.CoreTooOld"), { permanent: true });
    return;
  }
  api.registerAdapter("dnd5e", Dnd5eAdapter, { priority: 10, source: MODULE_ID });
});

Hooks.once("ready", () => {
  if ( !game.modules.get("fast-fighting")?.active && game.user.isGM ) {
    ui.notifications.warn(game.i18n.localize("FFDND5E.NeedsCore"));
  }
});
