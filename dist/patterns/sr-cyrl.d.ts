/**
 * @license
 *
 * Hyphenation patterns for Serbian (Cyrillic) (sr-cyrl)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1990-2003 Dejan Muhamedagić, Aleksandar Jelenak
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const sr_cyrl_patterns: HyphenationTrieNode;
export default sr_cyrl_patterns;
