"""Turn a branch name into its preview subdomain.

Writes slug= and url= to $GITHUB_OUTPUT (or stdout outside Actions). The rules
match the server's ps-preview check: lowercase letters, digits and single
hyphens, at most 40 characters, and not a hostname the site already uses.
"""

import hashlib
import os
import re
import sys

DOMAIN = "tfminecraft.net"
MAX_LENGTH = 40
# Hostnames with their own DNS records or tunnel rules; a preview there could never be reached.
RESERVED = {"www", "dev", "api", "mail", "map", "admin", "staff", "play", "mc", "status", "preview", "t3"}
VALID = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?")


def slug_for(branch: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", branch.lower()).strip("-")
    if len(slug) > MAX_LENGTH:
        # Keep long names readable and still unique per branch.
        digest = hashlib.sha1(branch.encode()).hexdigest()[:6]
        slug = f"{slug[:MAX_LENGTH - 7].rstrip('-')}-{digest}"
    if not VALID.fullmatch(slug):
        raise ValueError(f"branch {branch!r} has no letters or digits to name a preview after")
    if slug in RESERVED:
        raise ValueError(f"{slug}.{DOMAIN} is already in use; rename the branch to get a preview")
    return slug


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: preview_slug.py <branch>")
    try:
        slug = slug_for(sys.argv[1])
    except ValueError as error:
        raise SystemExit(f"::error::{error}")
    lines = f"slug={slug}\nurl=https://{slug}.{DOMAIN}\n"
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a") as handle:
            handle.write(lines)
    else:
        sys.stdout.write(lines)


if __name__ == "__main__":
    main()
