/**
 * @license
 *
 * Hyphenation patterns for Serbo-Croatian (Cyrillic) (sh-cyrl)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1990, 2008 Dejan Muhamedagić
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const sh_cyrl_patterns: HyphenationTrieNode;
export default sh_cyrl_patterns;
