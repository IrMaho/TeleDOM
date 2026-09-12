"""Target memory — learned targets that kill DOM re-analysis.

First run: the bot discovers targets (inspect / query / find) and SAVES what
it learned. Every later run resolves from memory with a cheap verify — no
full DOM analysis. When the UI changes, memory + find/describe give the
repair path.

    mem = TargetMemory()
    mem.save("example.com", "comments_tab", css='[data-testid="comments"]',
             identity={"role": "tab", "accessibleName": "Comments"}, confidence=0.95)
    target = mem.get("example.com", "comments_tab")
    browser.verify(target["locators"]["css"])
"""

from __future__ import annotations

from typing import Any, Optional

from .client import TeleDOMClient


class TargetMemory:
    """Learned-target persistence (the agent's own target knowledge)."""

    def __init__(
        self,
        client: Optional[TeleDOMClient] = None,
        server_path: Optional[str] = None,
        env: Optional[dict] = None,
    ):
        self._owns_client = client is None
        self._client = client or TeleDOMClient(server_path=server_path, env=env)

    def save(
        self,
        site: str,
        semantic_id: str,
        css: Optional[str] = None,
        xpath: Optional[str] = None,
        aria: Optional[str] = None,
        identity: Optional[dict] = None,
        confidence: float = 0.8,
        notes: Optional[str] = None,
    ) -> Any:
        locators: dict = {}
        if css:
            locators["css"] = css
        if xpath:
            locators["xpath"] = xpath
        if aria:
            locators["aria"] = aria
        args: dict = {
            "site": site,
            "semanticId": semantic_id,
            "locators": locators,
            "confidence": confidence,
        }
        if identity:
            args["identity"] = identity
        if notes:
            args["notes"] = notes
        return self._client.call("td_target_memory_save", args)

    def get(self, site: str, semantic_id: str) -> Any:
        return self._client.call("td_target_memory_get", {"site": site, "semanticId": semantic_id})

    def list(self, site: Optional[str] = None, semantic_id: Optional[str] = None) -> Any:
        args: dict = {}
        if site:
            args["site"] = site
        if semantic_id:
            args["semanticId"] = semantic_id
        return self._client.call("td_target_memory_list", args)

    def delete(self, site: str, semantic_id: str) -> Any:
        return self._client.call(
            "td_target_memory_delete", {"site": site, "semanticId": semantic_id}
        )

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "TargetMemory":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
