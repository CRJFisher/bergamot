import { ContentFeatures } from '../memory/types';

export function extract_content_features(url: string, html_content: string): ContentFeatures {
  // Extract title
  const title_match = html_content.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = title_match ? title_match[1].trim() : new URL(url).hostname;
  
  // Extract meta description
  const meta_match = html_content.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  const meta_description = meta_match ? meta_match[1].trim() : undefined;
  
  // Remove HTML tags for text analysis
  const text_content = html_content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Count words
  const words = text_content.split(/\s+/).filter(word => word.length > 0);
  const word_count = words.length;
  
  // Check for code blocks
  const has_code_blocks = 
    /<code\b[^>]*>/.test(html_content) ||
    /<pre\b[^>]*>/.test(html_content) ||
    /```/.test(html_content) ||
    /class=["'][^"']*code[^"']*["']/.test(html_content);
  
  // Calculate link density
  const link_matches = html_content.match(/<a\b[^>]*>/gi);
  const link_count = link_matches ? link_matches.length : 0;
  const link_density = word_count > 0 ? link_count / word_count : 0;
  
  // Get content sample (first 500 chars of text)
  const content_sample = text_content.substring(0, 500);
  
  return {
    title,
    content_sample,
    word_count,
    has_code_blocks,
    link_density,
    meta_description
  };
}