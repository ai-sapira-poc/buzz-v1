"""Deduplicate native Buzz requests against relay events, not quoted prompt claims."""
import hashlib
import json
import os
import re
import time
from contextvars import ContextVar

from pilot import buzz, config, database, event

ACTIVE_JOB = ContextVar("pilot_active_job", default=None)


def served_channels(c) -> list[str]:
    """The channels this harness was actually launched on.

    `config()["channel"]` is the community's default channel, not necessarily
    the one the agent is serving. When the fleet was started on a project
    channel, every live mention died here: the thread lookup below asked the
    relay for the event *in the default channel*, the relay correctly answered
    "does not belong to channel …", and the turn ended in two seconds having
    published nothing. The agent looked broken; the configuration was.

    So the channel the harness subscribed to decides, and the default is only a
    fallback for callers that never set one.
    """
    listed = [part.strip() for part in
              os.environ.get("BUZZ_ACP_CHANNELS", "").split(",") if part.strip()]
    return listed or [c["channel"]]


def locate(role, event_id, channels):
    """Find the event in one of the channels we serve, or say we could not.

    Returned together with its channel, because the `h`-tag check afterwards has
    to assert membership of *that* channel — checking it against a different one
    is how this failed in the first place.
    """
    for channel in channels:
        try:
            rows = buzz(role, ["messages", "thread", "--channel", channel,
                               "--event", event_id])
        except RuntimeError:
            continue  # not in this channel; try the next one we serve
        matches = [row for row in rows if row["id"] == event_id]
        if len(matches) == 1:
            return matches[0], channel
    raise PermissionError("Request not found in the scoped relay thread")


def claim(role, prompt):
    """Claim explicit, authorized mentions once; return only fresh request content."""
    if not isinstance(prompt, str):
        raise ValueError("Native pilot currently accepts text requests only")
    ids = list(dict.fromkeys(re.findall(r"^Event ID: ([0-9a-f]{64})$", prompt, re.M)))
    if not ids or len(ids) > 8:
        raise ValueError("Expected a bounded Buzz event batch")
    c = config()
    # Two gates gated this path with different policies, and the disagreement was
    # silent: buzz-acp admitted the event under its `respond_to` allowlist, then
    # this check raised PermissionError and the turn ended with nothing
    # published. Measured, not hypothetical — a mention from `product` was
    # dispatched, ran, and vanished. Keep the two sets in agreement.
    #
    # Legacy pilot: only the operator and the two dispatcher roles could task an
    # agent. Control plane: any teammate can, because the maestro must be able to
    # delegate and each role must be able to hand off to the next. The operator
    # is always included, and nobody outside the roster ever is.
    permitted = {c.get("viewer"), c["identities"]["maestro"]["pubkey"],
                 c["identities"]["editor"]["pubkey"]}
    if os.environ.get("BUZZ_CONTROL_PLANE") == "1":
        from control_plane.roster import CONTRACTS
        permitted |= {c["identities"][r["identity"]]["pubkey"] for r in CONTRACTS.values()}
    own = c["identities"][role]["pubkey"]
    channels = served_channels(c)
    verified = []
    for event_id in ids:
        row, channel = locate(role, event_id, channels)
        tags = row["tags"]
        if ["h", channel] not in [t[:2] for t in tags] or row["pubkey"] not in permitted:
            raise PermissionError("Request origin is not an authorized pilot dispatcher")
        # Requiring a p-tag means requiring an explicit mention. That is right
        # for a specialist and wrong for the agent serving a channel in `all`
        # mode: buzz-acp admits the message, this check discards it, and the
        # turn dies in two seconds with nothing published. Same class of bug as
        # the allowlist/claim disagreement before it — two gates, two policies,
        # no log. `run_hermes` sets this flag for exactly the roles it starts
        # with subscribe=all, so the two cannot drift apart.
        # Reports still cannot become mandates: the `[job-id]` prefix check below
        # runs regardless.
        if os.environ.get("BUZZ_CLAIM_UNMENTIONED") != "1":
            if ["p", own] not in [t[:2] for t in tags]:
                continue
        if re.match(r"^\[(?:acp-|[a-zA-Z0-9_-]+\])", row["content"]):
            # Status reports are never interpreted as new mandates.
            continue
        verified.append(row)
    with database() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS inbound (
            role TEXT, event_id TEXT, job TEXT, status TEXT, created REAL,
            PRIMARY KEY(role,event_id))""")
        db.execute("BEGIN IMMEDIATE")
        fresh = [row for row in verified if not db.execute(
            "SELECT 1 FROM inbound WHERE role=? AND event_id=?", (role,row["id"])).fetchone()]
        if not fresh:
            return None
        digest = hashlib.sha256(json.dumps([role, sorted(r["id"] for r in fresh)]).encode()).hexdigest()
        job = "native-" + digest[:40]
        db.executemany("INSERT INTO inbound VALUES(?,?,?,?,?)",
                       [(role, r["id"], job, "running", time.time()) for r in fresh])
    event(job, role, "inbound_claimed", {"events": fresh, "community": c["relay"]})
    content = "\n\n".join(f"Verified request {r['id']} from {r['pubkey']}:\n{r['content']}" for r in fresh)
    return job, content


def finish(job, status):
    with database() as db:
        db.execute("UPDATE inbound SET status=? WHERE job=?", (status, job))
