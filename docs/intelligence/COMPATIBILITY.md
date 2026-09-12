# TeleDOM v4 — Compatibility Matrix (generated)

Generated: 2026-09-12T07:22:00.113Z · TeleDOM version: 4.1.0

**Surfaces**: td_=144 · dt_=54 · fx_=31 · base=47 · v3=74 · **total=350**

| Capability | Version | Implementation | Schema parity | Behavior parity | Browser support | Simulation | Test status | Experimental |
|---|---|---|---|---|---|---|---|---|
| `td_temporal_query` | 4.1.0 | src/intelligence (kernel:events + temporal:queries) | full | full | recorded+simulation | yes | PASS | no |
| `td_temporal_seek` | 4.1.0 | src/intelligence (kernel:events + temporal:queries) | full | full | recorded+simulation | yes | PASS | no |
| `td_temporal_window` | 4.1.0 | src/intelligence (kernel:events + temporal:queries) | full | full | recorded+simulation | yes | PASS | no |
| `td_temporal_diff` | 4.1.0 | src/intelligence (kernel:events + temporal:queries) | full | full | recorded+simulation | yes | PASS | no |
| `td_temporal_trace_entity` | 4.1.0 | src/intelligence (kernel:events + temporal:queries) | full | full | recorded+simulation | yes | PASS | no |
| `td_temporal_first_change` | 4.1.0 | src/intelligence (kernel:events + temporal:queries) | full | full | recorded+simulation | yes | PASS | no |
| `td_temporal_last_stable` | 4.1.0 | src/intelligence (kernel:events + temporal:queries) | full | full | recorded+simulation | yes | PASS | no |
| `td_temporal_join` | 4.1.0 | src/intelligence (kernel:events + temporal:queries) | full | full | recorded+simulation | yes | PASS | no |
| `td_temporal_branch` | 4.1.0 | src/intelligence (kernel:events + temporal:queries) | full | full | recorded+simulation | yes | PASS | no |
| `td_temporal_rewind` | 4.1.0 | src/intelligence (kernel:events + temporal:queries) | full | full | recorded+simulation | yes | PASS | no |
| `td_evidence_capture` | 4.1.0 | src/intelligence (evidence:graph + evidence:confidence) | full | full | recorded+simulation | yes | PASS | no |
| `td_evidence_search` | 4.1.0 | src/intelligence (evidence:graph + evidence:confidence) | full | full | recorded+simulation | yes | PASS | no |
| `td_evidence_chain` | 4.1.0 | src/intelligence (evidence:graph + evidence:confidence) | full | full | recorded+simulation | yes | PASS | no |
| `td_evidence_confidence` | 4.1.0 | src/intelligence (evidence:graph + evidence:confidence) | full | full | recorded+simulation | yes | PASS | no |
| `td_evidence_verify` | 4.1.0 | src/intelligence (evidence:graph + evidence:confidence) | full | full | recorded+simulation | yes | PASS | no |
| `td_evidence_hash` | 4.1.0 | src/intelligence (evidence:graph + evidence:confidence) | full | full | recorded+simulation | yes | PASS | no |
| `td_evidence_compare` | 4.1.0 | src/intelligence (evidence:graph + evidence:confidence) | full | full | recorded+simulation | yes | PASS | no |
| `td_evidence_export` | 4.1.0 | src/intelligence (evidence:graph + evidence:confidence) | full | full | recorded+simulation | yes | PASS | no |
| `td_evidence_timeline` | 4.1.0 | src/intelligence (evidence:graph + evidence:confidence) | full | full | recorded+simulation | yes | PASS | no |
| `td_evidence_proof` | 4.1.0 | src/intelligence (evidence:graph + evidence:confidence) | full | full | recorded+simulation | yes | PASS | no |
| `td_cause_trace` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_cause_graph` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_cause_rank` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_cause_explain` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_cause_correlate` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_cause_breakpoint` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_cause_impact` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_cause_dependency` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_cause_counterfactual` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_cause_verify` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_semantic_page` | 4.1.0 | src/intelligence (semantics:semantic-engine) | full | full | recorded+simulation | yes | PASS | no |
| `td_semantic_element` | 4.1.0 | src/intelligence (semantics:semantic-engine) | full | full | recorded+simulation | yes | PASS | no |
| `td_component_map` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_component_lifecycle` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_component_dependencies` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_component_state` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_accessibility_model` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_visual_semantics` | 4.1.0 | src/intelligence (semantics:semantic-engine) | full | full | recorded+simulation | yes | PASS | no |
| `td_page_intent` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_state_summary` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_resolve_target` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_rank_targets` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_recover` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_verify` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_history` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_contract` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_interaction_plan` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_interaction_execute` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_interaction_observe` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_interaction_repair` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_simulate_change` | 4.1.0 | src/intelligence (temporal:branching + simulation:counterfactual) | full | full | recorded+simulation | yes | PASS | no |
| `td_simulate_network` | 4.1.0 | src/intelligence (temporal:branching + simulation:counterfactual) | full | full | recorded+simulation | yes | PASS | no |
| `td_simulate_dom` | 4.1.0 | src/intelligence (temporal:branching + simulation:counterfactual) | full | full | recorded+simulation | yes | PASS | no |
| `td_simulate_style` | 4.1.0 | src/intelligence (temporal:branching + simulation:counterfactual) | full | full | recorded+simulation | yes | PASS | no |
| `td_simulate_runtime` | 4.1.0 | src/intelligence (temporal:branching + simulation:counterfactual) | full | full | recorded+simulation | yes | PASS | no |
| `td_simulate_failure` | 4.1.0 | src/intelligence (temporal:branching + simulation:counterfactual) | full | full | recorded+simulation | yes | PASS | no |
| `td_compare_branches` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_predict_impact` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_safe_apply` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_branch_merge` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_health_snapshot` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_recover_browser` | 4.1.0 | src/intelligence (resilience:guardian) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_recover_page` | 4.1.0 | src/intelligence (resilience:guardian) | full | full | recorded+simulation | yes | PASS | no |
| `td_recover_bridge` | 4.1.0 | src/intelligence (resilience:guardian) | full | full | recorded+simulation | yes | PASS | no |
| `td_reconcile_tabs` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_reconcile_events` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_resource_guard` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_leak_watch` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_failure_containment` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_session_repair` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_security_posture` | 4.1.0 | src/intelligence (security:analyzers + security:zero-trust) | full | full | recorded+simulation | yes | PASS | no |
| `td_security_surface` | 4.1.0 | src/intelligence (security:analyzers + security:zero-trust) | full | full | recorded+simulation | yes | PASS | no |
| `td_security_flow` | 4.1.0 | src/intelligence (security:analyzers + security:zero-trust) | full | full | recorded+simulation | yes | PASS | no |
| `td_dom_xss_audit` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_injection_surface_audit` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_auth_session_audit` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_cookie_storage_audit` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_csp_security_audit` | 4.1.0 | src/intelligence (security:analyzers + security:zero-trust) | full | full | recorded+simulation | yes | PASS | no |
| `td_cors_security_audit` | 4.1.0 | src/intelligence (security:analyzers + security:zero-trust) | full | full | recorded+simulation | yes | PASS | no |
| `td_security_regression` | 4.1.0 | src/intelligence (security:analyzers + security:zero-trust) | full | full | recorded+simulation | yes | PASS | no |
| `td_performance_profile` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_performance_budget` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_long_task_trace` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_layout_causality` | 4.1.0 | src/intelligence (causality:engine + evidence:graph) | full | full | recorded+simulation | yes | PASS | no |
| `td_memory_profile` | 4.1.0 | src/intelligence (agent:memory) | full | full | recorded+simulation | yes | PASS | no |
| `td_memory_leak_trace` | 4.1.0 | src/intelligence (agent:memory) | full | full | recorded+simulation | yes | PASS | no |
| `td_retention_graph` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | YES |
| `td_visual_regression` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_visual_causality` | 4.1.0 | src/intelligence (causality:engine + evidence:graph) | full | full | recorded+simulation | yes | PASS | no |
| `td_render_stability` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_investigate` | 4.1.0 | src/intelligence (incident:investigation + causality:engine + simulation:counterfactual + verification:proof) | full | full | recorded+simulation | yes | PASS | no |
| `td_reproduce_incident` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_diagnose` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_plan_fix` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_validate_fix` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_run_workflow` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_run_playbook` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_memory` | 4.1.0 | src/intelligence (agent:memory) | full | full | recorded+simulation | yes | PASS | no |
| `td_context_optimize` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_incident_close` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_browser_navigate` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_browser_back` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_browser_forward` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_browser_refresh` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_dom_inspect` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_dom_query` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_dom_extract` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_dom_snapshot` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_find` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_check` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_describe` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_action_click` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_action_type` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_action_select` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_action_hover` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_action_press` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_action_scroll` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_wait` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_screenshot` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | no | PASS | no |
| `td_execute_script` | 4.1.0 | src/intelligence (kernel:events) | full | full | live+recorded+simulation | yes | PASS | no |
| `td_network_inspect` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_console_read` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_save` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_get` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_list` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_update` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_clone` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_diff` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_export` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_import` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_validate` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_run` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_runs` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_run_get` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_replay` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_workflow_delete` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_memory_save` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_memory_get` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_memory_list` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_target_memory_delete` | 4.1.0 | src/intelligence (targeting:target-intelligence) | full | full | recorded+simulation | yes | PASS | no |
| `td_agent_artifact_save` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_agent_artifact_get` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_agent_artifact_list` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
| `td_agent_artifact_delete` | 4.1.0 | src/intelligence (kernel:events) | full | full | recorded+simulation | yes | PASS | no |
