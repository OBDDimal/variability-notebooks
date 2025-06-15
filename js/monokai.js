import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

const monokaiColors = {
  background: "#272822",
  foreground: "#f8f8f2",
  comment: "#75715e",
  red: "#f92672",
  orange: "#fd971f",
  yellow: "#e6db74",
  green: "#a6e22e",
  blue: "#66d9ef",
  purple: "#ae81ff",
};

const monokaiTheme = EditorView.theme({
  "&": {
    color: monokaiColors.foreground,
    backgroundColor: monokaiColors.background,
  },
  ".cm-content": {
    caretColor: monokaiColors.red,
    fontFamily: 'Source Code Pro, monospace',
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: monokaiColors.red },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: monokaiColors.yellow + "44" },
  ".cm-panels": { backgroundColor: monokaiColors.background, color: monokaiColors.foreground },
  ".cm-gutters": {
    backgroundColor: monokaiColors.background,
    color: monokaiColors.comment,
    border: "none",
  },
  ".cm-activeLine": {
    backgroundColor: monokaiColors.yellow + "1A",
  },
  ".cm-activeLineGutter": {
    backgroundColor: monokaiColors.yellow + "1A",
  },
}, { dark: true });

const monokaiHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: monokaiColors.red },
  { tag: [tags.name, tags.variableName], color: monokaiColors.foreground },
  { tag: tags.namespace, color: monokaiColors.foreground },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: monokaiColors.blue },
  { tag: tags.propertyName, color: monokaiColors.foreground },
  { tag: [tags.constant(tags.name), tags.standard(tags.name)], color: monokaiColors.orange },
  { tag: [tags.className, tags.typeName], color: monokaiColors.yellow },
  { tag: [tags.number, tags.annotation, tags.modifier], color: monokaiColors.purple },
  { tag: [tags.operator, tags.operatorKeyword], color: monokaiColors.red },
  { tag: tags.tagName, color: monokaiColors.orange },
  { tag: tags.comment, fontStyle: "italic", color: monokaiColors.comment },
  { tag: tags.string, color: monokaiColors.yellow },
  { tag: tags.invalid, color: monokaiColors.red },
]);

export const monokaiPython = [
  monokaiTheme,
  syntaxHighlighting(monokaiHighlightStyle),
];
