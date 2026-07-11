#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


WORKFLOW_KEYS = {"locationId", "name", "workflowData"}
STEP_KEYS = {"id", "order", "attributes", "name", "type"}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def unwrap_success_wrapper(data: Any) -> Any:
    if isinstance(data, dict) and data.get("ok") is True and "body" in data:
        return data["body"]
    if isinstance(data, dict) and data.get("status") == 200 and "data" in data:
        return data["data"]
    return data


def validate_workflow(path: Path, data: Any) -> tuple[list[str], dict[str, Any]]:
    errors: list[str] = []
    summary: dict[str, Any] = {}
    data = unwrap_success_wrapper(data)

    if not isinstance(data, dict):
        return [f"{path.name}: workflow JSON is not an object"], summary

    missing = sorted(WORKFLOW_KEYS - set(data))
    if "_id" not in data and "id" not in data:
        missing.append("_id or id")
    if missing:
        errors.append(f"{path.name}: missing workflow keys: {missing}")

    workflow_data = data.get("workflowData")
    if not isinstance(workflow_data, dict):
        errors.append(f"{path.name}: workflowData is not an object")
        return errors, summary

    templates = workflow_data.get("templates")
    if not isinstance(templates, list):
        errors.append(f"{path.name}: workflowData.templates is not a list")
        return errors, summary

    for index, step in enumerate(templates):
        if not isinstance(step, dict):
            errors.append(f"{path.name}: templates[{index}] is not an object")
            continue
        missing_step = sorted(STEP_KEYS - set(step))
        if missing_step:
            errors.append(f"{path.name}: templates[{index}] missing keys: {missing_step}")

    summary = {
        "workflow_id": data.get("_id") or data.get("id"),
        "location_id": data.get("locationId"),
        "name": data.get("name"),
        "status": data.get("status"),
        "steps": len(templates),
    }
    return errors, summary


def count_trigger_items(data: Any) -> int | None:
    data = unwrap_success_wrapper(data)
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        for key in ("triggers", "data", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return len(value)
        return 0
    return None


def json_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    return sorted(path for path in target.glob("*.json") if path.is_file())


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate captured GHL workflow JSON files.")
    parser.add_argument("target", type=Path, help="Capture directory or workflow JSON file")
    args = parser.parse_args()

    files = json_files(args.target)
    if not files:
        print(f"INVALID no JSON files found at {args.target}")
        return 1

    errors: list[str] = []
    workflow_summary: dict[str, Any] | None = None
    trigger_count: int | None = None

    for path in files:
        try:
            data = load_json(path)
        except Exception as exc:
            errors.append(f"{path.name}: could not parse JSON: {exc}")
            continue

        if path.name == "workflow.json" or (
            path.is_file() and "workflowData" in str(data)[:2000]
        ):
            workflow_errors, summary = validate_workflow(path, data)
            errors.extend(workflow_errors)
            if summary:
                workflow_summary = summary
        elif path.name == "trigger.json":
            trigger_count = count_trigger_items(data)
            if trigger_count is None:
                errors.append(f"{path.name}: trigger JSON is not an object or array")

    if workflow_summary is None:
        errors.append("no workflow config found; expected workflow.json")

    if errors:
        print("INVALID")
        for error in errors:
            print(f"- {error}")
        return 1

    parts = [
        "VALID",
        f"name={workflow_summary.get('name')!r}",
        f"status={workflow_summary.get('status')!r}",
        f"steps={workflow_summary.get('steps')}",
    ]
    if trigger_count is not None:
        parts.append(f"triggers={trigger_count}")
    print(" ".join(parts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
