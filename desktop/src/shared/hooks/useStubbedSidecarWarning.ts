import * as React from "react";
import { toast } from "sonner";

import { invokeTauri } from "@/shared/api/tauri";

type SidecarHealth = { stubbed: string[]; checked: boolean };

/**
 * Warn once, at startup, when the bundled sidecars are empty stubs.
 *
 * `just desktop-release-build` creates them with `touch`; CI replaces them with
 * real binaries. A local build therefore ships zero-byte sidecars and every
 * agent feature fails at the moment of use, with an error that reads like a
 * product bug. Building them for real costs 15–25 minutes per build, which is
 * not worth paying locally — saying so up front costs nothing.
 */
export function useStubbedSidecarWarning() {
  const warned = React.useRef(false);

  React.useEffect(() => {
    if (warned.current) return;
    warned.current = true;

    void invokeTauri<SidecarHealth>("get_sidecar_health")
      .then((health) => {
        if (!health.checked || health.stubbed.length === 0) return;
        toast.warning("Agent features are unavailable in this build", {
          description: `${health.stubbed.length} bundled helper${
            health.stubbed.length === 1 ? " is" : "s are"
          } an empty placeholder (${health.stubbed.join(", ")}). Local builds stub them; CI builds ship the real ones.`,
          duration: 12_000,
        });
      })
      // A diagnostic must never be the thing that breaks startup.
      .catch(() => {});
  }, []);
}
