# PatchNotes

Red cog for the weekly update post. The API at `api_base_url` does the work;
this cog shows it to staff and posts it to #updates.

## The week

1. Friday 12:00 (Europe/Berlin) closes the note week. The host compares the
   week's first and last TFMCMain backups and the API writes the update post
   from that (`backend/src/patchnotes/weekly.py`, `compose.py`).
2. The cog posts a staff notice in the review channel, then the post exactly
   as players will see it, then Approve / Deny / Postpone. It waits up to an
   hour for the post; without one it falls back to the old line review.
3. Deny asks what should change and rewrites the whole post.
4. Friday 18:00 posts it to #updates as several messages. Only the first
   message pings the update role (`update_ping_role_id`, the TFer role).
5. The website keeps the full line list, including technical changes.

## Commands

| Command | What it does |
| --- | --- |
| `/patchnotes test-post [week] [here]` | Sends a test copy of the post to the review channel, or this channel with `here`. No buttons, nobody is pinged. |
| `/patchnotes write-post [week]` | Writes the post again from the server changes, dropping earlier feedback. |
| `/patchnotes act [act] [week]` | Titles an act change week's post with the act, such as `Act 1`. Empty clears it. |
| `/patchnotes refresh <week>` | Edits a week's #updates messages without pinging. |
| `/patchnotes test`, `sort`, `reset`, `pending`, `ping`, `folders`, ... | Unchanged line review tools. |

## Install or update

The live copy is `TFMCDiscordBot01/python-app-runner/cogs/CogManager/cogs/patchnotes/`.
Copy every file from this folder over it except `config.yml`, which holds the
staff key and stays as it is. Then reload the cog in Discord with
`[p]reload patchnotes`, or restart the bot instance.

Tests: run `python -m unittest test_format test_safety test_schedule` from
this folder. They need no Discord install.
