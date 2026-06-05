---
id: TASK-31.10
title: Add configurable per-role model overrides with Haiku as the explicit default
status: To Do
assignee: []
created_date: "2026-06-04 17:32"
updated_date: "2026-06-05"
labels: []
dependencies: []
references:
  - vscode/src/workflow/openai_client.ts
  - vscode/src/workflow/claude_agent_client.ts
  - vscode/src/config/config_manager.ts
parent_task_id: TASK-31
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Moved from task-35.6. The capture epic (task-35) made ingestion zero-LLM, so a configurable model override had no live consumer there (YAGNI). It belongs with task-31, which reintroduces LLM calls for the RAG-prep pipeline.

Add a static ConfigManager.get_model_overrides(): Partial<Record<ModelRole, string>> (matching the existing static-method pattern on the ConfigManager class) reading bergamot.models.fast, and thread it through get_llm_client into the ClaudeAgentClient / OpenAIClient constructors, which merge it over their built-in maps. This config governs the model used by the RAG-prep pipeline and any other LLM feature, so Haiku is the explicit configurable default for the live 'fast' role. Expose only the fast role for now (the 'smart' key is reserved but has no caller — YAGNI). Register bergamot.models.fast in package.json. Verify BERGAMOT_LLM=fake still short-circuits before any client constructor.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 ConfigManager.get_model_overrides() (new static method) returns Partial<Record<ModelRole, string>> from bergamot.models.fast (default undefined); 'smart' is not user-exposed (no live caller)
- [ ] #2 ClaudeAgentClient / OpenAIClient merge the override over their default map; hardcoded role access replaced with the merged map (no parallel fallback shim)
- [ ] #3 Resolution is unit-tested by inspecting the resolved model string directly (a pure resolve helper or constructor-exposed field) WITHOUT making any LLM call: unset -> fast resolves to haiku (Claude) / gpt-4o-mini (OpenAI); set -> the override wins
- [ ] #4 bergamot.models.fast is registered in package.json contributes.configuration with a description
- [ ] #5 BERGAMOT_LLM=fake path is unaffected and still short-circuits before any client constructor
<!-- AC:END -->
