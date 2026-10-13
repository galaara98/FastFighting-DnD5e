/**
 * A number from a formula an item holds (a summon's count, its creatures' CR, a bonus to their HP or AC), worked out
 * without ever running it as code: a formula is a player's to write, and Foundry's own Roll.safeEval runs what it's
 * given. Only numbers, + - * /, brackets, and floor, ceil, round, trunc, min, max and abs are understood; a formula
 * with dice is averaged by the core's dice parser; anything else is no number at all. Pure.
 */
import { parseFormula, meanPart } from "./core.js";

const FUNCTIONS = Object.freeze({
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, abs: Math.abs,
  min: (...v) => Math.min(...v), max: (...v) => Math.max(...v)
});

/** The formula's tokens: numbers, names, operators and brackets; null if anything else is in it. */
function tokens(text) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([a-z]+)|([-+*/(),]))/gy;
  let m;
  let at = 0;
  while ( at < text.length ) {
    re.lastIndex = at;
    m = re.exec(text);
    if ( !m ) return /^\s*$/.test(text.slice(at)) ? out : null;
    at = re.lastIndex;
    if ( m[1] !== undefined ) out.push({ n: Number(m[1]) });
    else if ( m[2] !== undefined ) out.push({ name: m[2] });
    else out.push({ op: m[3] });
  }
  return out;
}

/** Worked out by recursive descent over the tokens (no code is made of them). */
function evaluate(list) {
  let i = 0;
  const peek = () => list[i];
  const take = op => (list[i]?.op === op ? (i++, true) : false);
  const fail = () => { throw new Error("not arithmetic"); };
  function primary() {
    const t = list[i++];
    if ( !t ) fail();
    if ( t.n !== undefined ) return t.n;
    if ( t.op === "-" ) return -primary();
    if ( t.op === "+" ) return primary();
    if ( t.op === "(" ) {
      const v = sum();
      if ( !take(")") ) fail();
      return v;
    }
    if ( t.name && Object.hasOwn(FUNCTIONS, t.name) && take("(") ) {
      const args = [sum()];
      while ( take(",") ) args.push(sum());
      if ( !take(")") ) fail();
      return FUNCTIONS[t.name](...args);
    }
    return fail();
  }
  function product() {
    let v = primary();
    for ( ;; ) {
      if ( take("*") ) v *= primary();
      else if ( take("/") ) v /= primary();
      else return v;
    }
  }
  function sum() {
    let v = product();
    for ( ;; ) {
      if ( take("+") ) v += product();
      else if ( take("-") ) v -= product();
      else return v;
    }
  }
  const v = sum();
  if ( peek() ) fail();
  return v;
}

/**
 * A dice formula with its dice counts worked out ("(5 - 3)d8" -> "2d8", "(1)d12" -> "1d12"; none below 0), for the
 * core's dice parser, which reads plain terms and drops brackets. Arithmetic only, as formulaNumber.
 */
export function plainDice(formula) {
  return String(formula ?? "").replace(/\(([^()]*)\)\s*d\s*(\d+)/gi, (m, count, faces) => `${Math.max(0, formulaNumber(count, 0))}d${faces}`);
}

/**
 * The number a formula comes to (rounded down), or `fallback` when it isn't one: arithmetic only, dice averaged.
 * @param {string} formula   with its @data already filled in (Roll.replaceFormulaData)
 * @param {number} [fallback]
 */
export function formulaNumber(formula, fallback = 0) {
  const text = String(formula ?? "").trim().toLowerCase();
  if ( !text || text.length > 200 ) return fallback;
  try {
    let v;
    if ( /\d*d\d+/.test(text) ) {
      const part = parseFormula(plainDice(text));
      v = part ? meanPart(part) : NaN;
    } else {
      const list = tokens(text);
      v = list ? evaluate(list) : NaN;
    }
    return Number.isFinite(v) ? Math.floor(v) : fallback;
  } catch ( err ) {
    return fallback;
  }
}
