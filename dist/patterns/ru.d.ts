/**
 * @license
 *
 * Hyphenation patterns for Russian (ru)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1999-2003 Alexander I. Lebedev
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const ru_patterns: HyphenationTrieNode;
export default ru_patterns;
