# LangGraph Agent Memory: A Learning Guide

This guide explains how to incorporate various types of memory into your LangGraph agents, drawing examples from an email assistant project.

## Introduction to Memory in LangGraph Agents

Memory allows LangGraph agents to retain and recall information from past interactions and data. This capability is crucial for building sophisticated agents that can learn, adapt, and provide contextually relevant responses. LangGraph supports different types of memory, which can be combined to create powerful applications.

The primary mechanism demonstrated in the course notebooks for managing memory is the `InMemoryStore` from `langgraph.store.memory`.

## Types of Memory and Implementation

The notebooks demonstrate three key types of memory: Semantic, Episodic, and Procedural.

### 1. Semantic Memory

Semantic memory refers to the agent's ability to understand and recall general knowledge and facts, often learned from the data it's trained on or provided with. In the context of the email assistant (Lesson 3), this involves remembering details from previous emails to inform current actions.

**Conceptual Implementation:**

While not explicitly detailed as a separate code module in the snippets, semantic memory is often implicitly handled by the LLM's underlying knowledge and how prompts are constructed to leverage this knowledge. For an agent to "remember" details semantically from previous interactions within a session or across sessions (if persisted), this information needs to be:

1.  **Stored:** Captured and saved, potentially in a structured way.
2.  **Retrieved:** Fetched when relevant to a new task.
3.  **Incorporated into Prompts:** Used to provide context to the LLM.

The `InMemoryStore` can be a part of this by holding information that contributes to the agent's semantic understanding over time.

### 2. Episodic Memory

Episodic memory relates to recalling specific past events or experiences. In LangGraph, this is often implemented as "few-shot examples" that guide the agent's behavior based on concrete past instances. Lesson 4 introduces this concept for refining email classification.

**Implementation with `InMemoryStore`:**

- **Storing Episodes (Examples):**
  You can store specific examples of inputs and their desired outcomes (labels) into the `InMemoryStore`.

  ```python
  # From Lesson 4
  from langgraph.store.memory import InMemoryStore
  import uuid

  # Initialize the store, potentially with embedding capabilities
  store = InMemoryStore(
      index={"embed": "openai:text-embedding-3-small"} # Example configuration
  )

  # Example data structure for an email episode
  email_data = {
      "email": {
          "author": "Alice Smith <alice.smith@company.com>",
          "to": "John Doe <john.doe@company.com>",
          "subject": "Quick question about API documentation",
          "email_thread": "...", # Full email content
      },
      "label": "respond" # The desired classification/action
  }

  # Storing the example
  # The tuple ("email_assistant", "user_id", "examples") acts as a key schema.
  store.put(
      ("email_assistant", "lance", "examples"), # (namespace, user_id, type_of_memory)
      str(uuid.uuid4()), # Unique ID for the memory entry
      email_data
  )
  ```

- **Retrieving and Using Episodes:**
  These stored examples can then be retrieved and formatted into prompts to guide the LLM. Lesson 5 shows how to format these examples:

  ```python
  # From Lesson 5 - Conceptual structure for formatting examples
  # (Actual retrieval from store would precede this)

  # Template for formatting an example
  example_template = """Email Subject: {subject}
  Email From: {from_email}
  Email To: {to_email}
  Email Content:
  ```

  {content}

  ```
  > Triage Result: {result}"""

  def format_few_shot_examples(examples_from_store):
      formatted_strings = ["Here are some previous examples:"]
      for eg in examples_from_store: # eg would be a retrieved memory entry
          # Assuming eg.value holds the data like 'email_data' above
          email_details = eg.value["email"]
          label = eg.value["label"]
          formatted_strings.append(
              example_template.format(
                  subject=email_details["subject"],
                  to_email=email_details["to"],
                  from_email=email_details["author"],
                  content=email_details["email_thread"][:400], # Truncate for brevity
                  result=label,
              )
          )
      return "\n\n------------\n\n".join(formatted_strings)

  # This formatted string of examples would then be included in the system prompt.
  # system_prompt = f"""...
  # < Few shot examples >
  # {format_few_shot_examples(retrieved_examples)}
  # </ Few shot examples >
  # ..."""
  ```

  This approach allows the agent to learn from specific, user-verified (via Human-in-the-Loop) examples, improving its performance on similar tasks in the future.

### 3. Procedural Memory

Procedural memory involves remembering how to perform tasks or follow procedures. In Lesson 5, this is demonstrated by allowing the user to update instructions for how the agent should use its tools (e.g., calendar or email writing tools).

**Conceptual Implementation:**

- **Storing Instructions/Preferences:**
  User preferences or updated instructions for tool usage can be stored, potentially using the `InMemoryStore` or another configuration management system.

  ```python
  # Example: Storing a user's preference for meeting scheduling
  # This is a conceptual representation; actual storage might vary.
  # store.put(
  #     ("email_assistant", "lance", "preferences"),
  #     "meeting_scheduling_rules",
  #     {"default_duration": 30, "preferred_days": ["Monday", "Wednesday"]}
  # )
  ```

- **Retrieving and Applying Instructions:**
  When the agent is about to use a tool or perform a task, it would retrieve these instructions/preferences and incorporate them into its operational logic or prompts.

  For instance, if the agent is drafting an email, it could retrieve guidelines on tone, signature, or common phrasings. If scheduling a meeting, it would use the stored preferences for duration or days.

  The system prompt in Lesson 5 includes placeholders for such instructions, which would be populated from memory:

  ```python
  # From Lesson 5 - System prompt structure
  # triage_system_prompt = """...
  # < Rules >
  # {triage_no}
  # {triage_notify}
  # {triage_email}
  # </ Rules >
  # ...
  # < Few shot examples >
  # {examples}
  # </ Few shot examples >
  # """
  # The {triage_no}, {triage_notify}, {triage_email} can be considered
  # part of procedural memory, updated as needed.
  ```

## Using `InMemoryStore`

The `langgraph.store.memory.InMemoryStore` is a versatile component for managing these types of memory.

- **Initialization:**
  `store = InMemoryStore(index={"embed": "openai:text-embedding-3-small"})`
  The `index` parameter can be used to configure embedding models if you plan to retrieve memories based on semantic similarity (though the examples focus more on direct key-based retrieval or fetching all examples of a certain type).

- **Storing Data (`put`):**
  `store.put(keys: tuple, document_id: str, data: Any)`

  - `keys`: A tuple defining the "path" or category for the memory. The notebooks use a pattern like `(namespace, user_id, memory_type)`, e.g., `("email_assistant", "lance", "examples")`.
  - `document_id`: A unique identifier for this specific piece of memory. `str(uuid.uuid4())` is a good way to generate this.
  - `data`: The actual content to be stored (e.g., a dictionary with email details and a label).

- **Retrieving Data (`get`, `cget`):**
  The notebooks primarily show storing data. For retrieval, you would use methods like `store.get(keys)` or `store.cget(keys)` (conditional get). `cget` can be particularly useful for retrieving all items under a certain key prefix (e.g., all "examples" for a user).

  ```python
  # Conceptual retrieval of all examples for "lance"
  # retrieved_examples = store.cget(("email_assistant", "lance", "examples"))
  ```

## Key Considerations for Memory in LangGraph

- **State Management:** Memory is part of the agent's state. LangGraph's architecture allows you to define how state (including memory) is passed between nodes in your graph.
- **Persistence:** `InMemoryStore` is, as the name suggests, in-memory. For long-term persistence across sessions, you would need to integrate with persistent storage solutions (e.g., databases like SQLite, vector databases for semantic search, or even flat files for simpler cases). LangGraph offers other checkpointers and store integrations for this.
- **Context Window Limits:** When using memory to augment prompts (especially with many few-shot examples or long procedural instructions), be mindful of the LLM's context window limits. You may need strategies to select the most relevant memories rather than including everything.
- **Memory Retrieval Strategies:**
  - **Recency:** Retrieving the most recent memories.
  - **Relevance (Semantic Search):** Retrieving memories most similar to the current query/context (requires embeddings).
  - **Explicit Linking:** Designing your data and retrieval logic to fetch memories explicitly linked to the current task or entities involved.
- **Human-in-the-Loop (HITL):** As shown in Lesson 4, HITL is invaluable for curating high-quality episodic memory (examples), which significantly boosts agent performance and alignment.

## Conclusion

Incorporating memory transforms LangGraph agents from stateless processors to adaptive, learning entities. By understanding and implementing semantic, episodic, and procedural memory, often facilitated by tools like `InMemoryStore` and careful prompt engineering, you can build significantly more intelligent and useful AI assistants. The key is to strategically store relevant information and retrieve it effectively to inform the agent's actions at the right time.
