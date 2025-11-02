/**
 * @license
 *
 * Hyphenation patterns for Thai (th)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 2012-2013 Theppitak Karoonboonyanan
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const th_patterns: HyphenationTrieNode;
export default th_patterns;
