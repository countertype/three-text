/**
 * @license
 *
 * Hyphenation patterns for Interlingua (ia)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1989-2005 Peter Kleiweg
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const ia_patterns: HyphenationTrieNode;
export default ia_patterns;
