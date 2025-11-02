/**
 * @license
 *
 * Hyphenation patterns for Esperanto (eo)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1999 Sergei B. Pokrovsky (Sergio Pokrovskij)
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const eo_patterns: HyphenationTrieNode;
export default eo_patterns;
