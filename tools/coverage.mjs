#!/usr/bin/env node
/**
 * Coverage scan: how much of what dnd5e's creatures and characters can do this helper reads from their words, so the
 * team knows what to teach it next. A developer tool: it isn't part of the module (the release zips only module.json,
 * scripts, languages, reading, hardcoded-toEN.json, README.md and LICENSE).
 *
 *   node tools/coverage.mjs [--out docs/coverage.md] [--private private/coverage.md] [--dnd5e <folder>]
 *                           [--modules <folder>] [--books <ids>] [--foundry <folder>] [--core <folder>]
 *
 *   --out      write the report there (else it goes to stdout)
 *   --private  also write a report naming what each installed book's features are and whether they're read (for the
 *              team's eyes only: keep it out of the repository; private/ is gitignored)
 *   --dnd5e    the dnd5e system as Foundry installs it (default %LOCALAPPDATA%/FoundryVTT/Data/systems/dnd5e; env
 *              DND5E_SYSTEM)
 *   --modules  Foundry's modules folder, for the books (default beside the system: Data/modules)
 *   --books    the books' module ids, comma separated (default the Monster Manual, the Player's Handbook and the
 *              Dungeon Master's Guide: dnd-monster-manual,dnd-players-handbook,dnd-dungeon-masters-guide); each is read
 *              only where it's installed
 *   --foundry  Foundry's app folder, for its classic-level (default %LOCALAPPDATA%/Programs/FoundryVirtualTabletop/
 *              Foundry Virtual Tabletop/resources/app; env FOUNDRY_APP)
 *   --core     FastFighting Core's scripts folder (default ../FastFighting/scripts beside this repository; env
 *              FASTFIGHTING_CORE, as the tests take it)
 *
 * What it reads: every feature (feat item) in the SRD's packs, the SRD 5.1's and the SRD 5.2's (a pack named ...24),
 * standalone and on its creatures and characters, each once (by identifier and words); and the same in each book
 * installed. Through the helper's own pure readers, with reading/en.json's words (reading.js setReading):
 *  - Reactions: a feature with a reaction activity, or words of using a reaction: known by identifier (#reactions'
 *    own, mirrored below in KNOWN_REACTIONS), read from its words (reactionsFromWords), or not read.
 *  - Situational saves: a passive feature whose words give advantage on saving throws (saveVsFromWords).
 *  - Auras: a passive save activity reaching round its bearer (isAuraActivity) whose words say when it goes off
 *    (auraTiming).
 *  - Multiattack: a creature's Multiattack, by its attacks' names (parseMultiattackOptions).
 *  - Regeneration: one whose words say how much (regenerationFrom).
 * The public report names the SRD's features (free content) and only counts the books'; the private one names both.
 * Nothing read is written anywhere else: the words are read to classify, in memory only.
 */
import { register } from "node:module";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..");
const LOCAL = process.env.LOCALAPPDATA ?? "";
const DEFAULT_DND5E = join(LOCAL, "FoundryVTT", "Data", "systems", "dnd5e");
const DEFAULT_FOUNDRY = join(LOCAL, "Programs", "FoundryVirtualTabletop", "Foundry Virtual Tabletop", "resources", "app");
const DEFAULT_BOOKS = "dnd-monster-manual,dnd-players-handbook,dnd-dungeon-masters-guide";

/** The reactions #reactions knows by identifier (keep in step with adapter.js). */
export const KNOWN_REACTIONS = Object.freeze(["shield", "counterspell", "hellish-rebuke", "uncanny-dodge", "deflect-attacks", "deflect-missiles", "parry", "riposte",
  "death-burst", "protection", "fighting-style-protection"]);

/* -------------------------------------------- */
/*  Options                                     */
/* -------------------------------------------- */

export function options(argv) {
  const out = {
    out: null, private: null, dnd5e: process.env.DND5E_SYSTEM ?? DEFAULT_DND5E, modules: null, books: DEFAULT_BOOKS,
    foundry: process.env.FOUNDRY_APP ?? DEFAULT_FOUNDRY, core: process.env.FASTFIGHTING_CORE ?? join(REPO, "..", "FastFighting", "scripts")
  };
  for ( let i = 0; i < argv.length; i++ ) {
    const key = argv[i].replace(/^--/, "");
    if ( !(key in out) || argv[i + 1] === undefined ) throw new Error(`unknown option or missing value: ${argv[i]}`);
    out[key] = argv[++i];
  }
  out.modules ??= join(out.dnd5e, "..", "..", "modules");
  return out;
}

/* -------------------------------------------- */
/*  The helper's own code                       */
/* -------------------------------------------- */

/**
 * The helper's modules, imported as the tests import them: scripts/core.js points at the core one folder over in
 * Foundry, so the same path is sent to the core repository here (vitest.config.js's alias); game.i18n a stand-in with
 * no words; the reading words reading/en.json's.
 */
let modules = null;
export async function helperModules(coreScripts) {
  if ( modules ) return modules;
  const core = pathToFileURL(/[\\/]$/.test(coreScripts) ? coreScripts : `${coreScripts}/`).href;
  const hook = `export async function resolve(specifier, context, next) {
    const m = /^(?:\\.\\.\\/)+(?:fast-fighting|FastFighting)\\/scripts\\/(.*)$/.exec(specifier);
    return m ? next(new URL(m[1], ${JSON.stringify(core)}).href, context) : next(specifier, context);
  }`;
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  globalThis.game = { i18n: { lang: "en", has: () => false, localize: key => key, format: key => key } };
  const s = name => import(pathToFileURL(join(REPO, "scripts", name)).href);
  const [reading, adapter, reactions, saveVs, auras, multiattack] = await Promise.all([
    s("reading.js"), s("adapter.js"), s("reactions-read.js"), s("save-vs.js"), s("auras.js"), s("multiattack.js")
  ]);
  reading.setReading(JSON.parse(readFileSync(join(REPO, "reading", "en.json"), "utf8")));
  modules = { reading, adapter, reactions, saveVs, auras, multiattack };
  return modules;
}

/* -------------------------------------------- */
/*  Packs                                       */
/* -------------------------------------------- */

/** A LevelDB pack's documents, by key, read from a copy (Foundry may have it open). */
async function readPack(ClassicLevel, dir) {
  const copy = mkdtempSync(join(tmpdir(), "ff5e-pack-"));
  try {
    for ( const f of readdirSync(dir) ) if ( f !== "LOCK" && statSync(join(dir, f)).isFile() ) copyFileSync(join(dir, f), join(copy, f));
    const db = new ClassicLevel(copy, { keyEncoding: "utf8", valueEncoding: "json" });
    const out = new Map();
    for await ( const [k, v] of db.iterator() ) out.set(k, v);
    await db.close();
    return out;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** The Item and Actor packs a system or module manifest lists: [{name, path}]. */
function packsOf(folder, manifestName) {
  const file = join(folder, manifestName);
  if ( !existsSync(file) ) return [];
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  return (manifest.packs ?? []).filter(p => ["Item", "Actor"].includes(p.type)).map(p => ({ name: p.name, path: join(folder, p.path ?? join("packs", p.name)) }))
    .filter(p => existsSync(p.path));
}

/**
 * Every feat in a pack, standalone or on an actor (with that actor's other items: a Multiattack's attacks, the items its
 * words link to), each with its own effects (their changes: an effect that sets the sheet's save roll mode).
 */
function featsIn(kv) {
  const items = new Map();
  const effects = new Map();
  for ( const [k, v] of kv ) {
    if ( k.startsWith("!actors.items!") ) {
      const actorId = k.split("!")[2].split(".")[0];
      if ( !items.has(actorId) ) items.set(actorId, []);
      items.get(actorId).push(v);
    } else if ( k.startsWith("!items.effects!") || k.startsWith("!actors.items.effects!") ) {
      const itemId = k.split("!")[2].split(".").at(-2);
      if ( !effects.has(itemId) ) effects.set(itemId, []);
      effects.get(itemId).push(v);
    }
  }
  const out = [];
  for ( const [k, v] of kv ) {
    const own = { ...v, effects: effects.get(v._id) ?? [] };
    if ( k.startsWith("!items!") && v.type === "feat" ) out.push({ item: own, siblings: [] });
    else if ( k.startsWith("!actors.items!") && v.type === "feat" ) out.push({ item: own, siblings: items.get(k.split("!")[2].split(".")[0]) ?? [] });
  }
  return out;
}

/* -------------------------------------------- */
/*  Classifying                                 */
/* -------------------------------------------- */

/** An item's activities as the adapter sees them (a list, with get by id). */
const activitiesOf = item => {
  const list = Object.values(item.system?.activities ?? {}).map(a => ({ ...a, id: a._id ?? a.id }));
  return Object.assign(list, { get: id => list.find(a => a.id === id) ?? null });
};

/**
 * What the helper reads of one feature: {kind: "reaction" | "saveVs" | "aura" | "multiattack" | "regeneration", read:
 * "identifier" | "words" | false}[] (none for one that's none of these).
 */
export function classify(m, item, siblings = []) {
  const { adapter, reactions, saveVs, auras, multiattack } = m;
  const id = String(item.system?.identifier ?? "");
  const acts = activitiesOf(item);
  const withActs = { ...item, system: { ...item.system, activities: acts } };
  const html = item.system?.description?.value ?? "";
  const out = [];
  const reactionAct = acts.find(a => a.activation?.type === "reaction") ?? null;
  // (Its creature as plainText takes it, for the items its words link to: a Multiattack's "[[/item .bite]]".)
  const actor = { items: { get: i => siblings.find(x => x._id === i) ?? null, getName: n => siblings.find(x => x.name === n) ?? null } };
  const text = adapter.plainText(adapter.filledLookups(html, withActs, reactionAct), actor, false);
  const passive = acts.every(a => ["", "special", "none", undefined, null].includes(a.activation?.type));
  // Reactions.
  if ( reactionAct || /\breaction\b/i.test(text) ) {
    if ( KNOWN_REACTIONS.includes(id) ) out.push({ kind: "reaction", read: "identifier" });
    else {
      const condition = reactionAct ? adapter.plainText(adapter.filledLookups(reactionAct.activation?.condition ?? "", withActs, reactionAct), null, false) : "";
      const formula = Number(reactionAct?.roll?.formula);
      const read = reactions.reactionsFromWords({ id: "x", label: item.name, text, condition, formula: Number.isFinite(formula) ? formula : (/@prof/.test(reactionAct?.roll?.formula ?? "") ? 2 : null) });
      out.push({ kind: "reaction", read: read.length ? "words" : false });
    }
  }
  // Situational saves (one whose own effect sets the sheet's save roll mode, read from the sheet).
  const sheetMode = (item.effects ?? []).some(e => [...(e.system?.changes ?? e.changes ?? [])].some(c => /\.save\.roll\.mode$/.test(String(c?.key))));
  if ( passive && /advantage on[^.]*saving throws?/i.test(text) ) out.push({ kind: "saveVs", read: sheetMode ? "identifier" : saveVs.saveVsFromWords(text).length ? "words" : false });
  // Auras.
  for ( const a of acts ) {
    if ( !auras.isAuraActivity({ ...a, save: { ...(a.save ?? {}) } }) ) continue;
    const said = adapter.plainText(adapter.filledLookups(`${a.activation?.condition ?? ""} ${html}`, withActs, a), actor, false);
    out.push({ kind: "aura", read: auras.auraTiming(said) ? "words" : false });
  }
  // A creature's Multiattack, by its attacks' names.
  if ( id === "multiattack" && siblings.length ) {
    const strikes = siblings.filter(i => i !== item && (i.type === "weapon" || Object.values(i.system?.activities ?? {}).some(a => a.type === "attack" || a.type === "save")))
      .map(i => ({ name: i.name, melee: null }));
    out.push({ kind: "multiattack", read: multiattack.parseMultiattackOptions(text, strikes).some(o => o.length > 1) ? "words" : false });
  }
  // Regeneration (its heal activity's amount, where its words leave it to a link, as the adapter has it).
  if ( id === "regeneration" ) {
    const heal = acts.find(a => a.type === "heal");
    out.push({ kind: "regeneration", read: adapter.regenerationFrom(text, heal ? 1 : null) ? "words" : false });
  }
  return out;
}

/* -------------------------------------------- */
/*  The scan                                    */
/* -------------------------------------------- */

const KINDS = ["reaction", "saveVs", "aura", "multiattack", "regeneration"];
const KIND_NAMES = { reaction: "Reactions", saveVs: "Situational saves", aura: "Auras", multiattack: "Multiattack", regeneration: "Regeneration" };

/**
 * Every source's tallies: [{source, label, free, kinds: {kind: {total, identifier, words}}, missed: Map(kind -> Map(identifier -> n))}].
 */
export async function scan(o) {
  const m = await helperModules(o.core);
  const ClassicLevel = createRequire(join(o.foundry, "package.json"))("classic-level").ClassicLevel;
  const sources = [];
  const systemPacks = packsOf(o.dnd5e, "system.json");
  sources.push({ source: "srd51", label: "SRD 5.1 (2014)", free: true, packs: systemPacks.filter(p => !/24$/.test(p.name)) });
  sources.push({ source: "srd52", label: "SRD 5.2 (2024)", free: true, packs: systemPacks.filter(p => /24$/.test(p.name)) });
  for ( const id of String(o.books ?? "").split(",").map(s => s.trim()).filter(Boolean) ) {
    const folder = join(o.modules, id);
    if ( !existsSync(join(folder, "module.json")) ) continue;
    const title = JSON.parse(readFileSync(join(folder, "module.json"), "utf8")).title ?? id;
    sources.push({ source: id, label: title, free: false, packs: packsOf(folder, "module.json") });
  }
  for ( const s of sources ) {
    s.kinds = Object.fromEntries(KINDS.map(k => [k, { total: 0, identifier: 0, words: 0 }]));
    s.missed = new Map(KINDS.map(k => [k, new Map()]));
    s.read = new Map(KINDS.map(k => [k, new Map()]));
    const seen = new Set();
    for ( const p of s.packs ) {
      let kv;
      try {
        kv = await readPack(ClassicLevel, p.path);
      } catch ( err ) {
        console.warn(`coverage | ${p.name}: ${err.message}`);
        continue;
      }
      for ( const { item, siblings } of featsIn(kv) ) {
        const key = `${item.system?.identifier ?? item.name}|${(item.system?.description?.value ?? "").length}`;
        if ( seen.has(key) ) continue;
        seen.add(key);
        for ( const c of classify(m, item, siblings) ) {
          const t = s.kinds[c.kind];
          t.total += 1;
          const name = item.system?.identifier || item.name;
          if ( c.read ) {
            t[c.read] += 1;
            s.read.get(c.kind).set(name, (s.read.get(c.kind).get(name) ?? 0) + 1);
          } else s.missed.get(c.kind).set(name, (s.missed.get(c.kind).get(name) ?? 0) + 1);
        }
      }
    }
    delete s.packs;
  }
  return sources;
}

/* -------------------------------------------- */
/*  Reports                                     */
/* -------------------------------------------- */

const pct = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : "–");

/** A tally table for each source. */
function tables(sources) {
  const lines = ["| Source | " + KINDS.map(k => KIND_NAMES[k]).join(" | ") + " |", "| --- | " + KINDS.map(() => "---").join(" | ") + " |"];
  for ( const s of sources ) {
    lines.push(`| ${s.label} | ${KINDS.map(k => { const t = s.kinds[k]; const read = t.identifier + t.words; return t.total ? `${read} of ${t.total} (${pct(read, t.total)})` : "–"; }).join(" | ")} |`);
  }
  return lines;
}

/** What wasn't read, by kind, the most often first (`limit` each). */
function misses(s, limit = 40) {
  const out = [];
  for ( const k of KINDS ) {
    const list = [...s.missed.get(k)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if ( !list.length ) continue;
    out.push(`- ${KIND_NAMES[k]} (${list.length}): ${list.slice(0, limit).map(([n, c]) => (c > 1 ? `\`${n}\` ×${c}` : `\`${n}\``)).join(", ")}${list.length > limit ? ", ..." : ""}`);
  }
  return out;
}

/** The public report: every source's tallies, and the SRD's misses by name (free content); the books' counted only. */
export function report(sources, { system = "" } = {}) {
  const lines = ["# What FastFighting D&D 5e reads", "",
    `Generated by \`tools/coverage.mjs\`${system ? ` against dnd5e ${system}` : ""}. Each feature counted once per source (by identifier and words). "Read": known by identifier or read from its words by the helper's readers.`, "",
    ...tables(sources), ""];
  for ( const s of sources.filter(x => x.free) ) {
    const list = misses(s);
    if ( !list.length ) continue;
    lines.push(`## Not read: ${s.label}`, "", ...list, "");
  }
  lines.push("The installed books (the Monster Manual, the Player's Handbook, the Dungeon Master's Guide) are counted only; their features are named in a private report (`--private`), never here.", "");
  return lines.join("\n");
}

/** The private report: every source's misses and what's read, by name (the books' too). For the team's eyes only. */
export function privateReport(sources) {
  const lines = ["# Coverage, every source by name (private: not for the repository)", "", ...tables(sources), ""];
  for ( const s of sources ) {
    lines.push(`## ${s.label}`, "", "Not read:", "", ...misses(s, 200), "", "Read:", "");
    for ( const k of KINDS ) {
      const list = [...s.read.get(k)].sort((a, b) => b[1] - a[1]);
      if ( list.length ) lines.push(`- ${KIND_NAMES[k]}: ${list.map(([n]) => `\`${n}\``).join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

if ( process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href ) {
  const o = options(process.argv.slice(2));
  const sources = await scan(o);
  const system = JSON.parse(readFileSync(join(o.dnd5e, "system.json"), "utf8")).version ?? "";
  const text = report(sources, { system });
  if ( o.out ) {
    const file = resolve(process.cwd(), o.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`coverage | written to ${file}`);
  } else console.log(text);
  if ( o.private ) {
    const file = resolve(process.cwd(), o.private);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, privateReport(sources));
    console.log(`coverage | the private report written to ${file}`);
  }
}
