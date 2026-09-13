"""Bind an independent review to complete, unchanged, explicitly assigned inputs."""
import hashlib
import json


def validate_inputs(review, proofs, trace, root):
    """Return evidence gaps; a claimed read or hash without returned bytes is insufficient."""
    inputs = review.get("inputs", [])
    if {item.get("purpose") for item in inputs} != {"target", "source"}:
        return ["Review must pin its target and at least one source"]
    indexed = {proof["path"]: proof for proof in proofs}
    calls, replies = {}, []
    for message in trace.get("messages", []):
        for call in message.get("tool_calls", []):
            if call.get("function", {}).get("name") != "pilot":
                continue
            try:
                calls[call["id"]] = json.loads(call["function"]["arguments"])
            except (KeyError, TypeError, ValueError):
                continue
        if message.get("role") == "tool" and message.get("tool_call_id") in calls:
            try:
                result = json.loads(message["content"])
            except (TypeError, ValueError):
                continue
            if isinstance(result, dict) and not result.get("error"):
                replies.append((calls[message["tool_call_id"]], result))
    errors = []
    for item in inputs:
        artifact = item.get("artifact")
        if artifact not in indexed:
            errors.append("Review input lacks hashed artifact: " + str(artifact))
            continue
        path = (root / artifact).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            errors.append("Review input missing or outside evidence root: " + artifact)
            continue
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != indexed[artifact]["sha256"]:
            errors.append("Review input changed: " + artifact)
            continue
        expected = raw.decode("utf-8")
        covered = []
        for call, result in replies:
            args = call.get("args", {})
            if call.get("action") != item.get("action") or args.get("path") != item.get("path"):
                continue
            if item["action"] == "context" and (args.get("source") != item.get("source") or args.get("operation", "document") != "document"):
                continue
            if result.get("sha256") != digest:
                continue
            if item["action"] == "context":
                if result.get("text") == expected:
                    covered.append((0, len(expected)))
            elif item["action"] == "read":
                start, content = result.get("offset", 0), result.get("content")
                if type(start) is int and start >= 0 and isinstance(content, str) and expected[start:start + len(content)] == content:
                    covered.append((start, start + len(content)))
        end = 0
        for start, stop in sorted(covered):
            if start > end:
                break
            end = max(end, stop)
        if not covered or end != len(expected):
            errors.append("Reviewer did not receive complete matching input: " + artifact)
    return errors
