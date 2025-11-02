/**
 * @license
 *
 * Hyphenation patterns for Greek (Polytonic) (el-polyton)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 2008-2011 Dimitrios Filippou
 *
 * name: LPPL url: https://latex-project.org/lppl/ name: MIT url: https://opensource.org/licenses/MIT
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const el_polyton_patterns: HyphenationTrieNode;
export default el_polyton_patterns;
