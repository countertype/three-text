/**
 * @license
 *
 * Hyphenation patterns for Sanskrit (sa)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 2006-2011 Yves Codet
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const sa_patterns: HyphenationTrieNode;
export default sa_patterns;
