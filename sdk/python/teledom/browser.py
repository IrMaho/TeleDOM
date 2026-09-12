"""Semantic Browser programming — the TeleDOM Level-2 primitive surface.

browser = Browser()                # spawns + connects TeleDOM
browser.navigate("https://any.site")   # any website — API never required
page = browser.inspect()           # observe (the agent's eyes)
hits = browser.query("Comments")   # find elements without selectors
target = browser.find(selector="#reply-box")
browser.click(target)
browser.type(target, "hello")
browser.verify(selector="#sent")
"""

from __future__ import annotations

from typing import Any, Optional

from .client import TeleDOMClient, TeleDOMError


class Browser:
    """Semantic browser programming over the TeleDOM runtime."""

    def __init__(
        self,
        server_path: Optional[str] = None,
        env: Optional[dict] = None,
        client: Optional[TeleDOMClient] = None,
    ):
        self._client = client or TeleDOMClient(server_path=server_path, env=env)

    # ── lifecycle ──────────────────────────────────────────────────────

    @property
    def client(self) -> TeleDOMClient:
        return self._client

    @property
    def server_info(self) -> dict:
        return self._client.server_info

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "Browser":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # ── raw escape hatch: ANY of the 350 tools ─────────────────────────

    def tool(self, name: str, arguments: Optional[dict] = None) -> Any:
        return self._client.call(name, arguments)

    # ── navigation ─────────────────────────────────────────────────────

    def navigate(self, url: str, new_tab: bool = False, wait_for_stable: bool = True) -> Any:
        return self._client.call(
            "td_browser_navigate",
            {"url": url, "newTab": new_tab, "waitForStable": wait_for_stable},
        )

    def back(self) -> Any:
        return self._client.call("td_browser_back", {})

    def forward(self) -> Any:
        return self._client.call("td_browser_forward", {})

    def refresh(self) -> Any:
        return self._client.call("td_browser_refresh", {})

    # ── observation ────────────────────────────────────────────────────

    def inspect(self) -> Any:
        """Observe the current page (structure, state, interactive inventory)."""
        return self._client.call("td_dom_inspect", {})

    def query(self, text: str, tag: Optional[str] = None, limit: int = 50) -> Any:
        """Search the DOM by text/tag — find elements without knowing selectors."""
        args: dict = {"query": text, "limit": limit}
        if tag:
            args["tag"] = tag
        return self._client.call("td_dom_query", args)

    def extract(self, selector: str, fields: Optional[dict] = None, limit: int = 100) -> Any:
        """Extract structured data from any selector (works on ANY site)."""
        args: dict = {"selector": selector, "limit": limit}
        if fields:
            args["fields"] = fields
        return self._client.call("td_dom_extract", args)

    def snapshot(self, fmt: str = "html") -> Any:
        return self._client.call("td_dom_snapshot", {"format": fmt})

    # ── targeting ──────────────────────────────────────────────────────

    def find(
        self,
        selector: Optional[str] = None,
        xpath: Optional[str] = None,
        text: Optional[str] = None,
    ) -> Any:
        """Find an element by selector / xpath / text → canonical TARGET with confidence."""
        args: dict = {}
        if selector:
            args["selector"] = selector
        elif xpath:
            args["xpath"] = xpath
        elif text:
            args["text"] = text
        else:
            raise TeleDOMError("find() requires selector, xpath or text")
        return self._client.call("td_target_find", args)

    def verify(self, selector: str, min_confidence: float = 0.0) -> Any:
        """Cheap target verification — replaces full DOM re-analysis."""
        return self._client.call(
            "td_target_check", {"selector": selector, "minConfidence": min_confidence}
        )

    def describe(self, selector: str) -> Any:
        return self._client.call("td_target_describe", {"selector": selector})

    # ── interaction ────────────────────────────────────────────────────

    def click(self, selector: str) -> Any:
        return self._client.call("td_action_click", {"selector": selector})

    def type(self, selector: str, text: str) -> Any:
        return self._client.call("td_action_type", {"selector": selector, "text": text})

    def select(self, selector: str, value: str) -> Any:
        return self._client.call("td_action_select", {"selector": selector, "value": value})

    def hover(self, selector: str) -> Any:
        return self._client.call("td_action_hover", {"selector": selector})

    def press(self, key: str) -> Any:
        return self._client.call("td_action_press", {"key": key})

    def scroll(self, x: int = 0, y: int = 0, selector: Optional[str] = None) -> Any:
        args: dict = {"x": x, "y": y}
        if selector:
            args["selector"] = selector
        return self._client.call("td_action_scroll", args)

    def wait(self, kind: str, timeout_ms: int = 5000, **kwargs: Any) -> Any:
        """Wait for a meaningful condition: dom_stable, selector_present, …"""
        args: dict = {"kind": kind, "timeoutMs": timeout_ms}
        args.update({k: v for k, v in kwargs.items() if v is not None})
        return self._client.call("td_wait", args)

    # ── evidence + escape hatches ───────────────────────────────────────

    def screenshot(self) -> Any:
        return self._client.call("td_screenshot", {})

    def execute_script(self, code: str, timeout_ms: Optional[int] = None) -> Any:
        args: dict = {"code": code}
        if timeout_ms:
            args["timeoutMs"] = timeout_ms
        return self._client.call("td_execute_script", args)

    def network(self, url_contains: Optional[str] = None, limit: int = 50) -> Any:
        return self._client.call(
            "td_network_inspect", {"urlContains": url_contains, "limit": limit}
        )

    def console(self, level: str = "all") -> Any:
        return self._client.call("td_console_read", {"level": level})
