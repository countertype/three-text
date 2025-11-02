/**
 * @license
 *
 * Hyphenation patterns for Kurmanji Kurdish (kmr)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 2009 Jörg Knappen, Medeni Shemdê
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const kmr_patterns: HyphenationTrieNode;
export default kmr_patterns;
