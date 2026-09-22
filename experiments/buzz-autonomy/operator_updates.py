"""Deterministic, operator-facing progress messages for the pilot.

Agent handoffs are deliberately technical: they carry paths, hashes, trace ids
and exact failure evidence for another agent. They are not a suitable interface
for the person supervising the work. This module is the small translation layer
between those two audiences. It uses fixed vocabulary and role objectives, so a
model timing out cannot make the operator lose the only status update.
"""
from __future__ import annotations

import hashlib
import json
import os

from pilot import database, event


ROLE_LABELS = {
    "product": "Producto",
    "research": "Investigación",
    "designer": "Diseño",
    "coder": "Implementación",
    "reviewer": "Revisión independiente",
    "tester": "Pruebas de uso",
    "strategy": "Estrategia",
    "innovation": "Innovación",
    "analyst": "Métricas y operaciones",
    "architect": "Arquitectura",
    # The Tower launcher uses the Spanish control-plane role names.
    "producto": "Producto",
    "diseno": "Diseño",
    "revisor": "Revisión independiente",
    "probador": "Pruebas de uso",
    "estrategia": "Estrategia",
    "innovacion": "Innovación",
    "analista": "Métricas y operaciones",
    "arquitecto": "Arquitectura",
}

ROLE_OBJECTIVES = {
    "product": "definir el problema que Tower Control debe resolver y cómo mediremos su valor",
    "research": "contrastar la solución con evidencia y referencias fiables",
    "designer": "diseñar una experiencia clara para entender el trabajo del equipo",
    "coder": "convertir el contrato en una primera versión funcional de Buzz",
    "reviewer": "buscar riesgos y validar que el resultado cumple lo acordado",
    "tester": "comprobar la experiencia real y localizar fricciones para la persona usuaria",
    "strategy": "decidir la mejor combinación de construir, comprar o esperar",
    "innovation": "identificar oportunidades nuevas y el experimento más útil",
    "analyst": "definir métricas honestas, cobertura y efecto del trabajo",
    "architect": "fijar límites técnicos y una solución reversible para la primera versión",
    "producto": "definir el problema que Tower Control debe resolver y cómo mediremos su valor",
    "diseno": "diseñar una experiencia clara para entender el trabajo del equipo",
    "revisor": "buscar riesgos y validar que el resultado cumple lo acordado",
    "probador": "comprobar la experiencia real y localizar fricciones para la persona usuaria",
    "estrategia": "decidir la mejor combinación de construir, comprar o esperar",
    "innovacion": "identificar oportunidades nuevas y el experimento más útil",
    "analista": "definir métricas honestas, cobertura y efecto del trabajo",
    "arquitecto": "fijar límites técnicos y una solución reversible para la primera versión",
}

ROLE_NEXT_ACTIONS = {
    "product": "decidir si el problema y la medida de valor justifican continuar",
    "research": "contrastar la evidencia y decidir qué incertidumbre sigue abierta",
    "designer": "revisar el prototipo contra la tarea y sus estados de uso",
    "coder": "revisar los cambios y ejecutar las comprobaciones del contrato",
    "reviewer": "resolver los hallazgos antes de aceptar la entrega",
    "tester": "reproducir la fricción observada y priorizar la corrección",
    "strategy": "elegir la opción y el siguiente compromiso de inversión",
    "innovation": "seleccionar el experimento que más reduzca la incertidumbre",
    "analyst": "comprobar la métrica, su cobertura y el impacto observado",
    "architect": "aceptar la frontera técnica o registrar la decisión pendiente",
    "producto": "decidir si el problema y la medida de valor justifican continuar",
    "diseno": "revisar el prototipo contra la tarea y sus estados de uso",
    "revisor": "resolver los hallazgos antes de aceptar la entrega",
    "arquitecto": "aceptar la frontera técnica o registrar la decisión pendiente",
    "probador": "reproducir la fricción observada y priorizar la corrección",
    "estrategia": "elegir la opción y el siguiente compromiso de inversión",
    "innovacion": "seleccionar el experimento que más reduzca la incertidumbre",
    "analista": "comprobar la métrica, su cobertura y el impacto observado",
}


def label(role: str) -> str:
    return ROLE_LABELS.get(role, role.replace("_", " ").title())


def objective(role: str) -> str:
    return ROLE_OBJECTIVES.get(role, "aportar evidencia para la próxima decisión")


def result_header(role: str) -> str:
    """Return the human-facing frame for a technical specialist report."""
    return (
        "Estado: se ha registrado una entrega para el equipo.\n"
        f"Impacto: aporta evidencia para {objective(role)}.\n"
        f"Siguiente acción: {ROLE_NEXT_ACTIONS.get(role, 'revisar la evidencia y decidir el siguiente paso')}."
    )


def _technical_detail(detail: object | None) -> str:
    if detail is None:
        return ""
    text = str(detail).strip().replace("\n", " ")
    return f"\n\nDetalle técnico: {text[:500]}" if text else ""


def format_update(role: str, state: str, *, missing: list[str] | None = None,
                  detail: object | None = None, count: str | None = None) -> str:
    """Return a business-first update; technical detail is explicitly secondary."""
    name = label(role)
    work = objective(role)
    if state == "delegated":
        text = (
            f"Trabajo encargado — {name}\n\n"
            f"Objetivo: Se ha encargado al equipo {work}.\n"
            "Estado: pendiente de inicio; este encargo todavía no es un resultado.\n"
            "Próxima señal: confirmación de inicio, avance observable o un bloqueo explícito."
        )
    elif state in {"started", "running"}:
        text = (
            f"Trabajo en marcha — {name}\n\n"
            f"Objetivo: El equipo está trabajando para {work}.\n"
            "Estado: en curso. Una respuesta lenta no se considera un fallo.\n"
            "Próxima señal: una entrega verificable, una actualización de avance "
            "o un bloqueo explícito."
        )
    elif state == "done":
        text = (
            f"Avance confirmado — {name}\n\n"
            f"Ya existe una entrega verificable para {work}.\n"
            "Impacto: este trabajo puede alimentar la siguiente decisión del equipo.\n"
            "Siguiente acción: revisar la evidencia y continuar solo si la dependencia "
            "está realmente cerrada."
        )
    elif state == "blocked":
        waiting = ", ".join(missing or []) or "una dependencia o señal que todavía no está disponible"
        text = (
            f"Trabajo en espera — {name}\n\n"
            f"El equipo no ha iniciado esta parte porque necesita: {waiting}.\n"
            "Impacto: avanzar ahora podría producir una decisión o una implementación "
            "sin la base necesaria.\n"
            "Siguiente acción: completar la dependencia y volver a comprobar el estado."
        )
    elif state == "failed":
        text = (
            f"Incidencia en el trabajo — {name}\n\n"
            f"La tarea no ha producido todavía una entrega válida para {work}.\n"
            "Impacto: la siguiente actividad que dependa de ella debe permanecer en "
            "espera; no se presenta este resultado como progreso.\n"
            "Siguiente acción: revisar la causa registrada, reanudar el mismo encargo "
            "si conserva evidencia útil o cambiar de enfoque."
        )
    elif state == "cancelled":
        text = (
            f"Trabajo cancelado — {name}\n\n"
            f"La persona responsable ha detenido la tarea de {work}.\n"
            "Impacto: no se ha publicado ningún resultado como si estuviera terminado.\n"
            "Siguiente acción: reanudarla explícitamente o sustituirla por otro encargo."
        )
    elif state == "summary":
        text = (
            "Resumen de la ejecución\n\n"
            f"{count or 'El equipo ha actualizado sus encargos.'}\n"
            "El estado refleja únicamente resultados observados: estar en curso no "
            "significa estar terminado y el silencio no significa inactividad.\n"
            "Siguiente acción: atender primero los bloqueos y revisar las entregas "
            "antes de cerrar la fase."
        )
    else:
        text = (
            f"Actualización de trabajo — {name}\n\n"
            f"Estado observado: {state}. Objetivo: {work}."
        )
    return text + _technical_detail(detail)


def _already_published(job: str, key: str) -> bool:
    with database() as db:
        rows = db.execute(
            "SELECT data FROM events WHERE job=? AND action='operator_update'",
            (job,),
        ).fetchall()
    for row in rows:
        try:
            if json.loads(row[0]).get("key") == key:
                return True
        except (TypeError, ValueError):
            continue
    return False


# The machine-readable half of an operator update. `publish_update` already
# says what happened in prose; this says it in a shape a program can read.
#
# Kinds 43001-43006 have existed in buzz-core since the agent job protocol was
# defined, and the desktop feed already renders each with its own headline. No
# producer ever existed, so both the feed and Tower Control sat in front of an
# empty stream while the control plane's work stayed locked in its own sqlite.
#
# The kind IS the state. A reader never parses the prose to find out what
# happened, which is what keeps the two halves from drifting apart.
JOB_EVENT_STATE = {
    "created": "requested",
    "started": "accepted",
    "running": "progress",
    "done": "result",
    "cancelled": "cancelled",
    "failed": "error",
    "blocked": "progress",
}


def publish_job_event(publisher: str, role: str, job: str, state: str,
                      detail: object | None = None) -> bool:
    """Emit one lifecycle event, without ever making the work depend on it.

    Returns whether it was published. A relay that is down must not fail a job
    that succeeded: the local event log is the retry record, exactly as it is
    for the prose update this runs beside.
    """
    kind_state = JOB_EVENT_STATE.get(state)
    if kind_state is None:
        return False
    try:
        from pilot import buzz, config

        owner = config().get("viewer")
        if not owner:
            return False
        args = ["jobs", "publish", "--state", kind_state, "--job", job,
                "--owner", owner, "--role", role,
                "--content", _line(role, state, detail)]
        channel = os.environ.get("BUZZ_PUBLISH_CHANNEL")
        if channel:
            args += ["--channel", channel]
        receipt = buzz(publisher, args)
        event(job, publisher, "job_event_published", {
            "state": kind_state, "role": role,
            "event_id": receipt.get("event_id") if isinstance(receipt, dict) else None,
        })
        return True
    except Exception as error:  # noqa: BLE001 - the local event is the retry record
        event(job, publisher, "job_event_failed", {
            "state": kind_state, "role": role,
            "error": f"{type(error).__name__}: {error}"[:500],
        })
        return False


def children_of(job: str) -> list[str]:
    """The jobs enqueued with this job as parent, oldest first.

    `jobs.parent` is the only durable record of who a job handed to: its single
    writer is `capabilities`, when an agent enqueues a child. One handoff event
    is published per child, so the reader draws one row per edge (fan-out 1:N),
    never one row per parent.
    """
    with database() as db:
        rows = db.execute(
            "SELECT id FROM jobs WHERE parent=? ORDER BY created, rowid", (job,)
        ).fetchall()
    return [str(row["id"]) for row in rows]


def _handoff_line(role: str, child: str, detail: object | None) -> str:
    """One short line naming the edge, in the language the operator reads."""
    text = f"{label(role)} entrega su conclusión al encargo {child}"
    if detail:
        text += ". " + str(detail).replace("\n", " ").strip()[:200]
    return text[:400]


def publish_handoffs(publisher: str, role: str, parent_job: str,
                     detail: object | None = None) -> list[str]:
    """Project a job's local handoff fact onto the wire: one event per child.

    `handoff_published` already records the fact in the local log; this is its
    best-effort projection, exactly as `publish_job_event` is for the lifecycle.
    A relay that is down must not turn a delivered handoff into a failure of the
    work — the local row stays the retry record — but the failed projection is
    recorded too, so a handoff that never reached the surface can be seen rather
    than rendered as an absence.

    Returns the children whose edge was published.
    """
    published: list[str] = []
    for child in children_of(parent_job):
        try:
            from pilot import buzz, config

            owner = config().get("viewer")
            if not owner:
                raise RuntimeError("no viewer identity to scope the handoff event")
            args = ["jobs", "publish", "--state", "handoff", "--job", parent_job,
                    "--child", child, "--owner", owner, "--role", role,
                    "--content", _handoff_line(role, child, detail)]
            channel = os.environ.get("BUZZ_PUBLISH_CHANNEL")
            if channel:
                args += ["--channel", channel]
            receipt = buzz(publisher, args)
            event(parent_job, publisher, "job_handoff_published", {
                "child": child, "role": role,
                "event_id": receipt.get("event_id") if isinstance(receipt, dict) else None,
            })
            published.append(child)
        except Exception as error:  # noqa: BLE001 - the local event is the retry record
            event(parent_job, publisher, "job_handoff_failed", {
                "child": child, "role": role,
                "error": f"{type(error).__name__}: {error}"[:500],
            })
    return published


# The feed shows the kind's own headline ("Job accepted", "Job failed"), so the
# content says who and what, not the state again.
_SAID = {
    "created": "tiene un encargo nuevo",
    "started": "ha empezado a trabajar",
    "running": "sigue trabajando",
    "done": "ha entregado",
    "cancelled": "se ha detenido por decisión del operador",
    "failed": "no ha podido entregar",
    "blocked": "está esperando a una dependencia",
}


def _line(role: str, state: str, detail: object | None) -> str:
    """One short line, in the language the operator reads everywhere else."""
    text = f"{label(role)} {_SAID.get(state, state)}"
    if detail:
        text += ". " + str(detail).replace("\n", " ").strip()[:200]
    return text[:400]


def publish_update(publisher: str, role: str, job: str, state: str, *,
                   missing: list[str] | None = None, detail: object | None = None,
                   count: str | None = None, key: str | None = None) -> dict | None:
    """Publish one idempotent operator update without making work depend on it."""
    update_key = key or hashlib.sha256(
        json.dumps([role, state, missing, str(detail), count], ensure_ascii=False).encode()
    ).hexdigest()[:16]
    if _already_published(job, update_key):
        return None
    text = format_update(role, state, missing=missing, detail=detail, count=count)
    try:
        from reporting import speak

        receipt = speak(publisher, job, text)
        # The prose reached a person; now make the same transition readable by a
        # program. Deliberately after, and deliberately unable to fail the work.
        publish_job_event(publisher, role, job, state, detail)
        event(job, publisher, "operator_update", {
            "key": update_key, "role": role, "state": state,
            "event_id": receipt.get("event_id") if isinstance(receipt, dict) else None,
        })
        return receipt
    except Exception as error:  # noqa: BLE001 - the local event is the retry record
        event(job, publisher, "operator_update_failed", {
            "key": update_key, "role": role, "state": state,
            "error": f"{type(error).__name__}: {error}"[:500],
        })
        return None


def pending_dependency_labels(dependencies: list[str] | None) -> list[str]:
    """Resolve only unfinished dependency roles for a human-facing message."""
    if not dependencies:
        return []
    placeholders = ",".join("?" for _ in dependencies)
    with database() as db:
        rows = db.execute(
            f"SELECT role,status FROM jobs WHERE id IN ({placeholders})",
            dependencies,
        ).fetchall()
    return [label(str(row["role"])) for row in rows if row["status"] != "done"]


def publish_delegation(publisher: str, role: str, job: str,
                       dependencies: list[str] | None = None) -> dict | None:
    """Announce a child, or its dependency wait, before invoking a model."""
    missing = pending_dependency_labels(dependencies)
    if missing:
        return publish_update(
            publisher, role, job, "blocked", missing=missing,
            key="delegated-blocked",
        )
    return publish_update(publisher, role, job, "delegated", key="delegated")


def summarize_children(rows: list[dict]) -> str:
    """Summarize child states without exposing the internal job protocol."""
    total = len(rows)
    counts = {state: sum(1 for row in rows if row.get("status") == state)
              for state in ("done", "running", "queued", "blocked", "failed", "cancelled")}
    names = {
        state: [label(str(row.get("role", "equipo"))) for row in rows
                if row.get("status") == state]
        for state in counts
    }
    parts = [
        f"{counts['done']} de {total} encargos completados",
        f"{counts['running'] + counts['queued']} en curso o pendientes",
        f"{counts['failed']} con incidencia",
        f"{counts['blocked']} bloqueados",
        f"{counts['cancelled']} cancelados",
    ]
    if names["done"]:
        parts.append("Entregas: " + ", ".join(names["done"]))
    if names["running"] or names["queued"]:
        parts.append("En curso: " + ", ".join(names["running"] + names["queued"]))
    if names["failed"]:
        parts.append("Requieren atención: " + ", ".join(names["failed"]))
    if names["blocked"]:
        parts.append("Esperan dependencia: " + ", ".join(names["blocked"]))
    if names["cancelled"]:
        parts.append("Cancelados: " + ", ".join(names["cancelled"]))
    return ". ".join(parts) + "."
