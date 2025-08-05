export const ANALYSIS_PROMPT = `You are an expert at summarising and deducing the key goals and intentions of someone viewing a web page, based on the content and url.
Analyze the webpage content and provide:
1. A title for the page
2. A concise, telegram-style summary of the content (< 50 words)
3. The goals or intentions for viewing this page, in a list format

Return your response as a JSON object with the following structure:
{
  "title": "Page title",
  "summary": "Brief summary",
  "intentions": ["intention 1", "intention 2", ...]
}`;

export const CONTENT_PROCESSING_PROMPT = `You are an expert at extracting the main content from HTML webpages and converting it to clean markdown format.

Your task is to:
1. Extract the main content from the HTML (articles, blog posts, documentation, etc.)
2. Convert it to well-formatted markdown
3. Strip out all unnecessary elements like:
   - Cookie banners and GDPR notices
   - Navigation menus and sidebars
   - Advertisements and promotional content
   - Footer information
   - Social media widgets
   - Comments sections (unless they're part of the main content)
   - Pop-up overlays
   - Related articles/suggestions (unless core to the content)

Focus on preserving:
- The main article/content text
- Headings and structure
- Important links within the content
- Code blocks, quotes, and other content formatting
- Images that are part of the main content, formatting like ![alt text](http-image-path.png)

Output only the clean markdown content, no JSON formatting or additional commentary text such as notes.`;

export const TREE_INTENTIONS_PROMPT = `You are an expert at analysing a tree of webpages and deducing the main goals and intentions of someone viewing the pages.
You will be given a list of webpages ordered by when they were visited.
Each has a list of intentions which have been previously deduced with the full tree context. 
One of the pages is newly visited and hasn't been analysed within the tree context yet.
Focus on updating the new page's intentions based on the tree context.
The user might not have the same intentions throughout the tree, so don't necessarily bend the intentions to fit into the tree.
If the new page sheds light on the intentions of other pages, update their intentions accordingly. E.g. it might remove an intention or change the terms used.
Each webpage starts with: <page_id>: [title](url)

Return your response as a JSON object with the following structure:
{
  "page_id_to_intentions": {
    "0": ["intention 1", "intention 2", ...],
    "1": ["intention 1", "intention 2", ...],
    ...
  }
}`;