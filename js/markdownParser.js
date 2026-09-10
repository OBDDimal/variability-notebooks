import { marked } from "marked";

// Cache for parsed notebooks
const notebookCache = new Map();

// Configure marked options for MathJax support
marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false,
  smartLists: true,
  smartypants: false,
  mangle: false,
  headerIds: false
});

// Drop trailing whitespace / blank lines from a code block so editors and files
// don't carry a dangling empty line.
function stripTrailingBlankLines(text) {
  return typeof text === 'string' ? text.replace(/\s+$/, '') : text;
}

// General YAML block parser
function parseYAMLBlock(yamlString) {
  try {
    return window.jsyaml.load(yamlString);
  } catch (e) {
    return null;
  }
}

// Parses the initial YAML front matter of the document
function parseYAMLFrontMatter(markdownText) {
  const match = markdownText.match(/^---\n([\s\S]+?)\n---/);
  if (match) {
    const yamlText = match[1];
    const data = parseYAMLBlock(yamlText);
    const content = markdownText.slice(match[0].length);
    return { metadata: data, content };
  }
  return { metadata: {}, content: markdownText };
}

export function parseMarkdownForNotebook(markdownText, path) {
  // Check cache first
  if (path && notebookCache.has(path)) {
    return notebookCache.get(path);
  }

  let { metadata, content } = parseYAMLFrontMatter(markdownText); // `content` will be modified
  
  const namedSnippetsForPyodide = new Map(); // filename -> { language, content }
  const codeBlockLocations = []; // To map cleaned code blocks back to original named snippet info

  let cleanedContentParts = [];
  let lastIndex = 0;

  // Regex to find named snippets: --- YAML --- ```lang CODE ```
  // Using non-greedy quantifiers and capturing groups for precise extraction
  const snippetRegex = /(^|\n)---(\n[\s\S]*?\n)---(\n```(?:\s*(\w+))?\n([\s\S]*?)\n```($|\n))/g;

  let match;
  while ((match = snippetRegex.exec(content)) !== null) {
    // Add content before the current snippet
    cleanedContentParts.push(content.substring(lastIndex, match.index + match[1].length)); // Include leading newline/start-of-string

    const fullMatchLength = match[0].length;
    const yamlContent = match[2]; // Captured YAML block including newlines
    const fullCodeBlockString = match[3]; // Captured code block including fences and newlines
    const language = match[4] || '';
    const codeContent = match[5]; // Captured code content only

    const snippetData = parseYAMLBlock(yamlContent);

    if (snippetData && snippetData.filename) {
      // Accept both `read-only`/`readonly` and `show-only`/`showOnly`.
      const readonly = Boolean(
        snippetData['read-only'] ?? snippetData.readonly ?? false
      );
      const showOnlyValue = Number(
        snippetData['show-only'] ?? snippetData.showOnly
      );
      const showOnly =
        Number.isFinite(showOnlyValue) && showOnlyValue > 0
          ? Math.floor(showOnlyValue)
          : null;

      namedSnippetsForPyodide.set(snippetData.filename, {
        language: language,
        content: stripTrailingBlankLines(codeContent),
        readonly: readonly
      });

      // Replace the entire named snippet markdown with just the code block part
      // This ensures marked.lexer only sees the code block, not the YAML annotation
      cleanedContentParts.push(fullCodeBlockString);

      // Store info about this replacement to augment marked.lexer's code token later
      codeBlockLocations.push({
        originalCodeContent: codeContent,
        filename: snippetData.filename,
        lang: language,
        readonly: readonly,
        showOnly: showOnly
      });
    } else {
      // If filename not found or YAML parse error, keep the original content in the cleaned markdown
      // This means the problematic snippet (if any) will be processed by marked.lexer as-is
      cleanedContentParts.push(match[0]); 
    }
    lastIndex = match.index + fullMatchLength;
  }
  // Add any remaining content after the last snippet
  cleanedContentParts.push(content.substring(lastIndex));
  content = cleanedContentParts.join(''); // This is the final content passed to marked.lexer

  // Use marked.lexer to get tokens from the cleaned content
  const rawTokens = marked.lexer(content);

  const finalProcessedTokens = [];
  let codeBlockIdx = 0;

  // Second pass: augment 'code' tokens that correspond to named snippets, and
  // strip any trailing blank line from every code block.
  for (const token of rawTokens) {
    if (token.type !== 'code') {
      finalProcessedTokens.push(token);
      continue;
    }

    const trimmedToken = { ...token, text: stripTrailingBlankLines(token.text) };

    if (
      codeBlockIdx < codeBlockLocations.length &&
      token.text === codeBlockLocations[codeBlockIdx].originalCodeContent &&
      token.lang === codeBlockLocations[codeBlockIdx].lang
    ) {
      finalProcessedTokens.push({
        ...trimmedToken,
        filename: codeBlockLocations[codeBlockIdx].filename,
        isNamedSnippet: true,
        readonly: codeBlockLocations[codeBlockIdx].readonly,
        showOnly: codeBlockLocations[codeBlockIdx].showOnly,
      });
      codeBlockIdx++;
    } else {
      finalProcessedTokens.push(trimmedToken);
    }
  }

  const result = { 
    metadata: metadata, // Main document front matter
    tokens: finalProcessedTokens, // Marked tokens for rendering, augmented for named snippets
    namedSnippets: namedSnippetsForPyodide // Map of filename -> content for Pyodide
  };
  
  // Cache the result
  if (path) {
    notebookCache.set(path, result);
  }

  return result;
}

// Clear cache when needed
export function clearNotebookCache() {
  notebookCache.clear();
} 