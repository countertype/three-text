/**
 * @license
 *
 * Hyphenation patterns for Indonesian (id)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1996, 1997 Jörg Knappen, Terry Mart
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const id_patterns: HyphenationTrieNode;
export default id_patterns;
