# PKM Assistant

A browser extension that intelligently organizes web content into your personal knowledge management system. It automatically analyzes webpages, suggests relevant projects, and helps maintain a structured collection of web-based knowledge.

## Features

- **Intelligent Webpage Analysis**: Automatically extracts and analyzes content from visited webpages
- **Smart Categorization**: Suggests relevant projects and notes for organizing web content
- **Browsing Trees**: Detects and organizes related browsing sessions
- **MCP Integration**: Exposes webpage history through Model Context Protocol for AI agents
  - Semantic search across browsing history
  - Full content retrieval for specific pages

## MCP Tools

The extension includes an MCP server that exposes two tools for AI agents:

### semantic_search
Search through your browsing history using semantic similarity. Returns relevant webpages based on your query.

### get_webpage_content
Retrieve the full markdown content of a specific webpage by its session ID.

See [MCP Tools Usage Guide](backlog/docs/mcp-tools-usage.md) for detailed documentation.

## TODO

### Change of priorities - remove agentic features, include MCP

#### Fixes

- [ ]  Problem: page summaries etc are getting distorted by filler.
    - [ ] Easy option: add a step in page analysis which strips the page of all the extra crap e.g. cookies notice, random header nonsense etc. Use a cheap model e.g. 4.1 nano
    - [ ] More complex option: compress the entire body html contents and send over the wire. Then use cheap model to parse into md format
- [ ] MarkdownDB
    - [ ] Fix the upsert for when trees change. 

### Ship v0

#### Core Features

- [x] Move LLMs over to use vscode-inbuilt LLM calling
- [ ] Browsing Trees
    - [x] Detect browsing trees using page domain, referrer and visit time

      - This will help to log pages in a concise way for downstream tasks
      - Store basic navigation data (domain, URL, referrer, timestamp, session context)
    - [ ] Webpage Operations

      - Summarise and detect intentions of each webpage (in isolation and later in context of the tree)
          - In later work, include existing, high-level user intentions to help steer the intentions
    - [ ] Tree Operations

      - Split
          - Split trees up if implied intentions change e.g. researching a product (business intel) -> checking their careers page (job search / business intel)
          - Determine the most meaningful entry point for a browsing session
              - Example: `reddit.com` is too high level, but `reddit.com/r/learnpython` followed by related links forms a coherent group 
          - Add url to aggregator 'ignore' list
      - Plan and perform these operations with an agentic loop using planning and reflection
- [ ] Webpage Grouping System
    - [ ] User Intent Analysis

      - Analyze browsing patterns to determine user intentions (learning, researching, planning, etc.)
      - Use page content, dwell time, and navigation patterns as signals
      - Store intent classifications for improving future grouping
    - [ ] Data Storage & Processing
        - [ ] Store grouped page data in DB with metadata
        - [ ] Optionally display page groups in markdown format
        - [ ] Vectorize entire webpage groups for semantic linking to notes
- [ ] Front Page Enhancement

  - Make Front Page optional with initial setup prompt
  - If page exists, append new sections rather than overwriting
    - [x] Recent notes display
        - [ ] Add Inlay Hints showing last update time
    - [x] Suggested notes based on visited pages with refresh capability
        - [ ] Add Inlay Hints showing number of related pages visited
- [ ] In-note suggestions
    - [ ] Show a dropdown with the tick-box list of related webpage groupings

      - Format: `[ ] Group Name (N pages, N.n minutes active)`
    - [ ] Second step: include a text box for instructsions about how to integrate
        - [ ] Button to show the "guess" integration instructions

          - Possibly just do this automatically
    - [ ] Confirm button to add the group(s) to the note

#### Bugs / Essential improvements

- [x] Fall back to OpenAI if VSCode LLM API not available
- [ ] Create a transaction / batch op for markdown db to avoid updating the file so much
    - [ ] Fix the bug where the suggestions list disappears
- [ ] To keep the vector DB up to date, keep track of last update time, then check if any of the project files have been updated since then. If so, update them in the vector DB.

### MVP

- Interface
    - VSCode extension
- Run a python server to host the LangGraph app
- When a new page comes in
    - Check if websites already exist in projects or the list of suggested websites. Skip if so.
    - If not, run the workflow and add it to the list of suggested websites.
- Highlight suggestions in the editor
- Add a "confirm" button to move all the suggestions to their projects

#### Finishing bits before YC application demo

- Confirm UI
    - Webpage categorisation:
        - [x] Add to note
        - [ ] ~~Give feedback~~
            - [ ] ~~Update the note's Title / Description in order to improve note matching in future~~
        - [x] Delete
    - Note proposal:
        - [x] Create note
        - [x] Delete
- Add agentic memory to improve project-matching over time
    - [x] When proposing projects, use a vector search to find the most similar projects and add them to a "linked" section (aka semantic memory)
        - Make the agent review the linked projects and decide if they should be merged or linked
        - Rank by similarity and recency
            - This didn't work well, so instead just show
    - [ ] Based on feedback in the suggestions list, detect whether to update the:
        - [ ] Note Description to say what goes in or stays out(i.e. episodic memory)
        - [ ] Update the user's preference in the prompt (procedural memory)
            - Could make this topic-based or gloabl prefenerences
- ~~[ ] Add deep research follow-on after user edits the spec and confirms a suggested project~~
- [x] Remove the `Projects` from the context in the project-proposals prompt
- [x] Add the webpage summaries to the context in the project-proposals prompt
- Fix markdown operations
    - [x] For webpage->project and new-project propsals objects, use separate, companion objects for LLM and state
    - [x] Include visited-at (array if more than once)
    - [x] WebCategorisations don't include projects
    - [x] Create a more robust markdown database
    - [ ] Webpage categorisations don't leave a blank line at the end
- [ ] Add confirm functionality to Front Page
- [x] Read the current suggestions list from the project file and add it to the initial state of the workflow
- [x] On first run, add the current suggestions list to the project. Or, save the workflow state to a storeage provider e.g. sqlite (although these would need to be removed when the user accepts or deletes the suggestions).
- [ ] Limit the number of existing projects and suggested projects used in the project-matching prompt - rank by similarity and recency.
- [ ] Use 4.1-nano to classify if a page is to be ignored or used
    - Output the reason and add to Front Page to a "filtered out" section

#### Agentic memory

- [x] Put all the project names + descriptions into the vector DB

  - Add a check at startup to see if the vector DB is empty. If so, add all the project names + descriptions.
  - Can results be ranked based on a combination of recency and similarity?
- [ ] Notes / projects (titles and descriptions) are treated as semantic memory
- [ ] Feedback to the proposed projects is stored as episodic memory

#### HITL server loop

- [x] Server endpoint contains a task list to be processed
- [x] On startup, it gets the list of recent edited documents and treats as a list of projects
- [x] The Agent then works in an interupt-loop:
    - [x] On each page load, the agent considers the webpage's project and reconsiders the previous webpages' project suggestions
    - [x] If a new theme emerges, it consolidates the project suggestions into a new sub-section of the `## Suggestions` heading

      - It adds a description under the heading and then the links with their connection to the project
      - The theme can also evolve over time, so the agent will also update the description as needed

- Removed HITL loop because of bugs, just look up current proposals state every run.
    - Bug fix was to either keep the MemorySaver checkpointer in the closure outside each POST request or to use a persistant checkpointer e.g. Sqlite
    - Given that the user can update the state from the Front Page manually, the state needs to sync with that page regularly anyway.

### Decisions

- Use a python server or vscode-extension TS for langgraph app?
    - Python server is better for other ML tasks e.g. clustering
    - TS is better for integration with extension e.g. when debugging
    - Resolution: use TS for expediency. Can always use e.g. python containers if needed.
- Where to store all the metadata genereated by the agent? Sqlite, metadata companion files for each note?

### Possiblities with Topic Hierarchy

- Timeline page showing page (or page group aka time + topic page clusters) vists next to their likely projects / topics. Then show options to merge into or create a new note
- Instead of suggesting new notes, match visited pages to topics

#### Implementation

- Use hierarchical BerTopic to create topic structure akin to NotbookLM mind-map 
- Perform incremental topic modelling with LLM as new pages come in, similar to building up agent memory

### Follow-ons

- To improve referrer detection, send the server a request when the user clicks a link.
- To improve note-proposal, we need to infer the user's intentions over time
    - For each "group" of notes and website visits, guess the intentions
    - Refine these intentions with an LLM call outputting a table with (left to right) columns:
        - the full set of intensions
        - refined, deduplicated set of intentions
        - parent intentions
        - refined, deduplicated parent intentions
        - parent intentions (if any)
        - refined, deduplicated parent intentions (if any)
- Store each workflow invocation's state as key'ed in the workflow state. Then we can recreate the full context of any query at any time e.g. for improving the agent memory
- Total rethink on the UI
    - How to handle the large number of suggestions? Not a problem in the sense of wanting to store a log of all visited websites. But it becomes unweildy as a suggestions page.
    - The context of all categorisations and note proposals becomes too much.
    - We don't want to "pollute" notes' backlinks with all the link suggestions.
    - On the Front Page, instead show Recent notes and Suggested notes (based on visited pages):
        - When the user goes to a note, it shows the suggested notes for that page.
- In suggestions_page_decorations.ts, use markdown_db to access the note's body. Might require adding some metadata to the markdown entities for the document positions.
    - First decide on the new UI as this could shake up markdown_db
- What if the user doesn't want to use the prescribed note structure (which contains the data needed for the functionality)?
    - Keep the data they don't want to see in a companion file. Downside is they won't be able to edit that data as easily.
- Track intention networks through time and accross notes
    - E.g. during webpage categorisation, make guesses at the user's intentions, then refine these over time. Use Bayesian updates to update the user's implicit intention probabilities
- The user's preference of what should go into a note should be tracked by procedural memory
- Separate notes into two types. Use intention detection to determine which type each note is.
    - Concepts and knowledge (slow notes)
    - Action-based notes / projects (fast notes)
- Need to keep the project-name-description embeddings up to date as the files are updated
- Include intention detection to suggestions page
    - Every note should include its intentions e.g. as tags; as well as a description which is used for lookup
    - These bits of metadata are then updated as the note evolves in order to improve the lookup
- Apply Deep Research pattern to performing background research on projects, keeping them evergreen
- When user provides feedback showing the workflow "failed":
    - Start a self-healing feedback loop where:
        - The note is redrafted (title and description) to something that would have a better chance of success
        - The workflow is run again with the new name
        - If it still fails, repeat with a new name
    - If some insight can be gleaned from the failure, update the agent memory (1. extra content from vector search, 2. in-context examples 3. update the system prompt)
- Make the Markdown-DB extensible so that future PKM tools (including user-led customisations) can build on top of it.
- Planning + tool-use to determine how to parse the webpage
- Instead of just looking at the current webpage, also scrape the surrounding webpages (at the same domain) to add context
- Include the previous visited pages' summaries and project suggestions in the suggestion-categorization context
    - Choose latest N ranked by visit time and similarity (and proximity to the current page in browser if possible e.g. window location)
        - If a pattern / grouping emerges, update the category suggestion for the previous pages also
    - Keep the agent running in a permanent loop with each new request coming in as a new Command to resume the agent
        - N.B. what if requests come in too fast? Can they be queued?
- More advanced project-matching
    - let an agent decide which pages / sections to read in more detail then decide how webpage content can be integrated
    - combine with PKM structuring where organisational suggestions can be made
- Deal with "ignore" websites (specific pages and domains)
    - Option on suggestions list to ignore a website.
    - Prompt user to describe why it should be ignored
    - Tool use to then create: regex(s), filter prompt or code to ignore the page
- List the ignored websites in a section at the bottom of the "Front Page".
- Validate section selection in suggestions list. If it doesn't exist, add a '+' icon indicating it will be added.
- Consider the "surrounding webpages" i.e. based on visit time and referral links when determining the project
- Use Agent memory to remember the project and use vector search to find possible matches
- Just parsing the webpage gets useful information when it's a content-heavy page. For interaction-heavy pages, we need to monitor those interactions to determine user's intentions.
    - Also record the time the page was first navigated to send it to the agent (so we know the true order of page opens)
    - Process the page when it seems the user has finished interacting with it. Then we have a complete picture of what happened while on the page.
        - Alternatively, if there is some browser interaction API, we could do partial HITL processing as the user is interacting with the page.
- When the user opens a note / project, display the suggestions for this page (as another workflow for confirming the suggestions)
- On confirmation page, optionally perform a deep-dive, interactive analysis to determine the best way to integrate the insights from the page into the project

## Checkpoints

### v0.0

Use a basic LangGraph workflow to classify the content of a webpage into one a list of categories (or suggest a new one). First end-to-end workflow.

- [ ] Even 4o doesn't seem to suggest a new category, just suggests one of the existing ones.

  - Maybe this would improve with more categories, but then how would we deal with the case where the user is getting started?
  - Test solution 1: use a first initial prompt to detect intentions in the webpage, then feed these into a second prompt to classify the webpage into one of the existing categories (or suggest a new one).
      - Seems to work better.
- [x] Debug HITL feedback loop
- [ ] Improve HITL feedback loop

  - Create an extension to host the list of suggestions, like a "home" page to review the suggested categories and enable edits.
- [ ] Need to add other file-based tools e.g. add items to suggestions list

### v0.1

MVP for YC Application

- Website categorisation
    - Lots of unwanted websites in the suggestions list
        - Need filtering to remove these
    - No way to mark as 'done' and get rid of it
- Note proposals
    - Repeating (bug?)
    - Don't have a good sense of the user's big picture intentions

### v0.2

Show recommended notes in home page (instead of every visited webpage) and suggest webpages in note.

- Now instead of seeing too much, we don't see enough about the websites we visited.
- VSCode's LLM calls seem to be always failing - fall back to OpenAI
- This isn't enough of a product on its own, so need to add more functionality
- There's a choice between either implementing a MCP server (and enhancing the IDE Agent) or improving existing, standalone functionality e.g. detecting page groups.
    - Choosing to continue with the standalone functionality for now as we're building a dataset that could be used for many other tasks, including exposing as a resource to the MCP server.