"""Agent-owned workflows from Python.

    wf = Workflow("extension_smoke_test")
    wf.step("inspect",  "td_dom_inspect")
    wf.step("verify_cta", "td_target_check", selector="#primary-action-btn")
    wf.step("click",    "td_action_click", selector="{{inputs.cta}}", require_approval=False)
    wf.save(version="1.0.0")

    run = wf.run(inputs={"cta": "#primary-action-btn"})   # ONE call
    print(run["run"]["status"], run["run"]["metrics"])

TeleDOM stores and executes the workflow DUMBLY (policy gates, deterministic
records, replay). The author of the workflow — you — owns the design, the
repairs and the versioning.
"""

from __future__ import annotations

from typing import Any, Optional

from .client import TeleDOMClient

SCHEMA = "teledom.agent-workflow/1.0"


class Workflow:
    """Builder + runner for an agent-owned TeleDOM workflow."""

    def __init__(
        self,
        name: str,
        steps: Optional[list] = None,
        client: Optional[TeleDOMClient] = None,
        server_path: Optional[str] = None,
        env: Optional[dict] = None,
        description: str = "",
        tags: Optional[list] = None,
        policy: Optional[dict] = None,
    ):
        self.name = name
        self.description = description
        self.tags = tags or []
        self.policy = policy
        self.inputs: dict = {}
        self.steps: list[dict] = list(steps or [])
        self._owns_client = client is None
        self._client = client or TeleDOMClient(server_path=server_path, env=env)

    # ── authoring ──────────────────────────────────────────────────────

    def input(
        self,
        name: str,
        description: str = "",
        required: bool = False,
        default: Any = None,
    ) -> "Workflow":
        self.inputs[name] = {
            "description": description,
            "required": required,
            "default": default,
        }
        return self

    def step(
        self,
        step_id: str,
        tool: str,
        args: Optional[dict] = None,
        on_error: str = "abort",
        retry_count: int = 0,
        require_approval: bool = False,
        timeout_ms: Optional[int] = None,
        description: str = "",
    ) -> "Workflow":
        s: dict = {
            "id": step_id,
            "tool": tool,
            "onError": on_error,
            "description": description,
        }
        if args:
            s["args"] = args
        if retry_count:
            s["retry"] = {"count": retry_count}
        if require_approval:
            s["requireApproval"] = True
        if timeout_ms:
            s["timeoutMs"] = timeout_ms
        self.steps.append(s)
        return self

    def to_dict(self, version: str = "1.0.0") -> dict:
        return {
            "schema": SCHEMA,
            "id": f"{self.name}-{version}",
            "name": self.name,
            "version": version,
            "description": self.description,
            "tags": self.tags,
            "inputs": self.inputs or None,
            "steps": self.steps,
            "policy": self.policy,
            "metadata": {"author": "teledom-python-sdk"},
        }

    # ── persistence (TeleDOM stores verbatim — never interprets) ───────

    def save(self, version: str = "1.0.0") -> Any:
        return self._client.call("td_workflow_save", {"workflow": self.to_dict(version)})

    def get(self, version: Optional[str] = None) -> Any:
        args: dict = {"name": self.name}
        if version:
            args["version"] = version
        return self._client.call("td_workflow_get", args)

    def delete(self) -> Any:
        return self._client.call("td_workflow_delete", {"name": self.name})

    def diff(self, a_version: str, b_version: str) -> Any:
        return self._client.call(
            "td_workflow_diff",
            {"name": self.name, "aVersion": a_version, "bVersion": b_version},
        )

    def export(self) -> Any:
        return self._client.call("td_workflow_export", {"name": self.name})

    # ── dumb execution + records ───────────────────────────────────────

    def run(
        self,
        inputs: Optional[dict] = None,
        approved_steps: Optional[list] = None,
        dry_run: bool = False,
    ) -> Any:
        args: dict = {"name": self.name, "inputs": inputs or {}}
        if approved_steps:
            args["approvedSteps"] = approved_steps
        if dry_run:
            args["dryRun"] = True
        return self._client.call("td_workflow_run", args, timeout=300.0)

    def runs(self, limit: int = 20) -> Any:
        return self._client.call("td_workflow_runs", {"name": self.name, "limit": limit})

    def run_get(self, run_id: str) -> Any:
        return self._client.call("td_workflow_run_get", {"runId": run_id})

    def replay(self, run_id: str) -> Any:
        return self._client.call("td_workflow_replay", {"runId": run_id}, timeout=300.0)

    # ── lifecycle ──────────────────────────────────────────────────────

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "Workflow":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def workflows(client: TeleDOMClient) -> Any:
    """List all saved agent-owned workflows."""
    return client.call("td_workflow_list", {})
