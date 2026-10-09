"""Player-facing Discord text for a week's patch notes.

Discord gets the short highlight list. The full note stays on the website.
Technical bullets stay off the message. A deny reason is never read.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

DISCORD_LIMIT = 2000
_FOLDER_LABELS = {
    "repo": "GitHub plugins",
    "content": "Content packs",
    "added": "Added folders",
}
# The Discord post is the summary. The rest of the week lives on the website.
HIGHLIGHT_LIMIT = 6
HEADLINES_PER_SECTION = HIGHLIGHT_LIMIT
_HEADLINE_CHARS = 180
_WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")
_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def week_label(week: str) -> str:
    """Monday of an ISO week, in UTC. An unrecognised key is returned as-is."""
    match = _WEEK_RE.match(week.strip())
    if match is None:
        return week
    year, week_num = int(match.group(1)), int(match.group(2))
    if not 1 <= week_num <= 53:
        return week
    jan4 = datetime(year, 1, 4, tzinfo=timezone.utc)
    iso_weekday = jan4.isoweekday()
    monday = datetime.fromtimestamp(
        jan4.timestamp() - (iso_weekday - 1) * 86400 + (week_num - 1) * 7 * 86400,
        tz=timezone.utc,
    )
    return f"Week of {monday.day} {_MONTHS[monday.month - 1]} {monday.year}"


def _body(bullet: dict) -> str:
    return str(bullet.get("body") or "").strip()


def _headline(text: str) -> str:
    compact = " ".join(text.split())
    if len(compact) <= _HEADLINE_CHARS:
        return compact
    return compact[: _HEADLINE_CHARS - 1].rstrip() + "…"


def _summary(bullets: list[dict]) -> tuple[list[str], bool]:
    """Highlight lines, and whether the website has more than this list."""
    flagged: list[str] = []
    changes: list[str] = []
    fixes: list[str] = []
    technical = False
    for bullet in bullets:
        if not isinstance(bullet, dict):
            continue
        section = str(bullet.get("section") or "")
        text = _headline(_body(bullet))
        if not text:
            continue
        if section == "technical":
            technical = True
            continue
        if bullet.get("highlight") is True:
            flagged.append(text)
        elif section in ("new", "adjusted"):
            changes.append(text)
        elif section == "fixed":
            fixes.append(text)
    chosen = flagged or changes or fixes
    omitted = len(chosen) > HIGHLIGHT_LIMIT or technical
    if flagged and (changes or fixes):
        omitted = True
    if changes and fixes and not flagged:
        omitted = True
    return chosen[:HIGHLIGHT_LIMIT], omitted


def week_page_url(page_url: str, week: str) -> str:
    """Landing page plus this week. `page_url` stays the /updates index."""
    base = page_url.strip().rstrip("/")
    if not base:
        return ""
    suffix = f"/{week}"
    if base.endswith(suffix):
        return base
    return f"{base}{suffix}"


def review_page_url(page_url: str, week: str) -> str:
    """Staff review page for one week."""
    base = page_url.strip().rstrip("/")
    return f"{base}/review?week={week}" if base else ""


def updates_message(
    week: str,
    bullets: list[dict],
    page_url: str,
    mention: str | None = None,
) -> str:
    """Highlights for Discord. The website keeps every line, grouped by topic."""
    link = week_page_url(page_url, week)
    items, omitted = _summary(bullets)
    lines: list[str] = []
    if mention:
        lines.append(mention)
    lines.append(f"**{week_label(week)}**")
    if items:
        lines.append("**Highlights**")
        lines.extend(f"• {item}" for item in items)
    if omitted:
        lines.append("The full notes are on the site.")
    if link:
        lines.append(link)
    text = "\n".join(lines)
    if len(text) <= DISCORD_LIMIT:
        return text
    if link and text.endswith(link):
        room = DISCORD_LIMIT - len(link) - 1
        if room > 1:
            return text[: room - 1].rstrip() + "…\n" + link
    return text[: DISCORD_LIMIT - 1] + "…"


def postponement_message(week: str) -> str:
    """The public line when staff hold a week past 18:00."""
    return f"The patch notes for {week_label(week)} have been postponed until next week."


# The review notice stays in the message content. Player-facing lines go in
# the embed, which allows a 4096 character description.
REVIEW_DESCRIPTION_LIMIT = 4096
_REVIEW_LABELS = (
    ("new", "New"),
    ("fixed", "Fixed"),
    ("adjusted", "Adjusted"),
)


def review_notice(
    week: str,
    *,
    bullets: list[dict] | None = None,
    mention: str | None = None,
    rewritten: bool = False,
    page_url: str = "",
) -> str:
    """The text above the line list. A deny reason is not included."""
    lines: list[str] = []
    if mention:
        lines.append(mention)
    if rewritten:
        lines.append(f"**{week_label(week)}**")
    else:
        lines.append(f"**{week_label(week)}** is ready to review.")
    if bullets is not None:
        counts = {"new": 0, "fixed": 0, "adjusted": 0, "technical": 0}
        for bullet in bullets:
            if isinstance(bullet, dict):
                section = str(bullet.get("section") or "")
                if section in counts:
                    counts[section] += 1
        lines.append(", ".join(f"{count} {section}" for section, count in counts.items()) + ".")
    link = review_page_url(page_url, week)
    if link:
        lines.append(f"Read and edit every line here: {link}")
    if rewritten:
        lines.append("Rewritten from that feedback. Deny again if it is still not right.")
        lines.append("Lines still waiting at 18:00 are approved.")
    else:
        lines.append(
            "Deny once with everything that should change. "
            "That text rewrites the note. It is not the new wording."
        )
        lines.append("The updated note is posted here again.")
        lines.append("Lines still waiting at 18:00 are approved.")
        lines.append(
            "Postpone holds the whole week. Confirm it, and undo it if that was a misclick."
        )
        lines.append("Anything new after noon waits for next week.")
        lines.append("Lore items are hidden knowledge. Deny feedback that would reveal one.")
    text = "\n".join(lines)
    if len(text) <= DISCORD_LIMIT:
        return text
    return text[: DISCORD_LIMIT - 1] + "…"


def review_parts(notice: str, bullets: list[dict]) -> tuple[str, str]:
    """Keep the notice in message content and the player lines in the embed."""
    return notice[:DISCORD_LIMIT], review_lines(bullets)


def review_lines(bullets: list[dict], *, limit: int = REVIEW_DESCRIPTION_LIMIT) -> str:
    """Player-facing lines for staff review, grouped by section."""
    grouped: dict[str, list[str]] = {key: [] for key, _label in _REVIEW_LABELS}
    for bullet in bullets:
        if not isinstance(bullet, dict):
            continue
        text = " ".join(_body(bullet).split())
        if not text:
            continue
        if str(bullet.get("warning") or "").strip():
            text += " (hidden knowledge)"
        section = str(bullet.get("section") or "")
        if section in grouped:
            grouped[section].append(text)
    lines: list[str] = []
    for key, label in _REVIEW_LABELS:
        items = grouped[key]
        if not items:
            continue
        lines.append(f"**{label}**")
        lines.extend(f"• {item}" for item in items)
    if not lines:
        return "No player-facing lines are waiting for this week."
    full = "\n".join(lines)
    if len(full) <= limit:
        return full
    bullet_count = sum(1 for line in lines if line.startswith("• "))
    prefix: list[str] = []
    included_bullets = 0
    for line in lines:
        next_bullets = included_bullets + int(line.startswith("• "))
        omitted = bullet_count - next_bullets
        suffix = f"… {omitted} more lines are on the review page." if omitted else ""
        candidate = "\n".join(prefix + [line])
        if suffix:
            candidate += "\n" + suffix
        if len(candidate) > limit:
            break
        prefix.append(line)
        included_bullets = next_bullets
    omitted = bullet_count - included_bullets
    suffix = f"… {omitted} more lines are on the review page."
    if omitted:
        while prefix and len("\n".join(prefix + [suffix])) > limit:
            removed = prefix.pop()
            if removed.startswith("• "):
                included_bullets -= 1
            omitted = bullet_count - included_bullets
            suffix = f"… {omitted} more lines are on the review page."
        return "\n".join(prefix + [suffix])
    return "\n".join(prefix)


def folders_message(folders: list[dict]) -> str:
    """Staff list of watched plugin folders, grouped by why they are watched."""
    grouped: dict[str, list[str]] = {key: [] for key in _FOLDER_LABELS}
    for folder in folders:
        if not isinstance(folder, dict):
            continue
        origin = str(folder.get("origin") or "")
        if origin not in grouped:
            continue
        name = str(folder.get("name") or "").strip()
        if not name:
            continue
        status = str(folder.get("status") or "")
        if status == "active":
            label = "watching"
        elif status == "rejected":
            reason = str(folder.get("reject_reason") or "rejected").strip()
            label = reason
        else:
            label = "checking"
        if folder.get("dangerous"):
            label += " — notes stay vague"
        unclassified = folder.get("unclassified") if isinstance(folder.get("unclassified"), list) else []
        if unclassified and status == "active":
            shown = ", ".join(str(item) for item in unclassified[:3])
            label += f" — left out: {shown}"
        if folder.get("sync_task"):
            label += " — GitHub update queued"
        grouped[origin].append(f"• {name} — {label}")

    lines = ["**Watched folders**"]
    for origin, title in _FOLDER_LABELS.items():
        items = grouped[origin]
        if not items:
            continue
        lines.append(f"**{title}**")
        lines.extend(items[:25])
        if len(items) > 25:
            lines.append(f"• …and {len(items) - 25} more")
    if len(lines) == 1:
        lines.append("Nothing is watched yet.")
    text = "\n".join(lines)
    if len(text) <= DISCORD_LIMIT:
        return text
    return text[: DISCORD_LIMIT - 1] + "…"


# The weekly Discord post: a few messages written from the week's server
# changes. The role ping is added in front of the first message only.


def post_title(post: dict) -> str:
    """`Update 5.3`, or `Act 1 (Update 5.3)` on an act change week."""
    label = str(post.get("label") or "").strip()
    act = str(post.get("act") or "").strip()
    title = f"Update {label}" if label else "Weekly update"
    return f"{act} ({title})" if act else title


def post_messages(post: dict, mention: str | None = None) -> list[str]:
    """The post as Discord messages, with the ping in front of the first.

    A first message too long to share with the ping gets the ping as a message of its own.
    """
    messages = [str(item) for item in post.get("messages") or [] if str(item).strip()]
    if mention and messages:
        first = f"{mention}\n{messages[0]}"
        if len(first) <= DISCORD_LIMIT:
            messages[0] = first
        else:
            messages.insert(0, mention)
    return messages


def post_review_notice(
    week: str,
    post: dict,
    *,
    mention: str | None = None,
    rewritten: bool = False,
) -> str:
    """The staff text above the copy of the post in the review channel."""
    lines: list[str] = []
    if mention:
        lines.append(mention)
    title = post_title(post)
    if rewritten:
        lines.append(f"**{title}** for {week_label(week)} was rewritten from that feedback.")
    else:
        lines.append(f"**{title}** for {week_label(week)} is ready to review.")
    lines.append("Below is exactly what goes to #updates at 18:00, ping included.")
    if post.get("source") == "fallback":
        lines.append(
            "The writer did not finish, so this is a plain list from the server changes. "
            "Deny with feedback to have it written properly."
        )
    lines.append(
        "Deny once with everything that should change. That text rewrites the whole post. "
        "It is not the new wording."
    )
    lines.append("Postpone holds the whole week. Nothing is posted if you postpone.")
    lines.append("If nobody acts, the post goes out at 18:00.")
    return "\n".join(lines)[:DISCORD_LIMIT]


def post_review_controls(post: dict) -> str:
    return f"End of **{post_title(post)}**. Approve, Deny with feedback, or Postpone."


def post_test_notice(week: str, post: dict) -> str:
    """The banner above a test copy. Test copies have no buttons and ping nobody."""
    lines = [
        f"# Test: {post_title(post)}",
        f"Draft for {week_label(week)}, for staff to read before approving.",
        "Nothing was posted to #updates and nobody was pinged. This copy has no buttons.",
    ]
    if post.get("source") == "fallback":
        lines.append("The writer did not finish, so this is the plain list from the server changes.")
    if str(post.get("status") or "") == "approved":
        lines.append("This post is already approved.")
    return "\n".join(lines)


def post_test_end() -> str:
    return "-# End of the test copy."

