/**
 * @license
 *
 * Hyphenation patterns for Bengali (bn)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 2016 Santhosh Thottingal
 *
 * name: MIT url: https://opensource.org/licenses/MIT text: > Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. name: LGPL version: 3 or_later: true url: http://www.gnu.org/licenses/lgpl.html name: GPL version: 3 or_later: true url: http://www.gnu.org/licenses/gpl.html
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const bn_patterns: HyphenationTrieNode;
export default bn_patterns;
