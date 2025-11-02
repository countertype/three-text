/**
 * @license
 *
 * Hyphenation patterns for US English (en-us)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1990, 2004, 2005 Gerard D.C. Kuiken
 *
 * Copying and distribution of this file, with or without modification, are permitted in any medium without royalty provided the copyright notice and this notice are preserved.
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const en_us_patterns: HyphenationTrieNode;
export default en_us_patterns;
