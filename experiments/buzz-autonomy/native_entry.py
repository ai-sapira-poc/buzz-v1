"""Entrypoint for Buzz-managed pilot identities; credentials stay outside prompts/git."""
import fcntl
import json
import os
from pathlib import Path
import runpy
import sys

os.environ.setdefault("BUZZ_PILOT_HOME", str(Path.home() / ".local/share/buzz-autonomy-pilot/sapira"))
from pilot import ROOT, ROLES, config, write_json


def public_key(secret):
    from cryptography.hazmat.primitives.asymmetric import ec
    if secret.startswith("nsec1"):
        alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
        bits = "".join(f"{alphabet.index(c):05b}" for c in secret[5:-6])
        raw = bytes(int(bits[i:i+8], 2) for i in range(0, 256, 8))
    else:
        raw = bytes.fromhex(secret)
    if len(raw) != 32:
        raise ValueError("Invalid managed identity length")
    return ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256K1()).public_key().public_numbers().x.to_bytes(32, "big").hex()


def bind():
    role = os.environ.get("BUZZ_PILOT_ROLE", "maestro")
    if role not in ROLES:
        raise ValueError("Unknown role")
    relay = os.environ.get("BUZZ_RELAY_URL", "")
    if relay.rstrip("/") not in {"wss://blockbuzzmain-production-6923.up.railway.app", "https://blockbuzzmain-production-6923.up.railway.app"}:
        raise RuntimeError("Pilot harness requires the existing Sapira community")
    secret = os.environ["BUZZ_PRIVATE_KEY"]
    identity = {"pubkey": public_key(secret), "secret": secret, "auth_tag": os.environ.get("BUZZ_AUTH_TAG", "")}
    if not identity["auth_tag"]:
        raise RuntimeError("Buzz owner attestation missing")
    with (ROOT / "bind.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        c = config()
        previous = c["identities"].get(role)
        if previous and previous["pubkey"] != identity["pubkey"]:
            raise RuntimeError("Role already belongs to a different managed identity")
        c["identities"][role] = identity
        write_json(ROOT / "config.json", c)
    os.environ["HERMES_HOME"] = str(ROOT / "profiles" / role)


if __name__ == "__main__":
    bind()
    runpy.run_path(str(Path(__file__).with_name("adapter.py")), run_name="__main__")
