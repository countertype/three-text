/**
 * @license
 *
 * Hyphenation patterns for Finnish (fi)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1986, 1988, 1989 Kauko Saarinen
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const fi_patterns: HyphenationTrieNode;
export default fi_patterns;
