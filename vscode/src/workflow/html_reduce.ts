/**
 * Reduces raw page HTML to the meaningful markup worth sending to the
 * content-extraction LLM.
 *
 * The browser captures `document.body.outerHTML` (up to ~2 MB), most of which is
 * non-content bulk: `<script>` payloads (e.g. a Next.js `__NEXT_DATA__` JSON
 * blob), `<style>` rules, inline `<svg>`, `<template>` fragments, base64 `data:`
 * URIs, and HTML comments. Sending that verbatim overruns the model's
 * prompt-length limit ("Prompt is too long"), so it is stripped here first.
 *
 * The visible text and structural tags the extraction prompt relies on are kept;
 * only zero-information bulk is removed. A hard char cap is the final safety net
 * so a pathologically large page can never exceed the prompt budget.
 */

/** Upper bound on content handed to the LLM. ~25-30k tokens, safely under the
 * subscription model's prompt limit while still covering long-form articles. */
export const MAX_LLM_CONTENT_CHARS = 100_000;

export interface ReducedHtml {
  /** The reduced (and possibly truncated) markup to send to the LLM. */
  content: string;
  /** Character length of the original HTML, before reduction. */
  original_length: number;
  /** True when the reduced content was clipped to {@link MAX_LLM_CONTENT_CHARS}. */
  truncated: boolean;
}

// Whole elements whose contents carry no extractable page content. The
// backreference matches the corresponding closing tag; lazy `[\s\S]*?` stops at
// the first close, which is correct for these non-self-nesting noise elements.
const NOISE_ELEMENT_PATTERN =
  /<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

// Inline base64 payloads on surviving tags (e.g. `src="data:image/png;base64,..."`).
// The extraction prompt only keeps http(s) image links, so dropping these is safe.
const DATA_URI_ATTR_PATTERN = /\b(src|href)\s*=\s*(["'])data:[^"']*\2/gi;

export function reduce_html_for_llm(html: string): ReducedHtml {
  const original_length = html.length;

  let reduced = html
    .replace(NOISE_ELEMENT_PATTERN, " ")
    .replace(HTML_COMMENT_PATTERN, " ")
    .replace(DATA_URI_ATTR_PATTERN, "$1=$2$2");

  // Collapse the whitespace runs left behind by stripped elements so the char
  // budget is spent on content, not blank space. Horizontal whitespace
  // collapses to a single space; blank-line runs collapse to one blank line.
  reduced = reduced
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const truncated = reduced.length > MAX_LLM_CONTENT_CHARS;
  if (truncated) {
    reduced = reduced.slice(0, MAX_LLM_CONTENT_CHARS);
  }

  return { content: reduced, original_length, truncated };
}
