---
id: TASK-35.6
title: Add configurable per-role model overrides with Haiku as the explicit default
status: To Do
assignee: []
created_date: '2026-06-04 17:32'
updated_date: '2026-06-04 18:02'
labels: []
dependencies:
  - TASK-35.2
references:
  - vscode/src/workflow/openai_client.ts
  - vscode/src/workflow/claude_agent_client.ts
  - vscode/src/config/config_manager.ts
parent_task_id: TASK-35
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a static ConfigManager.get_model_overrides(): Partial<Record<ModelRole, string>> (matching the existing static-method pattern on the ConfigManager class — there are no free functions in config_manager.ts) reading bergamot.models.fast. Expose ONLY the fast role for now: after task-35.2 removes the tree-intentions call, no code path consumes 'smart', so a bergamot.models.smart setting would be config surface with zero effect (YAGNI / no-surplus). Thread the override through get_llm_client into the ClaudeAgentClient / OpenAIClient constructors, which merge it over their built-in maps ({...CLAUDE_MODELS, ...overrides}); replace the hardcoded CLAUDE_MODELS[role] / OPENAI_MODELS[role] access with the merged map (no parallel fallback shim). Register bergamot.models.fast in package.json contributes.configuration. Verify BERGAMOT_LLM=fake still short-circuits before any client constructor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ConfigManager.get_model_overrides() (new static method) returns Partial<Record<ModelRole, string>> from bergamot.models.fast (default undefined); 'smart' is not user-exposed (no live caller after task-35.2)
- [ ] #2 ClaudeAgentClient / OpenAIClient merge the override over their default map; hardcoded role access replaced with the merged map (no parallel fallback shim)
- [ ] #3 Resolution is unit-tested by inspecting the resolved model string directly (a pure resolve helper or constructor-exposed field) WITHOUT making any LLM call: unset -> fast resolves to haiku (Claude) / gpt-4o-mini (OpenAI); set -> the override wins
- [ ] #4 bergamot.models.fast is registered in package.json contributes.configuration with a description
- [ ] #5 BERGAMOT_LLM=fake path is unaffected and still short-circuits before any client constructor
<!-- AC:END -->
