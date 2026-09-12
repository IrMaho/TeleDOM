"""TeleDOM Python SDK — Level 2 (Bot → SDK → Browser Runtime).

Two connection levels share one browser runtime:

    Level 1 — MCP:    AI Agent  →  MCP  →  TeleDOM
    Level 2 — SDK:   Python Bot →  SDK  →  TeleDOM (this package)

Philosophy (v4.1 — Agent-Owned):
    TeleDOM is the enabler — hands, eyes, memory and browser toolbox.
    The agent (or the bot author) is the brain. This SDK exposes the SAME
    primitives the MCP surface exposes: semantic browser programming, not
    Selenium-style selector soup.

    from teldom import Browser

    browser = Browser()
    browser.navigate("https://example.com")
    target = browser.find(selector="#comments")
    browser.click(target)
    browser.verify(...)

Browser-first: no site API is ever required. Works on any website a human
can operate — social networks, CRMs, ERPs, admin panels, government portals,
internal tools, sites with no public API at all.
"""

from .browser import Browser
from .client import TeleDOMClient, TeleDOMError
from .targets import TargetMemory
from .workflow import Workflow, workflows

__version__ = "4.1.0"

__all__ = [
    "Browser",
    "TargetMemory",
    "TeleDOMClient",
    "TeleDOMError",
    "Workflow",
    "__version__",
    "workflows",
]
