/**
 * Convert common AI math delimiters into Obsidian's native MathJax syntax.
 * The source message is left untouched; normalization only happens at render time.
 */
export function normalizeMathMarkdown(source: string): string {
  const mathFencesNormalized = source.replace(
    /(^|\n)(`{3,}|~{3,})[ \t]*(?:math|latex|tex)[ \t]*\r?\n([\s\S]*?)\r?\n\2[ \t]*(?=\r?\n|$)/gi,
    (_match, prefix: string, _fence: string, expression: string) => {
      const trimmed = expression.trim();
      return trimmed ? `${prefix}$$\n${trimmed}\n$$` : _match;
    }
  );

  // Do not reinterpret examples inside ordinary fenced or inline code.
  const protectedCode = /(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,}|`+[^`\r\n]*`+)/g;
  let cursor = 0;
  let normalized = "";

  for (const match of mathFencesNormalized.matchAll(protectedCode)) {
    const index = match.index ?? 0;
    normalized += normalizeMathDelimiters(mathFencesNormalized.slice(cursor, index));
    normalized += match[0];
    cursor = index + match[0].length;
  }

  normalized += normalizeMathDelimiters(mathFencesNormalized.slice(cursor));
  return normalized;
}

function normalizeMathDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (match, expression: string) => {
      const trimmed = expression.trim();
      return trimmed ? `\n$$\n${trimmed}\n$$\n` : match;
    })
    .replace(/\\\(([^\r\n]*?)\\\)/g, (match, expression: string) => {
      const trimmed = expression.trim();
      return trimmed ? `$${trimmed}$` : match;
    });
}
