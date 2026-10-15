#!/usr/bin/env python
"""b2_gate_adapter - the Remote Gate adapter: one structured Gate payload in, one existing
ControlBridge request out.

The chain this file completes, and nothing beyond it::

    B2 remote surface (7 tools; hanako_engineering_submit.request carries kind=APPROVE_GATE)
      -> this adapter            check the two required fields, name the owner
      -> ControlBridge.route()   write ONE request file (the existing request path)
      -> d2_control.py drain     project-lab's own drain reads that file
      -> d2_control.gate()       the Human Gate authority decides
      -> project-lab Gate truth  (the only gate store that exists)

What this file refuses to be:

* **not a gate store.** It keeps no state, no queue, no attempt log. The request file is
  ControlBridge's; the decision is project-lab's; the gate row is project-lab's.
* **not an authority.** It never settles a gate, never writes a receipt, and never says APPLIED.
  ``route()`` returns ``None`` for a project-lab-owned action, and that ``None`` is the honest
  answer (PENDING), not a success.
* **not a second policy copy.** The payload reaches ControlBridge unchanged, so the authority
  string, the field names and the request path all come from the existing Python path. Only the
  two required fields and the owner name are checked here, because a remote caller has no way to
  be trusted with an implicit gate choice - the same rule ``d2_control.gate()`` enforces on its
  own side.

Where the request lands is part of the contract, not a default. ``ControlBridge(None)`` resolves to
``oh_runtime``'s own ``state/control``, which no production drain reads, so a Remote Gate routed
there would be a PENDING request dressed as progress. The production root is named here, once, and
an isolated fixture moves it with ``HANAKO_GATE_CONTROL_ROOT`` or ``--control`` rather than by
editing this file.

Boundary: stdlib only. No ``sqlite3``, no ``subprocess``, no second store, no new mailbox.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

#: The canonical runtime package, so ``oh_runtime`` here is the same build d2_control drains.
RUNTIME_ROOT = Path(
    os.environ.get("HANAKO_OH_ROOT") or r"E:\CHATGPT\projects\openhanako-runtime"
)
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))

from oh_runtime.control_bridge import ControlBridge  # noqa: E402
from oh_runtime.operator import (  # noqa: E402
    ControlClass,
    ControlCommand,
    ControlKind,
    OperatorInvariantError,
)

GATE_KINDS = ("APPROVE_GATE", "REJECT_GATE")
OWNER = "project-owner"
#: The root the production drain reads. Not ``oh_runtime``'s own ``state/control``: a Remote Gate
#: written there is a request production never drains, which is the wiring defect this replaces.
GATE_CONTROL_ROOT_ENV = "HANAKO_GATE_CONTROL_ROOT"
DEFAULT_CONTROL_ROOT = Path(r"E:\CHATGPT\work\bridge\engineering\control")
#: The command_id becomes the request file name, so it must be a usable path segment. Same rule
#: the engineering door applies to request_id, and the reason it is checked here too.
COMMAND_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
GATE_AUTHORITY = "project-lab Human Gate"


def _error(code: str, message: str, **extra: object) -> dict[str, object]:
    return {"ok": False, "tool": "hanako_engineering_submit", "error": {"code": code, "message": message}, **extra}


def resolve_control_root(explicit: str | Path | None = None) -> Path:
    """The ControlBridge root to write into: the argument, then the env, then production.

    A fixture isolates itself by naming a root, never by changing what production means, so the
    precedence is resolution order and not a special case for tests.
    """
    if explicit is not None and str(explicit).strip():
        return Path(explicit)
    override = (os.environ.get(GATE_CONTROL_ROOT_ENV) or "").strip()
    return Path(override) if override else DEFAULT_CONTROL_ROOT


def _decide(payload: object) -> tuple[dict[str, str] | None, dict[str, object] | None]:
    """Return (fields, refusal). Exactly one of the two is set."""
    if not isinstance(payload, dict):
        return None, _error("BAD_REQUEST", "the gate request must be a JSON object")

    kind = str(payload.get("kind") or payload.get("command_type") or "").strip().upper()
    if kind not in GATE_KINDS:
        return None, _error(
            "UNKNOWN_GATE_COMMAND",
            f"kind must be one of {', '.join(GATE_KINDS)}; got {kind or 'nothing'}",
        )

    task_id = str(payload.get("task_id") or "").strip()
    if not task_id:
        return None, _error(
            "MISSING_TASK_ID", "task_id is required: a Human Gate belongs to exactly one task"
        )

    gate_id = str(payload.get("gate_id") or "").strip()
    if not gate_id:
        return None, _error(
            "MISSING_GATE_ID",
            "gate_id is required: a remote caller may not approve 'whatever is pending' on a task",
        )

    confirmer = str(payload.get("confirmed_by") or OWNER).strip()
    if confirmer != OWNER:
        return None, _error(
            "NOT_PROJECT_OWNER",
            f"only {OWNER} may settle a Human Gate; this request names {confirmer or 'nobody'}",
        )

    raw_id = str(payload.get("request_id") or "").strip()
    command_id = f"gate-{raw_id}" if raw_id else f"gate-{task_id}-{gate_id}"
    if not COMMAND_ID.match(command_id):
        return None, _error(
            "COMMAND_ID_UNUSABLE",
            f"the derived command_id {command_id!r} cannot name a request file; request_id must "
            f"match {COMMAND_ID.pattern}",
        )

    return {"command_id": command_id, "kind": kind, "task_id": task_id, "gate_id": gate_id}, None


def submit_gate(payload: object, *, control_root: str | Path | None = None) -> dict[str, object]:
    """Route one Gate command. Returns a JSON-ready dict; never settles anything itself."""
    fields, refusal = _decide(payload)
    if fields is None:
        return refusal if refusal is not None else _error("BAD_REQUEST", "the request was unusable")

    kind = ControlKind(fields["kind"])
    command = ControlCommand(
        command_id=fields["command_id"],
        project_id="project-lab",
        conversation_id=str((payload or {}).get("conversation_id") or fields["command_id"]),
        kind=kind,
        control_class=ControlClass.STRUCTURED_COMMAND,
        payload={
            "gate_id": fields["gate_id"],
            "task_id": fields["task_id"],
            # Defence in depth, mirroring d2_control.gate(): a remote command must name its gate.
            "require_explicit_gate": "true",
        },
        task_id=fields["task_id"],
        confirmed_by=OWNER,
    )

    bridge = ControlBridge(resolve_control_root(control_root))
    receipt = bridge.route(command)
    if receipt is not None:
        # The routing table says project-lab owns this effect; a local receipt here would mean the
        # bridge claimed a Human Gate for itself, which it must never do.
        return _error(
            "UNEXPECTED_LOCAL_RECEIPT",
            f"the bridge answered {receipt.status.value} locally; a Human Gate stays project-lab's",
            command_id=command.command_id,
        )

    request_path = bridge.request_dir / f"{command.command_id}.json"
    receipt_path = bridge.receipt_dir / f"{command.command_id}.json"
    settled = receipt_path.is_file()
    return {
        "ok": True,
        "tool": "hanako_engineering_submit",
        "kind": kind.value,
        "status": "SETTLED" if settled else "PENDING",
        "command_id": command.command_id,
        "command_type": kind.value,
        "authority": GATE_AUTHORITY,
        # Which bridge root actually took the request. Stated so "did it reach production?" is a
        # fact in the answer instead of an assumption about a default.
        "control_root": str(bridge.root),
        "task_id": fields["task_id"],
        "gate_id": fields["gate_id"],
        "confirmed_by": OWNER,
        "request_path": str(request_path),
        "receipt_path": str(receipt_path) if settled else None,
        "duplicate": settled,
        "note": (
            "This gate already has a receipt; the decision stands and no second request was "
            "needed."
            if settled
            else "Routed to project-lab as a PENDING request. Nothing is settled until "
            "d2_control's drain writes a receipt."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="route one structured Gate payload to the existing ControlBridge request path"
    )
    parser.add_argument(
        "--control",
        default=None,
        help=(
            f"ControlBridge root; defaults to ${GATE_CONTROL_ROOT_ENV} when set, otherwise the "
            f"production root {DEFAULT_CONTROL_ROOT}"
        ),
    )
    parser.add_argument(
        "--request",
        default=None,
        help="path to the gate request JSON; standard input is read when omitted",
    )
    options = parser.parse_args(argv)

    if options.request:
        try:
            raw = Path(options.request).read_text(encoding="utf-8")
        except OSError as error:
            print(json.dumps(_error("REQUEST_UNREADABLE", str(error)), ensure_ascii=False))
            return 2
    else:
        raw = sys.stdin.read()

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        print(json.dumps(_error("BAD_JSON", f"not valid JSON: {error}"), ensure_ascii=False))
        return 2

    try:
        result = submit_gate(payload, control_root=options.control)
    except OperatorInvariantError as error:
        result = _error("INVARIANT", str(error))

    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
