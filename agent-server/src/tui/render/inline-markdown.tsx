// input:  a text string possibly containing inline markdown (**bold**, *italic*, `code`, [t](url))
// output: an Ink <Text> tree with the markers applied as styles (asterisks/backticks stripped)
// pos:    Bridges parseMarkdown() (render/markdown.ts) into Ink. Without this, message and
//         RichBlock text rendered the raw markers literally (e.g. "**You:**"), which read as
//         "wrong bold" — the markers showed instead of the styling.

import React from 'react';
import { Text } from 'ink';
import { parseMarkdown } from './markdown.js';

interface InlineMarkdownProps {
  text: string;
  /** Dim the whole run (used for context/secondary lines). Inner styles still apply. */
  dimColor?: boolean;
}

/**
 * Render inline markdown into an Ink <Text>. Multi-line text is preserved (parseMarkdown
 * keeps newlines inside plain-text segments; bold/italic/code spans never cross a line).
 * A string with no markers renders as a single plain run.
 */
export function InlineMarkdown({ text, dimColor }: InlineMarkdownProps): React.JSX.Element {
  const segments = parseMarkdown(text);
  if (segments.length === 0) {
    return <Text dimColor={dimColor}>{text}</Text>;
  }
  return (
    <Text dimColor={dimColor}>
      {segments.map((seg, i) => {
        switch (seg.type) {
          case 'bold':
            return <Text key={i} bold>{seg.text}</Text>;
          case 'italic':
            return <Text key={i} italic>{seg.text}</Text>;
          case 'code':
            return <Text key={i} color="cyan">{seg.text}</Text>;
          case 'link':
            // Keep the URL visible — terminals can't make text clickable reliably, and
            // dropping it loses information. Render "text (url)" with the label emphasized.
            return (
              <Text key={i}>
                <Text color="cyan" underline>{seg.text}</Text>
                {seg.url ? <Text dimColor> ({seg.url})</Text> : null}
              </Text>
            );
          default:
            return <Text key={i}>{seg.text}</Text>;
        }
      })}
    </Text>
  );
}
