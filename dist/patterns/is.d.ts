/**
 * @license
 *
 * Hyphenation patterns for Icelandic (is)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1988, 2004 Jörgen Pind
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const is_patterns: HyphenationTrieNode;
export default is_patterns;
