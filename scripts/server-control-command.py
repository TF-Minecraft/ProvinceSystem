#!/usr/bin/python3 -I
"""Root-owned sudo boundary. Executed as amp, never as root."""
import os
import sys

INSTANCES = {"main": "TFMCMain01", "dev": "TFMCDev01"}
COMMANDS = {
    "list", "save-all flush", "stop", "maintenance on", "maintenance off",
    "broadcast &eThe server restart has been cancelled.",
    "broadcast &eThe server restart has been cancelled after a control connection restart.",
    "broadcast &c&lServer restart &7is starting now.",
    "broadcast &aThe restart is complete. The server is open.",
} | {
    f"broadcast &c&lServer restart &7in &f{time}&7. Finish what you are doing."
    for time in ("5 minutes", "3 minutes", "1 minute", "30 seconds", "10 seconds")
}


def main(argv):
    if len(argv) != 2 or argv[0] not in INSTANCES or argv[1] not in COMMANDS:
        raise SystemExit("Only approved Main/Dev server-control commands are allowed.")
    helper = "/usr/local/sbin/amp-ctl"
    os.execv(helper, [helper, "console", INSTANCES[argv[0]], argv[1]])


if __name__ == "__main__":
    main(sys.argv[1:])
