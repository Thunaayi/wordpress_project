// Variant guard for product matching.
//
// Token overlap barely notices a one-word difference, which is how
// "... ARGB Black" and "... ARGB White", or "H510M-F" and "H510M-K", ended up
// matched to the same competitor page and getting the same photos.
//
// variantConflict(target, candidate) returns a short reason string when the
// two names describe different variants, or null when nothing conflicts.
// It only reports a conflict when both sides give evidence. Missing
// information on one side is not treated as a conflict here, because
// retailers often shorten titles. The duplicate source page check in
// enrich_new_products.js covers that case.

function norm(s) {
  return String(s || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COLORS = new Set([
  "black", "white", "silver", "grey", "gray", "red", "blue", "green", "pink",
  "purple", "gold", "orange", "yellow", "graphite", "beige", "brown",
  "lime", "navy", "teal", "cyan", "maroon", "violet", "mint", "cream", "rose"
]);

// Groups where the two sides must not name different values.
const EXCLUSIVE_GROUPS = [
  { name: "ram type", values: ["ddr3", "ddr4", "ddr5"] },
  { name: "packaging", values: ["tray", "boxed", "box"] },
  { name: "revision", values: ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "mk", "mk2", "mkii"] },
];

// Suffix words that turn one product into a different one. If exactly one
// side has the word, they are different products.
const ONE_SIDED_FLAGS = new Set([
  "wifi", "plus", "max", "pro", "ti", "super", "xt", "xtx", "oc", "ultra",
  "lite", "mini", "evo", "se", "csm", "ii", "iii", "refined", "king"
]);

// Words retailers add to titles as a description (an "ARGB" fan listed as
// "Black ARGB Case Fan"). Our product having the word while the candidate
// lacks it is a conflict. The reverse is not.
const TARGET_ONLY_FLAGS = new Set(["argb"]);

function canonicalToken(t) {
  if (t === "gray") return "grey";
  if (t === "d4") return "ddr4";
  if (t === "d5") return "ddr5";
  return t;
}

function tokenList(s) {
  // "80 Plus" is a power supply efficiency rating, not the Plus edition.
  return norm(s).replace(/\b80 plus\b/g, "80plus").split(" ").filter(Boolean).map(canonicalToken);
}

function colorsIn(toks) {
  return new Set(toks.filter(t => COLORS.has(t)));
}

// "h510m f" -> key "h510m" with letter "f". Motherboard names split the
// final letter off with a dash, and one letter tokens are dropped by the
// general tokenizer, so H510M-F and H510M-K look identical without this.
function letterSuffixes(toks) {
  const out = new Map();
  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (/\d/.test(t) && /^[a-z]$/.test(next)) out.set(t, next);
  }
  return out;
}

function variantConflict(target, candidate) {
  const a = tokenList(target);
  const b = tokenList(candidate);
  if (!a.length || !b.length) return null;

  const colorsA = colorsIn(a);
  const colorsB = colorsIn(b);
  if (colorsA.size && colorsB.size && ![...colorsA].some(c => colorsB.has(c))) {
    return "color: " + [...colorsA].join("/") + " vs " + [...colorsB].join("/");
  }

  for (const group of EXCLUSIVE_GROUPS) {
    const va = group.values.filter(v => a.includes(v));
    const vb = group.values.filter(v => b.includes(v));
    if (va.length && vb.length && !va.some(v => vb.includes(v))) {
      return group.name + ": " + va.join("/") + " vs " + vb.join("/");
    }
  }

  const setA = new Set(a);
  const setB = new Set(b);
  for (const flag of ONE_SIDED_FLAGS) {
    if (setA.has(flag) !== setB.has(flag)) {
      return "variant word '" + flag + "' only on the " + (setA.has(flag) ? "product" : "candidate");
    }
  }

  for (const flag of TARGET_ONLY_FLAGS) {
    if (setA.has(flag) && !setB.has(flag)) return "variant word '" + flag + "' only on the product";
  }

  const sufA = letterSuffixes(a);
  const sufB = letterSuffixes(b);
  for (const [base, letter] of sufA) {
    if (sufB.has(base) && sufB.get(base) !== letter) {
      return "model suffix: " + base + "-" + letter + " vs " + base + "-" + sufB.get(base);
    }
  }

  return null;
}

module.exports = { variantConflict };
