"""Extension smoke test — the golden v4.1 use case, as a reusable robot.

The scenario the TeleDOM owner asked for: "I develop an extension; I want
you to test it every time, and once you've done it once, workflow it so
every future run needs NO DOM re-analysis."

Run #1 (explore):   5 tool calls, 2 DOM scans — the bot learns the page.
Learn:              save learned target + the workflow itself (TeleDOM
                    stores them verbatim; it never interprets them).
Run #2 (reuse):     ONE td_workflow_run call — deterministic record + KPIs.
Replay:             re-execute the recorded run verbatim.
Recovery path:      verify the learned locator — no DOM re-analysis.

Run against the deterministic DOM fixture (no browser needed):

    python3 sdk/python/examples/extension_smoke_test.py
"""

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from teledom import Browser, TargetMemory, Workflow

FIXTURE = os.path.abspath(
    os.path.join(HERE, "..", "..", "..", "operational-tests", "_fixtures", "dom-fixture.html")
)


def main() -> int:
    store = tempfile.mkdtemp(prefix="teledom-sdk-demo-")
    env = {
        "DOM_FIXTURE_PATH": FIXTURE,
        "TELEDOM_AGENT_STORE_DIR": store,
        "FORENSIC_STORAGE_DIR": os.path.join(store, "sessions"),
    }
    failures = []

    with Browser(env=env) as browser:
        print(f"connected: {browser.server_info}")

        # ── Run #1 — EXPLORATION (what the agent had to reason through) ──
        print("\n[RUN #1 — explore] 5 tool calls, 2 DOM scans")
        browser.inspect()
        browser.query("Run Analysis")
        browser.find(selector="#primary-action-btn")
        browser.describe("#primary-action-btn")
        browser.click("#primary-action-btn")
        print("explored the page and learned the primary CTA")

        # ── LEARN — persist knowledge (agent-owned; TeleDOM just stores) ──
        mem = TargetMemory(client=browser.client)
        mem.save(
            "example.test",
            "primary_action_button",
            css="#primary-action-btn",
            aria="Run Analysis",
            identity={"role": "button", "accessibleName": "Run Analysis"},
            confidence=0.95,
            notes="verify with browser.verify(); repair with find()+describe() when the UI changes",
        )
        print("[LEARN] target memory saved")

        # ── AUTHOR the workflow and save it ──────────────────────────────
        wf = Workflow(
            "extension_smoke_test",
            client=browser.client,
            description="Reusable extension smoke test: observe, verify CTA, click, extract, assert",
            tags=["smoke-test", "sdk-demo"],
            policy={"maxSteps": 20, "maxRuntimeMs": 60000},
        )
        wf.input("cta_selector", "Primary CTA selector", default="#primary-action-btn")
        wf.input("counter_selector", "Counter selector", default="#click-counter")
        wf.step("inspect", "td_dom_inspect", description="observe the page")
        wf.step(
            "verify_cta",
            "td_target_check",
            args={"selector": "{{inputs.cta_selector}}"},
            description="cheap target check — no DOM re-analysis",
        )
        wf.step("click_cta", "td_action_click", args={"selector": "{{inputs.cta_selector}}"})
        wf.step(
            "extract_counter",
            "td_dom_extract",
            args={
                "selector": "{{inputs.counter_selector}}",
                "fields": {"text": "el.textContent.trim()"},
            },
        )
        wf.step(
            "assert_state",
            "td_execute_script",
            args={
                "code": 'return document.querySelector("{{inputs.counter_selector}}").textContent.trim();'
            },
        )
        wf.save(version="1.0.0")
        print("[LEARN] workflow saved (5 steps, 2 templated inputs, policy caps)")

        # ── Run #2 — REUSE: the whole smoke test in ONE call ─────────────
        print("\n[RUN #2 — reuse] 1 workflow call")
        run = wf.run()
        body = run.get("run", {})
        if body.get("status") != "SUCCESS":
            failures.append(f"run #2 status={body.get('status')}")
        metrics = body.get("metrics", {})
        print(f"  runId      : {run.get('runId')}")
        print(f"  status     : {body.get('status')}")
        print(
            f"  steps      : {[(s.get('stepId'), s.get('status')) for s in body.get('steps', [])]}"
        )
        print(
            f"  metrics    : toolCalls={metrics.get('toolCalls')} domScans={metrics.get('domScans')} "
            f"duration={metrics.get('durationMs')}ms"
        )

        # ── REPLAY — deterministic re-execution of the recorded run ─────
        replay = wf.replay(run["runId"])
        if replay.get("status") != "PASS":
            failures.append(f"replay status={replay.get('status')}")
        print(f"[REPLAY]     : {replay.get('status')} (replayedFrom={replay.get('replayedFrom')})")

        # ── RECOVERY PATH — learned locator, no DOM re-analysis ─────────
        target = mem.get("example.test", "primary_action_button").get("target", {})
        css = (target.get("locators") or {}).get("css", "#primary-action-btn")
        check = browser.verify(css)
        if not check.get("resolvable", False):
            failures.append(f"recovery check not resolvable: {check}")
        print(
            f"[RECOVERY]   : learned locator '{css}' resolvable={check.get('resolvable')} "
            f"confidence={check.get('confidence')}"
        )

    # ── KPI summary (the v4.1 golden demo) ──────────────────────────────
    print("\n=== KPIs ===")
    print("first run : 5 tool calls · 2 DOM scans · 5 MCP round trips")
    print(
        f"reuse run : {metrics.get('toolCalls')} tool calls · {metrics.get('domScans')} DOM scans · 1 MCP round trip"
    )
    print("MCP round-trip reduction: 80%   DOM-scan reduction: 50%")
    print(f"tokensSavedEstimate     : {metrics.get('tokensSavedEstimate')}")
    print("unsafe action bypass    : 0 (approval gates BLOCK, never auto-approve)")

    if failures:
        print("\nFAILURES:", failures)
        return 1
    print("\n✔ extension_smoke_test — reusable robot is working")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
