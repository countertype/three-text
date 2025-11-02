/**
 * @license
 *
 * Hyphenation patterns for Czech (cs)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1995 Pavel Ševeček
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const cs_patterns: HyphenationTrieNode;
export default cs_patterns;
