"""Publish an agent's output to the channel, resolving mentions of teammates.

This module used to do the opposite. It replaced every `@` with a lookalike
`＠` and raised if the relay reported any notified pubkey, under the heading
"publish status as data, without triggering new agent delegations". That was a
deliberate defence from when nobody was supposed to orchestrate anybody.

It is removed on purpose, because a team that cannot address its members is not
a team. What replaces it is not a stricter rule but a cheaper one: agents talk
freely, and a single budget decides when the talking stops costing money.

Three things are kept, because each prevents a real failure rather than a
hypothetical one:

* `nostr:` prefixes are still neutralised. Those address arbitrary keys, not
  teammates, and resolving them would let fetched text page anyone in the world.
* Only names on the roster resolve. An unknown `@something` stays literal text
  rather than fanning out or failing the publish.
* A message that opens with `[job-id]` is a report, and reports never carry
  mentions — that is what keeps a result from becoming a new assignment.
"""
import os
import re

from pilot import buzz, config, event

# The ceiling is on notifications, not on conversation: agents can keep talking
# to each other forever at no cost, but each mention can wake a teammate and
# spend real money. Generous on purpose — this is a stop for a runaway loop, not
# a quota meant to shape behaviour.
DEFAULT_MENTION_BUDGET = 120
MENTION_PATTERN = re.compile(r"@([A-Za-zÁÉÍÓÚáéíóúñÑ][\w-]{1,31})")


def report_text(text):
    """Neutralise npub addressing; leave teammate mentions alone."""
    return re.sub(r"nostr:", "nostr：", text, flags=re.I)


def target_channel() -> str:
    """Where a report lands: the project's channel when one is set."""
    return os.environ.get("BUZZ_PUBLISH_CHANNEL") or config()["channel"]


def roster_pubkeys() -> dict[str, str]:
    """Every name a teammate can be addressed by, mapped to its pubkey.

    Both the control-plane role (`coder`, `diseno`) and the underlying Buzz
    identity resolve, because the maestro thinks in roles and the relay thinks
    in identities, and an agent should not have to know which one it is holding.
    """
    names: dict[str, str] = {}
    try:
        from control_plane.roster import CONTRACTS

        c = config()
    except Exception:  # noqa: BLE001
        # No roster or no readable config means nobody is addressable, which is
        # the safe answer: an unresolved `@name` stays literal text. Failing the
        # publish instead would lose the message over a naming lookup.
        return names
    for role, contract in CONTRACTS.items():
        identity = c["identities"].get(contract["identity"])
        if identity:
            names[role.lower()] = identity["pubkey"]
            names[contract["identity"].lower()] = identity["pubkey"]
    return names


def spent(job: str) -> int:
    """How many mentions this project has already published."""
    from pilot import database

    with database() as db:
        row = db.execute(
            "SELECT count(*) FROM events WHERE action='mention_published'"
        ).fetchone()
    return row[0] if row else 0


# The roles whose output IS orchestration. For everyone else a `[job-id]`
# message is a result, and a result that could page a teammate would turn every
# answer into a new assignment. For these, suppressing mentions would mean the
# orchestrator cannot orchestrate — which is exactly the contradiction that made
# the first delegation attempt fail silently.
ORCHESTRATORS = {"maestro"}


def resolve_mentions(text: str, job: str, role: str | None = None) -> tuple[str, list[str]]:
    """Find teammate mentions and return the pubkeys to notify.

    Returns the text unchanged: the `@name` stays readable for humans, and the
    relay is told separately whom to notify.
    """
    reporting_envelope = bool(re.match(r"^\[[a-zA-Z0-9_-]+\]", text.strip()))
    if reporting_envelope and (role or "") not in ORCHESTRATORS:
        return text, []           # a specialist's result is never an assignment
    names = roster_pubkeys()
    found, seen = [], set()
    for match in MENTION_PATTERN.finditer(text):
        pubkey = names.get(match.group(1).lower())
        if pubkey and pubkey not in seen:
            seen.add(pubkey)
            found.append(pubkey)
    if not found:
        return text, []
    budget = int(os.environ.get("BUZZ_MENTION_BUDGET", DEFAULT_MENTION_BUDGET))
    if spent(job) + len(found) > budget:
        event(job, "reporting", "mention_budget_exhausted",
              {"budget": budget, "requested": len(found)})
        notice = (f"\n\n_(presupuesto de menciones agotado: {budget}. "
                  "Nadie ha sido avisado; el operador decide si se amplía.)_")
        return text + notice, []
    return text, found


def publish(role, job, text):
    body = f"[{job}] {report_text(text[:10000])}"
    body, mentions = resolve_mentions(body, job, role)
    args = ["messages", "send", "--channel", target_channel(), "--content", body]
    for pubkey in mentions:
        args += ["--mention", pubkey]
    receipt = buzz(role, args)
    event(job, role, "buzz_report", receipt)
    if mentions:
        event(job, role, "mention_published",
              {"count": len(mentions), "pubkeys": mentions})
    return receipt


def speak(role, job, text, mention: list[str] | None = None):
    """Say something in the channel as this agent, without the report prefix.

    A report is a result; this is a message. Orchestration is conversation, so
    the maestro needs a way to address a teammate that is not wrapped in a
    `[job-id]` envelope — that envelope is precisely what marks a message as
    "not an assignment".
    """
    body, mentions = resolve_mentions(report_text(text[:10000]), job, role)
    for pubkey in mention or []:
        if pubkey not in mentions:
            mentions.append(pubkey)
    args = ["messages", "send", "--channel", target_channel(), "--content", body]
    for pubkey in mentions:
        args += ["--mention", pubkey]
    receipt = buzz(role, args)
    event(job, role, "buzz_message", {**receipt, "mentions": len(mentions)})
    if mentions:
        event(job, role, "mention_published",
              {"count": len(mentions), "pubkeys": mentions})
    return receipt
