/**
 * @license
 *
 * Hyphenation patterns for Romanian (ro)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1995-1996 Adrian Rezus
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const ro_patterns: HyphenationTrieNode;
export default ro_patterns;
