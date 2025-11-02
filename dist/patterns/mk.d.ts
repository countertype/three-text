/**
 * @license
 *
 * Hyphenation patterns for Macedonian (mk)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 2006 Vasil Taneski
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const mk_patterns: HyphenationTrieNode;
export default mk_patterns;
