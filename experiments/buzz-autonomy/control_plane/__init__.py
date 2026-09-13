"""Control-plane roster and harness routing for the ten-agent team.

Pins the pilot home before any module that reads it is imported. `pilot.ROOT`
defaults to `~/.local/share/buzz-autonomy-pilot`, one level above the community
directory that actually holds `config.json` and the attested identities, and
`native_entry` compensates by setting `BUZZ_PILOT_HOME` on its own way in. A
launcher that skipped that step silently read a different, older config and
failed with a bare KeyError on a missing `auth_tag` — measured, not
hypothetical. Setting it here means every entry point into the control plane
resolves the same home.

`setdefault`, not assignment: an operator pointing at another community on
purpose must still win.
"""
import os
from pathlib import Path

PILOT_HOME = Path.home() / ".local/share/buzz-autonomy-pilot/sapira"
os.environ.setdefault("BUZZ_PILOT_HOME", str(PILOT_HOME))
