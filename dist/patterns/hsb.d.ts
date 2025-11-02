/**
 * @license
 *
 * Hyphenation patterns for Upper Sorbian (hsb)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1997 Eduard Werner
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const hsb_patterns: HyphenationTrieNode;
export default hsb_patterns;
