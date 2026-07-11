#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path


class ThrottleStopError(RuntimeError):
    pass


class Throttle:
    def __init__(
        self,
        state_path: Path,
        min_interval_seconds: float = 0.5,
        burst_limit: int = 20,
        burst_window_seconds: float = 30.0,
        rejection_cooldown_seconds: float = 60.0,
    ) -> None:
        self.state_path = state_path
        self.min_interval_seconds = min_interval_seconds
        self.burst_limit = burst_limit
        self.burst_window_seconds = burst_window_seconds
        self.rejection_cooldown_seconds = rejection_cooldown_seconds

    def wait(self) -> None:
        state = self._load()
        now = time.time()

        cooldown_until = state.get("cooldown_until")
        if cooldown_until and now < cooldown_until:
            remaining = int(cooldown_until - now)
            raise ThrottleStopError(f"cooldown active for {remaining}s after 429/403")

        requests = [
            ts for ts in state.get("requests", [])
            if now - ts <= self.burst_window_seconds
        ]

        if len(requests) >= self.burst_limit:
            sleep_for = self.burst_window_seconds - (now - requests[0])
            if sleep_for > 0:
                time.sleep(sleep_for)
                now = time.time()
                requests = [
                    ts for ts in requests
                    if now - ts <= self.burst_window_seconds
                ]

        if requests:
            elapsed = now - requests[-1]
            if elapsed < self.min_interval_seconds:
                time.sleep(self.min_interval_seconds - elapsed)
                now = time.time()

        requests.append(now)
        state["requests"] = requests
        state.pop("last_rejection_status", None)
        self._save(state)

    def record_rejection(self, status: int) -> None:
        if status not in {403, 429}:
            return

        state = self._load()
        state["last_rejection_status"] = status
        state["cooldown_until"] = time.time() + self.rejection_cooldown_seconds
        self._save(state)
        raise ThrottleStopError(f"stopping after backend returned {status}")

    def _load(self) -> dict:
        if not self.state_path.exists():
            return {"requests": []}
        return json.loads(self.state_path.read_text())

    def _save(self, state: dict) -> None:
        self.state_path.write_text(json.dumps(state, indent=2, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser(description="Human-pace throttle for GHL internal GETs.")
    parser.add_argument("command", choices=["wait", "reject"])
    parser.add_argument("status", nargs="?", type=int)
    parser.add_argument("--state", default=".ghl-workflow-json-throttle.json")
    args = parser.parse_args()

    throttle = Throttle(Path(args.state))
    try:
        if args.command == "wait":
            throttle.wait()
            print("OK throttle wait recorded")
        else:
            if args.status is None:
                parser.error("reject requires status")
            throttle.record_rejection(args.status)
            print(f"OK ignored non-cooldown status {args.status}")
    except ThrottleStopError as exc:
        print(f"STOP {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
