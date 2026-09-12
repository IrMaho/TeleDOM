"""TeleDOM MCP stdio client — pure stdlib, zero dependencies.

Spawns the TeleDOM MCP server (`node bin/mcp-server.js`), speaks JSON-RPC 2.0
over its stdio pipes and exposes a minimal `call(name, arguments)` surface.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
from typing import Any, Optional


class TeleDOMError(RuntimeError):
    """Raised when a tool call reports an error or the transport fails."""

    def __init__(self, message: str, payload: Optional[dict] = None):
        super().__init__(message)
        self.payload = payload or {}


class TeleDOMClient:
    """JSON-RPC 2.0 stdio client for a TeleDOM MCP server subprocess."""

    def __init__(
        self,
        server_path: Optional[str] = None,
        cwd: Optional[str] = None,
        env: Optional[dict] = None,
        node_binary: str = "node",
    ):
        self.server_path = (
            server_path or os.environ.get("TELEDOM_SERVER_PATH") or self._default_server_path()
        )
        self.cwd = cwd
        self._proc: Optional[subprocess.Popen] = None
        self._env = env
        self._node = node_binary
        self._id_counter = 0
        self._responses: "queue.Queue[dict]" = queue.Queue()
        self._reader_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self.server_info: dict = {}
        self._start()

    # ── lifecycle ──────────────────────────────────────────────────────

    @staticmethod
    def _default_server_path() -> str:
        env = os.environ.get("TELEDOM_SERVER_PATH")
        if env:
            return env
        # sdk/python/teledom → repo root/bin/mcp-server.js
        here = os.path.dirname(os.path.abspath(__file__))
        candidate = os.path.abspath(os.path.join(here, "..", "..", "..", "bin", "mcp-server.js"))
        if os.path.exists(candidate):
            return candidate
        return "bin/mcp-server.js"

    def _start(self) -> None:
        full_env = dict(os.environ)
        if self._env:
            full_env.update(self._env)
        self._proc = subprocess.Popen(
            [self._node, self.server_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=self.cwd,
            env=full_env,
        )
        self._reader_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader_thread.start()
        init = self.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "teledom-python-sdk", "version": "4.1.0"},
            },
        )
        self.server_info = init.get("serverInfo", {})
        self.notify("notifications/initialized", {})

    def _read_stdout(self) -> None:
        assert self._proc and self._proc.stdout
        for line in iter(self._proc.stdout.readline, b""):
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "id" in msg:
                self._responses.put(msg)
        self._responses.put(
            {
                "jsonrpc": "2.0",
                "id": -1,
                "error": {"message": "server closed the stream"},
            }
        )

    def _next_id(self) -> int:
        with self._lock:
            self._id_counter += 1
            return self._id_counter

    # ── raw protocol ───────────────────────────────────────────────────

    def request(self, method: str, params: Optional[dict] = None, timeout: float = 60.0) -> dict:
        rid = self._next_id()
        payload = {
            "jsonrpc": "2.0",
            "id": rid,
            "method": method,
            "params": params or {},
        }
        assert self._proc and self._proc.stdin
        self._proc.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
        self._proc.stdin.flush()
        while True:
            try:
                msg = self._responses.get(timeout=timeout)
            except queue.Empty as exc:  # pragma: no cover
                raise TeleDOMError(f"timeout waiting for response to {method}") from exc
            if msg.get("id") == rid:
                if "error" in msg:
                    raise TeleDOMError(f"{method}: {msg['error'].get('message')}", msg["error"])
                return msg.get("result", {})

    def notify(self, method: str, params: Optional[dict] = None) -> None:
        payload = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        assert self._proc and self._proc.stdin
        self._proc.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
        self._proc.stdin.flush()

    # ── MCP surface ────────────────────────────────────────────────────

    def list_tools(self) -> list:
        result = self.request("tools/list", {})
        return result.get("tools", [])

    def call(self, name: str, arguments: Optional[dict] = None, timeout: float = 120.0) -> Any:
        """Call any of the 350 TeleDOM tools. Returns the parsed JSON payload."""
        result = self.request(
            "tools/call",
            {"name": name, "arguments": arguments or {}},
            timeout=timeout,
        )
        if result.get("isError"):
            raise TeleDOMError(f"{name} reported an error", self._parse(result))
        return self._parse(result)

    @staticmethod
    def _parse(result: dict) -> Any:
        text = ""
        for item in result.get("content", []):
            if item.get("type") == "text":
                text = item.get("text", "")
                break
        try:
            return json.loads(text)
        except (json.JSONDecodeError, TypeError):
            return text

    def close(self) -> None:
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.stdin.close() if self._proc.stdin else None
                self._proc.terminate()
                self._proc.wait(timeout=5)
            except Exception:  # pragma: no cover — best effort shutdown
                try:
                    self._proc.kill()
                except Exception:
                    pass

    def __enter__(self) -> "TeleDOMClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
