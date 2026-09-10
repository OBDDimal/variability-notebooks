// Lightweight CodeMirror syntax highlighting for the two non-Python languages
// used in notebook snippets: DIMACS and UVL. These editors render on a light
// background, so the highlight styles below target that.

import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// --- DIMACS -----------------------------------------------------------------
// - `c ...` comment lines: gray
// - the `p cnf <vars> <clauses>` header: highlighted
// - the trailing `0` that terminates each clause: gray
const dimacsParser = StreamLanguage.define({
  name: "dimacs",
  startState: () => ({ lineStart: true, pLine: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.lineStart = true;
      state.pLine = false;
    }
    if (stream.eatSpace()) {
      return null;
    }

    if (state.lineStart) {
      state.lineStart = false;
      if (stream.match(/^c(?=\s|$)/)) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^p(?=\s|$)/)) {
        state.pLine = true;
        return "keyword";
      }
    }

    if (state.pLine) {
      if (stream.match(/^[A-Za-z]+/)) return "keyword";
      if (stream.match(/^\d+/)) return "number";
      stream.next();
      return null;
    }

    // a lone `0` closing the clause (only whitespace left on the line)
    if (stream.match(/^0(?=\s*$)/)) return "comment";
    if (stream.match(/^-?\d+/)) return null;

    stream.next();
    return null;
  },
});

const dimacsHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#8b949e" },
  { tag: t.keyword, color: "#0550ae", fontWeight: "bold" },
  { tag: t.number, color: "#8250df" },
]);

export const dimacsLanguage = [dimacsParser, syntaxHighlighting(dimacsHighlight)];

// --- UVL -------------------------------------------------------------------
// Highlight the fixed structural names and the constraint operators; feature
// names and everything else stay in the default text color.
const UVL_KEYWORDS = new Set([
  "features",
  "constraints",
  "mandatory",
  "optional",
  "or",
  "alternative",
  "group",
]);
const UVL_WORD_OPERATORS = new Set(["and", "or", "not", "implies", "iff"]);

const uvlParser = StreamLanguage.define({
  name: "uvl",
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }
    if (stream.match(/^(<=>|=>|&|\||!|==|!=)/)) {
      return "operator";
    }
    if (stream.match(/^"[^"]*"/)) {
      return "string";
    }
    if (stream.match(/^[A-Za-z_][\w]*/)) {
      const word = stream.current().toLowerCase();
      if (UVL_KEYWORDS.has(word)) return "keyword";
      if (UVL_WORD_OPERATORS.has(word)) return "operator";
      return null;
    }
    if (stream.match(/^\d+(\.\d+)?/)) {
      return "number";
    }
    stream.next();
    return null;
  },
});

const uvlHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#0550ae", fontWeight: "bold" },
  { tag: t.operator, color: "#cf222e" },
  { tag: t.string, color: "#0a7d33" },
  { tag: t.number, color: "#8250df" },
]);

export const uvlLanguage = [uvlParser, syntaxHighlighting(uvlHighlight)];
