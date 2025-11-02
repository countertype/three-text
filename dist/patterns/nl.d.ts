/**
 * @license
 *
 * Hyphenation patterns for Dutch (nl)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1996 Piet Tutelaers
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const nl_patterns: HyphenationTrieNode;
export default nl_patterns;
