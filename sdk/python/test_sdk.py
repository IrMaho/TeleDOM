"""Self-test for the TeleDOM Python SDK (no pytest required).

Runs the full Level-2 surface against the deterministic DOM fixture:

    python3 sdk/python/test_sdk.py
"""

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from teledom import Browser, TargetMemory, Workflow

FIXTURE = os.path.abspath(
    os.path.join(HERE, "..", "..", "operational-tests", "_fixtures", "dom-fixture.html")
)

passed, failed = 0, 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  [OK] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} {detail}")


def main() -> int:
    store = tempfile.mkdtemp(prefix="teledom-sdk-test-")
    env = {
        "DOM_FIXTURE_PATH": FIXTURE,
        "TELEDOM_AGENT_STORE_DIR": store,
        "FORENSIC_STORAGE_DIR": os.path.join(store, "sessions"),
    }

    with Browser(env=env) as browser:
        print("client:")
        check(
            "server handshake reports teledom",
            browser.server_info.get("name") == "teledom",
        )
        check(
            "server version is 4.1.x",
            browser.server_info.get("version", "").startswith("4.1"),
        )

        tools = browser.client.list_tools()
        check("350 tools exposed over MCP", len(tools) == 350, f"got {len(tools)}")

        print("browser primitives:")
        page = browser.inspect()
        check("inspect returns a structured observation", isinstance(page, dict))
        hits = browser.query("Run Analysis")
        check("query finds the CTA by text", isinstance(hits, dict))
        target = browser.find(selector="#primary-action-btn")
        check("find builds a canonical TARGET", isinstance(target, dict))
        typed = browser.type("#search-input", "sdk test")
        check("type interacts with the input", isinstance(typed, dict))
        script = browser.execute_script("return document.querySelectorAll('p').length;")
        check("escape hatch executes JS", isinstance(script, dict))

        print("target memory:")
        mem = TargetMemory(client=browser.client)
        mem.save(
            "example.test",
            "primary_action_button",
            css="#primary-action-btn",
            confidence=0.95,
        )
        target = mem.get("example.test", "primary_action_button").get("target", {})
        check(
            "learned target persisted",
            (target.get("locators") or {}).get("css") == "#primary-action-btn",
        )
        listing = mem.list(site="example.test")
        check("target memory list works", listing.get("count", 0) >= 1)

        print("workflow runtime:")
        wf = Workflow("sdk_self_test", client=browser.client, description="SDK self-test workflow")
        wf.input("selector", "CTA selector", default="#primary-action-btn")
        wf.step("verify", "td_target_check", args={"selector": "{{inputs.selector}}"})
        wf.step(
            "assert",
            "td_execute_script",
            args={"code": 'return document.querySelector("{{inputs.selector}}") !== null;'},
        )
        saved = wf.save(version="1.0.0")
        check("workflow saved verbatim", saved.get("status") == "PASS")

        run = wf.run()
        body = run.get("run", {})
        check(
            "dumb execution SUCCESS",
            body.get("status") == "SUCCESS",
            str(body.get("error", "")),
        )
        check("deterministic record has metrics", "metrics" in body)
        check(
            "steps recorded with status",
            all("status" in s for s in body.get("steps", [])),
        )

        replay = wf.replay(run["runId"])
        check("verbatim replay works", replay.get("status") == "PASS")

        diff = wf.diff("1.0.0", "1.0.0")
        check("diff against itself shows no change", diff.get("changed") is False)

        wf.delete()
        check("workflow deleted", True)

    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
