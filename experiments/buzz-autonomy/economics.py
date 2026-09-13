"""What the factory costs, decomposed so a rise has an address.

Taken from Uber's software-factory write-up (September 2026), whose central move
is not a tool but a framing: total spend is a *product* of six factors, so any
increase can be attributed to one of them instead of being argued about.

    operators × assignments/operator × turns/assignment
              × requests/turn × tokens/request × price/token

The first two are adoption — if they grow, that is the system being used, and
cutting them is cutting the product. The middle three are the engineering
levers. The last is the vendor's.

The second move borrowed here is **cost per outcome, not per token**. A cheaper
turn that fails is not cheaper; it is a smaller payment for nothing. So the
interesting number is cost per closed assignment, and a run that spent tokens
and delivered nothing shows up as pure waste rather than as "efficient".

Nothing here estimates. If the price of the model is unknown, the money columns
say so rather than inventing a figure — an invented cost is worse than no cost,
because it gets quoted.
"""
import json
import os
from collections import defaultdict

from pilot import MODEL, database

# Price is per million tokens, and deliberately not hardcoded per model: the
# combo routes to whatever is cheapest at the time, so a number written here
# would be a guess with a decimal point. Set BUZZ_PRICE_IN / BUZZ_PRICE_OUT when
# the real figures are known and the money columns light up.
PRICE_IN = os.environ.get("BUZZ_PRICE_IN")
PRICE_OUT = os.environ.get("BUZZ_PRICE_OUT")


def _turns(project: str | None = None) -> list[dict]:
    """Every recorded model turn, with the assignment it belonged to."""
    where, params = "action='turn_usage'", ()
    if project:
        where += " AND job LIKE ?"
        params = (f"{project}%",)
    with database() as db:
        rows = db.execute(
            f"SELECT job, role, data, at FROM events WHERE {where} ORDER BY seq",
            params,
        ).fetchall()
    turns = []
    for job, role, data, at in rows:
        try:
            payload = json.loads(data)
        except (TypeError, ValueError):
            continue
        turns.append({
            "job": job, "role": role, "at": at,
            "input": int(payload.get("input_tokens") or 0),
            "output": int(payload.get("output_tokens") or 0),
            "model": payload.get("model") or MODEL,
            "harness": payload.get("harness") or "unknown",
        })
    return turns


def _money(input_tokens: int, output_tokens: int) -> float | None:
    """Cost in currency, or None when the price is genuinely unknown."""
    if PRICE_IN is None or PRICE_OUT is None:
        return None
    return (input_tokens * float(PRICE_IN) + output_tokens * float(PRICE_OUT)) / 1e6


def equation(project: str | None = None) -> dict:
    """The six factors, each measured rather than assumed."""
    turns = _turns(project)
    if not turns:
        return {"turns": 0, "note": "sin turnos registrados todavía"}

    assignments = {t["job"] for t in turns}
    roles = {t["role"] for t in turns}
    total_in = sum(t["input"] for t in turns)
    total_out = sum(t["output"] for t in turns)

    return {
        "operadores": len(roles),
        "encargos_por_operador": round(len(assignments) / max(len(roles), 1), 2),
        "turnos_por_encargo": round(len(turns) / max(len(assignments), 1), 2),
        # One turn is one request here: the harness does not split a turn into
        # several model calls. Kept as an explicit factor so the day it does,
        # the equation still balances instead of hiding the change.
        "peticiones_por_turno": 1.0,
        "tokens_por_peticion": round((total_in + total_out) / len(turns)),
        "precio_por_token": "desconocido" if PRICE_IN is None else float(PRICE_IN),
        "turns": len(turns),
        "tokens_entrada": total_in,
        "tokens_salida": total_out,
        "coste": _money(total_in, total_out),
    }


def per_outcome(project: str = "tower") -> list[dict]:
    """Cost per assignment, and whether the assignment delivered anything.

    A cheap turn that produced nothing is not a saving. Separating delivered
    from wasted is the whole point of denominating by outcome.
    """
    turns = _turns(project)
    with database() as db:
        status = dict(db.execute(
            "SELECT id, status FROM jobs WHERE id LIKE ?", (f"{project}%",)
        ).fetchall())

    grouped: dict[str, dict] = defaultdict(
        lambda: {"turns": 0, "input": 0, "output": 0, "role": "", "harness": ""})
    for turn in turns:
        bucket = grouped[turn["job"]]
        bucket["turns"] += 1
        bucket["input"] += turn["input"]
        bucket["output"] += turn["output"]
        bucket["role"] = turn["role"]
        bucket["harness"] = turn["harness"]

    out = []
    for job, bucket in sorted(grouped.items()):
        delivered = status.get(job) == "done"
        out.append({
            "encargo": job, "rol": bucket["role"], "harness": bucket["harness"],
            "turnos": bucket["turns"],
            "tokens": bucket["input"] + bucket["output"],
            "coste": _money(bucket["input"], bucket["output"]),
            "entregado": delivered,
            # The number that matters: everything spent on an assignment that
            # closed nothing bought nothing.
            "desperdicio": not delivered,
        })
    return out


# Each pattern is a rule over turns that has a name, a cost, and something to do
# about it. A finding without a remedy is a complaint.
def anti_patterns(project: str | None = None) -> list[dict]:
    """Spending shapes that are known to be waste, with what to do instead."""
    turns = _turns(project)
    if not turns:
        return []
    findings = []

    by_job: dict[str, list[dict]] = defaultdict(list)
    for turn in turns:
        by_job[turn["job"]].append(turn)

    # 1. Prompt-initialisation overhead. Our own briefs inject the role
    #    contract plus the handoff on every single turn, so a long assignment
    #    pays for the same preamble N times.
    for job, group in by_job.items():
        if len(group) < 3:
            continue
        floor = min(t["input"] for t in group)
        repeated = floor * (len(group) - 1)
        if repeated > 20000:
            findings.append({
                "patron": "preámbulo repetido",
                "encargo": job,
                "impacto_tokens": repeated,
                "coste": _money(repeated, 0),
                "detalle": f"{floor} tokens de entrada en cada uno de {len(group)} turnos",
                "remedio": "Recortar el handoff o pasarlo una vez por sesión, no por turno.",
            })

    # 2. Context bloat: input growing turn after turn inside one assignment.
    for job, group in by_job.items():
        if len(group) < 4:
            continue
        first, last = group[0]["input"], group[-1]["input"]
        if last > first * 3 and last - first > 20000:
            findings.append({
                "patron": "contexto que se hincha",
                "encargo": job,
                "impacto_tokens": last - first,
                "coste": _money(last - first, 0),
                "detalle": f"entrada de {first} a {last} tokens en {len(group)} turnos",
                "remedio": "Compactar entre turnos, o cortar el encargo en piezas.",
            })

    # 3. Burnt retries: tokens spent on a wall we already know is a wall. The
    #    repetition breaker names the wall; this prices it.
    with database() as db:
        walls = db.execute(
            "SELECT job, count(*) FROM events WHERE action='tool_error' "
            "AND data LIKE '%\"repeat\"%' GROUP BY job"
        ).fetchall()
    for job, count in walls:
        group = by_job.get(job) or []
        if not group or count < 3:
            continue
        per_turn = sum(t["input"] + t["output"] for t in group) // max(len(group), 1)
        wasted = per_turn * count
        findings.append({
            "patron": "reintento contra un muro",
            "encargo": job,
            "impacto_tokens": wasted,
            "coste": _money(wasted, 0),
            "detalle": f"{count} llamadas fallidas repetidas",
            "remedio": "Bajar el umbral del freno, o dar un error accionable.",
        })

    # 4. Spending with nothing to show. Not a shape of a turn but of a run, and
    #    the most expensive pattern of all: it is 100% waste by definition.
    for outcome in per_outcome(project or "tower"):
        if outcome["desperdicio"] and outcome["tokens"] > 5000:
            findings.append({
                "patron": "gasto sin entrega",
                "encargo": outcome["encargo"],
                "impacto_tokens": outcome["tokens"],
                "coste": outcome["coste"],
                "detalle": f"{outcome['turnos']} turnos, encargo sin cerrar",
                "remedio": "Perseguir con otro enfoque (pursue.py) o retirar el encargo.",
            })

    return sorted(findings, key=lambda f: -f["impacto_tokens"])


def report(project: str | None = None) -> str:
    """A page an operator can read without a dashboard."""
    factors = equation(project)
    if not factors.get("turns"):
        return "Sin turnos registrados todavía. La contabilidad empieza en el próximo encargo."

    lines = [
        f"## Ecuación de coste{' — ' + project if project else ''}",
        "",
        f"  operadores                {factors['operadores']}",
        f"  encargos por operador     {factors['encargos_por_operador']}",
        f"  turnos por encargo        {factors['turnos_por_encargo']}",
        f"  peticiones por turno      {factors['peticiones_por_turno']}",
        f"  tokens por petición       {factors['tokens_por_peticion']}",
        f"  precio por token          {factors['precio_por_token']}",
        "",
        f"  {factors['turns']} turnos · {factors['tokens_entrada']:,} entrada · "
        f"{factors['tokens_salida']:,} salida",
    ]
    if factors["coste"] is not None:
        lines.append(f"  coste total               {factors['coste']:.2f}")
    else:
        lines.append("  coste: sin precio configurado (BUZZ_PRICE_IN / BUZZ_PRICE_OUT)")

    outcomes = per_outcome(project or "tower")
    if outcomes:
        lines += ["", "## Coste por resultado", ""]
        for row in outcomes:
            mark = "entregado" if row["entregado"] else "SIN ENTREGA"
            lines.append(f"  {row['rol']:11} {row['turnos']:>3} turnos  "
                         f"{row['tokens']:>8,} tokens  {mark}")

    findings = anti_patterns(project)
    if findings:
        lines += ["", "## Patrones de gasto a corregir", ""]
        for finding in findings[:8]:
            lines.append(f"  {finding['patron']:24} {finding['impacto_tokens']:>9,} tokens"
                         f"  ({finding['encargo']})")
            lines.append(f"  {'':24} {finding['remedio']}")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys

    print(report(sys.argv[1] if len(sys.argv) > 1 else None))
