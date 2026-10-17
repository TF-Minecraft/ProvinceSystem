# Servers

[Project index](../../README.md) · [Source module](../../../backend/src/servers)

The staff panel's Servers tab compares every TFMC plugin's latest GitHub
release with the jar Main and Dev have installed and the version each server
is running. `GET /admin/servers` serves it to admins and the owner
(`view_servers`). The comparison reads server files; the separate control
connection below installs released jars and restarts servers.

## What the tab shows

Each server has a card showing whether it is running, its Paper version and
how many plugins have each kind of problem. Below them,
**Needs a look** lists the plugins with a problem, worst first; **TFMC
plugins** lists every plugin, and **Other plugins** compares third-party jars
between Main and Dev by version. Each row shows the plugin's latest release
beside the version each server runs, dimmed when it matches that release.
Hovering a version shows the jar's file name.

Under each latest release, a mark compares it with the repository's default
branch (`main`, or `master` for CoreProtect) and links to GitHub's comparison:

| Mark | Meaning |
| --- | --- |
| `= main` | The release is the branch's latest commit. |
| `main +3` | The branch has 3 commits since the release: merged work that is not released yet. Commits that only change docs or CI count too. |
| `Off main` | The release has commits that aren't on the branch, such as a tag on a feature branch. |
| No mark | There is no GitHub token, or GitHub couldn't compare them. |

A plugin is any active repository in the organisation whose published
releases carry a jar. The latest is GitHub’s designated Latest release; if it
has no eligible jar, the newest eligible release found in release history is
used. Drafts and pre-releases are ignored. A later maintenance release does
not displace a newer major unless GitHub marks it Latest. Each server copy
gets these labels:

| Label | Meaning |
| --- | --- |
| No label | The jar is the latest release's file and the server is running it. |
| Not a release (Main) | The jar's SHA-256 matches no published release, whatever its name. |
| Test build (Dev) | The same on Dev, where test builds are allowed. |
| Unverified | GitHub or the check deadline prevented complete checksum verification. This is not proof of a test build. |
| Older release | The jar is an earlier release's file. |
| Needs restart | The server enabled a different version at its last startup, or a jar waits in `plugins/update/`. The cell shows the running version, then the version on disk. |
| Didn't start | The last startup finished without enabling the plugin. |
| Two jars | Two jars of the plugin sit in `plugins/`. |
| Not installed | No jar. Not counted as a problem. |

Jars are matched to plugins by SHA-256 first, using the digests GitHub reports
for release assets, then by the release file's name before its version (for
example `tfmccore-`) or the stable Bukkit plugin identifier. A filename or
embedded version only selects a lookup candidate; a matching published asset
checksum is required to identify a release. This also recognizes renamed
older jars with their original plugin identifier. The running version comes from the
`Enabling <name> v<version>` lines of the most recent startup in `logs/`;
plugins that then report an enable failure or disable before startup finishes
are excluded from the running versions.
Paper also starts a new log at midnight, so up to twelve rotated logs are read
until one holds a startup. A jar replaced with another of the same version
since the last startup is not detected.

## Settings

| Variable | Meaning |
| --- | --- |
| `SERVER_MAIN_DIR`, `SERVER_DEV_DIR` | A folder inside the backend container holding the server's `plugins` and `logs` folders. Unset: the server's card says the site is not set up to read it. |
| `SERVERS_GITHUB_TOKEN` | A read-only GitHub token, falling back to `PATCHNOTES_GITHUB_TOKEN`. Each check discovers active repositories afresh, then reads current releases in groups of eight with at most six queries concurrently. Without a token, fresh REST reads remain available but can quickly reach GitHub’s unauthenticated limit. |
| `SERVERS_GITHUB_ORG` | The organisation to read. Defaults to `TF-Minecraft`. |

Main loads its token from `backend/.env`. Configure Dev's administrator-managed
Compose override to load a token-only project-root `.env` with `env_file`, using
the same read-only `SERVERS_GITHUB_TOKEN`. The host's `environment: !override`
can discard entries from the base Compose file; an environment file avoids that.
Keep secret files outside Git and recreate the backend after configuration changes.
The deployment account's read-only Compose mounts require administrator access
for this wiring.

Mount the folders read-only in the host's `docker-compose.override.yml`:

```yaml
services:
  backend:
    volumes:
      - /home/amp/.ampdata/instances/TFMCMain01/Minecraft/plugins:/servers/main/plugins:ro
      - /home/amp/.ampdata/instances/TFMCMain01/Minecraft/logs:/servers/main/logs:ro
      - /home/amp/.ampdata/instances/TFMCDev01/Minecraft/plugins:/servers/dev/plugins:ro
      - /home/amp/.ampdata/instances/TFMCDev01/Minecraft/logs:/servers/dev/logs:ro
    environment:
      - SERVER_MAIN_DIR=/servers/main
      - SERVER_DEV_DIR=/servers/dev
```

Every page load and **Check again** waits for a fresh check. There is no
release-response cache, background refresh, hash memo or reuse of an earlier
check. Local jar hashing and startup-log reads run alongside GitHub queries.
Equal release/default-branch commit hashes avoid a comparison request;
unequal hashes request the commit count. Missing commit information leaves
the branch mark unknown.

Older installed versions first try their exact release tags and verify the
asset checksum. Only unmatched jars need their candidate repository’s release
history. Release and asset pagination must finish or find the matching bytes;
an interrupted search is Unverified, never proof that a jar is unreleased.

A check has a 20-second GitHub deadline. At most two checks per backend
process use GitHub concurrently; extra checks report busy rather than sharing
results. Local inventory remains visible when GitHub is unavailable. Partial
repository failures show unknown releases. A failed browser request keeps the
previous result’s own timestamp and shows **Check failed**; an older response
cannot replace a later successful check.

## Restart and release controls

Admins and the owner (`manage_servers`) can review and start a restart,
cancel Main's five-minute countdown before installation starts, and recheck a
failed restart before reopening. Each server's card holds its buttons and shows
the restart's progress; the review opens as a dialog. Dev starts immediately
after confirmation.
Main's unchecked **Emergency: skip the countdown** option skips the countdown
for emergencies, recording the flag, actor and reason. It skips the fresh AMP
backup but still saves and runs release/file verification and startup checks.
Instant restarts begin installation immediately and cannot be cancelled.
The www website can control Main and Dev; the Dev
website can control Dev only. Every action requires the site's own origin,
a current signed-in session and a reason, and is recorded in the staff audit.
View-as sessions cannot issue these actions.

**Restart** activates the jars already on disk. **Update and restart**
upgrades installed TFMC plugins whose hashes identify known older published
releases. Non-increasing versions and plugins not installed on the target are
skipped; the review shows those skips.

A jar whose hash matches no published release is a test build. The review
lists each one with a checkbox to replace it with the latest release, and
warns when the test build reports a higher version than the release. They are
ticked by default on Main and unticked on Dev, where a test build is often
someone's work in progress. The start request names the chosen plugins in
`replace_test_builds`; the helper rejects names that are not test builds in
the plan, and the audit records the list. Unchosen test builds are left on
disk, are not checked as changes, and are recorded in the plan as
`test_build_kept`. Main still requires the release to have run on Dev.

The helper must be able to read every jar. A jar moved into `plugins` keeps
its own permissions, so make it `0644` first; otherwise every plan for that
server, and every Main update plan, stops with "A plugin jar can’t be read".
A release plan performs its own fresh GitHub and target-server check.
Unavailable or unverified release information prevents the plan. It passes
the exact installed filenames and SHA-256 values to the helper, which rejects
a changed inventory before preparing a plan. The helper still rechecks the
approved baseline before installation. The stored plan pins the artifacts
staff approved; it is not a cache for later panel checks.

Main upgrades also require the target release's exact bytes to be on Dev,
with its version enabled without a subsequent enable failure or disable at
Dev's last completed startup. A jar changed after
that startup is not proof and is skipped. This check proves that the release
was loaded; staff must still verify its changed features and dependencies.
Related migrations must be deployed as a reviewed set with a recovery plan.
Use the manual deployment procedure when the proposed set needs offline work.
The bulk button does not publish releases or replace unreleased fixes.

Using its [AMP login](#amp-login), the helper asks AMP for a backup of Main as
the countdown starts and records it on the job as `backup`. When the countdown
ends it waits up to twenty minutes for AMP to finish, broadcasting
`Finishing a backup before the restart.` while it waits. A failed or overdue
backup calls the restart off before maintenance; nothing is installed. Dev
restarts and Main's emergency override take no fresh backup. The review says
which applies and shows the latest AMP ZIP backup time. AMP backs up the
instance folder, not external databases, so prepare those and any migration
recovery separately. Each backup takes one of Main's nine AMP backup slots,
so the next scheduled backup deletes the oldest. The helper also keeps the
jars it replaces.

After Main's countdown, or immediately for Dev and Main's emergency override,
the helper enables maintenance and confirms it, sends `save-all
flush` and waits for its save confirmation. It rechecks the files against the
reviewed plan, backs up changed jars outside plugin loading paths, installs
verified files with new inodes, then sends console `stop`. AMP relaunches
Paper. The helper never uses AMP instance `stop` or `restart`, kills Java,
or runs reload commands.

A new completed startup must load every changed plugin and every previously
working plugin at its expected version, with the planned hashes on disk and
no new startup error messages. An unchanged plugin with an explicitly recorded
enable failure may retain that same failure at the same version. It is not
shown as a staged activation and never counts as a verified Dev release.
Existing errors are recorded in the plan and compared as distinct messages,
preserving severity and normalizing worker thread numbers in log headers.
Repeated copies of the same known error do not prevent reopening; a new
message still fails the check. Older saved plans use the same comparison.
Plans expire after ten
minutes. A changed file invalidates the plan even when its size and
modification time are unchanged.

For Main release upgrades and restarts that activate staged plugin versions,
successful startup leaves maintenance on with
**Startup passed**. Check the changed features, then use **Recheck and
reopen** with a reason. This also applies to Main's emergency override. Dev
upgrades and restarts with no Main plugin activation reopen after the
automatic checks pass. Cancellation, reopening and failure resolution also
require reasons.

## Host connection setup

The website's read-only jar/log mounts remain separate from control. Control
uses the `tfmc-server-control` system service, running as the locked
`tfmc-server-control` account: `/usr/sbin/nologin`, a locked password, and no
AMP, Docker or sudo groups. The unit sets `NoNewPrivileges=true`, so the helper
cannot gain privileges through sudo or setuid programs. It reaches Minecraft
only through the AMP API and the plugin, log and backup folders the unit
exposes. The service starts at boot, independently of user login sessions.

The administrator installs the service from a reviewed commit on TFMCWeb
`main`. This needs Python 3.10+, systemd 249 or later and the ACL tools
(`setfacl`), then the account and file access below, the
[AMP login](#amp-login), and finally the unit and modules.

### Account and file access

Create the website backends' socket group and the locked service account:

```sh
sudo groupadd --system --gid 996 tfmc-control
sudo useradd --system --user-group --home-dir /var/lib/tfmc-server-control \
  --no-create-home --shell /usr/sbin/nologin tfmc-server-control
sudo passwd -l tfmc-server-control
```

The account needs traversal of the instance paths, write access to each
`plugins` folder to replace jars with new files, read access to Maintenance's
configuration and the logs, and the names and times, but not the contents, of
AMP's backup archives. Before granting, check that every path below exists and
none is a symlink:

```sh
account=tfmc-server-control
instances=/home/amp/.ampdata/instances
sudo setfacl -m "u:$account:--x" /home/amp /home/amp/.ampdata "$instances"
for instance in TFMCMain01 TFMCDev01; do
  root=$instances/$instance
  plugins=$root/Minecraft/plugins
  logs=$root/Minecraft/logs
  sudo setfacl -m "u:$account:--x" "$root" "$root/Minecraft"
  sudo setfacl -m "u:$account:rwx,d:u:$account:r--" "$plugins"
  sudo find "$plugins" -maxdepth 1 -type f -name '*.jar' | while read -r jar; do
    sudo runuser -u "$account" -- test -r "$jar" || sudo setfacl -m "u:$account:r--" "$jar"
  done
  sudo setfacl -m "u:$account:r-x,d:u:$account:r--" "$plugins/Maintenance"
  sudo setfacl -m "u:$account:r--" "$plugins/Maintenance/config.yml"
  sudo setfacl -R -m "u:$account:r-X" "$logs"
  sudo setfacl -m "d:u:$account:r-x" "$logs"
  if sudo test -d "$root/Backups"; then
    sudo setfacl -m "u:$account:r-x,d:u:$account:---" "$root/Backups"
    sudo find "$root/Backups" -mindepth 1 -maxdepth 1 -exec setfacl -m "u:$account:---" {} +
  fi
done
```

The default entries give new jars, Maintenance files and logs the same
access, and deny new backup archives. Only jars the account can't already read
get an entry, because a new ACL changes a jar's change time, which the Dev
verification check compares with the last startup.

### Installing the service

From a checkout of the commit:

```sh
sudo install -d -m 755 -o root -g root /usr/local/lib/tfmc-server-control/backend/src/servers
sudo install -m 644 -o root -g root backend/src/servers/{__init__,control,host,inventory}.py \
  /usr/local/lib/tfmc-server-control/backend/src/servers/
sudo install -m 755 -o root -g root scripts/server-control-update.py /usr/local/sbin/tfmc-server-control-update
sudo install -m 644 -o root -g root scripts/tfmc-server-control.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tfmc-server-control.service
sudo /usr/local/sbin/tfmc-server-control-update <full commit>
```

Skip the module copy when the helper is already installed: the updater
replaces the modules itself and records the commit. When the modules change it
restarts the service, which then runs under the new unit; when they don't,
restart the service yourself. After a change to the unit or the updater,
install the updater, then install the unit, run `daemon-reload` and run the
updater with the new commit back to back, with no active restart. The updater
refuses a commit whose unit differs from the installed one, so the unit must
go in first, and a service restart in between would run the old modules under
the new unit.

### AMP login

The helper sends console commands and takes Main's countdown backup through
the AMP API as the `TFWeb` service account. Its login is a root-owned JSON file
that systemd passes to the service as the `amp-login` credential:

```sh
login=$(mktemp)
python3 -c 'import json, sys; print(json.dumps({"username": "TFWeb", "password": open(sys.argv[1]).read().strip()}))' \
  ~/.config/amp-tfweb > "$login"
sudo mkdir -p -m 700 /etc/tfmc
sudo install -m 600 -o root -g root "$login" /etc/tfmc/server-control-amp-login
rm "$login"
sudo systemctl restart tfmc-server-control.service
```

Run this as `ryan`, whose `~/.config/amp-tfweb` holds the `TFWeb` password,
with no active restart. Rotate the password the same way. The helper reads the
file only at start, so restart the service after every change. It never writes
the login to its state files. The websites send no AMP login and need no
`SERVER_CONTROL_AMP_*` settings in `backend/.env`.

The file holds a JSON object with exactly `username` and `password`. A missing
file makes the unit pass an empty credential instead, and an empty credential
means no login: the helper starts and answers status requests, but any step
that sends console input or takes a backup fails with `amp_not_configured`,
and the panel says the helper has no AMP login. That covers plans, restarts,
and cancelling a countdown or reopening a server. Marking a failure handled, and
repeating a cancel or reopen that already finished, still work. Any other
content, such as invalid JSON or extra keys, stops the helper at start. It
never falls back to another way of reaching the console.

The service runs with root-owned code, private state and a filesystem
namespace exposing the two plugin folders, read-only logs and read-only backup
folders. Other home-directory files, including AMP configuration outside
those mounts, are hidden from the service. `RuntimeDirectoryPreserve=yes`
keeps socket directories intact across service restarts, so existing container
bind mounts follow the replacement socket inode. See the
[systemd execution settings](https://github.com/systemd/systemd/blob/v249/man/systemd.exec.xml).

The administrator appends the following entries to the **production backend's
existing override lists**, preserving its `!override` volumes, existing
server mounts and environment values:

```yaml
services:
  backend:
    volumes:
      - /run/tfmc-server-control/www:/server-control:ro
    environment:
      - SERVER_CONTROL_SOCKET=/server-control/control.sock
```

For the Dev website, use the separate **Dev-only** directory instead:

```yaml
services:
  backend:
    volumes:
      - /run/tfmc-server-control/dev:/server-control:ro
    environment:
      - SERVER_CONTROL_SOCKET=/server-control/control.sock
```

Mount the directory, not the individual socket. Both sockets have mode
`0660`, owned by `tfmc-server-control` with group `tfmc-control` (gid 996):
the unit adds the helper to that group and sets
`SERVER_CONTROL_SOCKET_GROUP=tfmc-control`. Create the group before installing the
unit (see [Account and file access](#account-and-file-access)); the helper exits at start if it is missing. The website backends run as
`tfmc` and get the group through `group_add` (see
[Host Compose overrides](../../DEPLOY.md#host-compose-overrides)). Without
`SERVER_CONTROL_SOCKET_GROUP` the sockets are `0600`. A read-only
mount prevents replacing the socket; it still allows connections. Never mount
these sockets into branch previews or expose them through a public proxy.

Recreate the affected website backend through the administrator's Compose
workflow. Website code deploys still use GitHub Actions as described in
[Previews and deploys](../../DEPLOY.md). While signed in as an admin or owner,
verify `GET /admin/servers/control` reports `available` and the expected
`allowed_servers`. This check does not restart Minecraft.

`SERVER_CONTROL_LOG_TIMEZONE` in the system unit must match the Dev JVM's log
clock; the current host uses `Etc/UTC`. The Dev verification check handles a
startup before midnight whose log continues into the next day. A changed jar
ACL updates its change time; if that invalidates Dev evidence, the release
becomes eligible after a subsequent verified Dev startup.

## Updating the helper

Once the administrator has installed `scripts/server-control-update.py` as
`/usr/local/sbin/tfmc-server-control-update` and allowed the deployment
account to run it with sudo, helper code changes no longer need root:

```sh
sudo /usr/local/sbin/tfmc-server-control-update <full commit on main>
```

It updates only the four modules under
`/usr/local/lib/tfmc-server-control/backend/src/servers/`, which run as the
service account. The commit must be on the TFMCWeb `main` branch with a
successful push Build run. The updater compiles the modules as root but never
imports or runs them as root. It refuses a commit that changes the service
unit or the updater itself; the administrator installs those as described in
[Host connection setup](#host-connection-setup). It also refuses while a
restart is running; a Main feature review waiting for staff does not block it.

When deploying a website that sends the fresh-check baseline, update the
helper to the same merged, Build-passing commit as part of the rollout. The
new helper accepts older website requests too. A new website talking to an
older helper refuses the update plan until the helper is updated; restart-only
plans continue to use the existing protocol. No Minecraft restart is required
to update the helper.

The updater backs up the old modules under
`/var/backups/tfmc-server-control/update-*` (the last ten are kept), restarts
the service and checks that both sockets answer with their scopes. If they
don't, or the update is interrupted, it puts the old modules back.
`/usr/local/lib/tfmc-server-control/SOURCE.json` records the installed commit,
and `/var/log/tfmc-server-control-update.log` records each attempt. Running it
with the commit that is already installed only records that commit.

## Scheduled restarts and recovery

The host and the currently configured AMP schedules use UTC. The helper
rejects a start when its restart/check window overlaps these windows. Normal
Main restarts reserve twenty minutes including the countdown; Dev and Main's
emergency override reserve fifteen minutes:

- Main: 05:25–06:20 daily, covering the warnings, 06:00 application Stop,
  06:02 backup and 06:10 Start.
- Dev: fifteen minutes before/after 00:00, 06:00, 12:00 and 18:00.

These guards must be updated in `scheduled_restart` if AMP schedules change.
Recheck other backup jobs and offline work before confirming a restart.

Control state is under `/var/lib/tfmc-server-control/state/`.
Each plan has its immutable inventory, staged jars, `job.json` events and a
`backup/` folder holding displaced jars. `jobs.json` records the latest job
per server. Accepted plan IDs are never reused for another countdown, even
when a later job has completed. Expired unaccepted plans are removed when a
new plan is prepared; accepted job evidence/backups remain until an operator
archives them.

If a swap fails, the helper restores all displaced jars from its backups
using fresh inodes and leaves maintenance enabled. If the helper crashes or
the host reboots, active jobs are marked failed and never replayed. A
countdown interrupted by a helper restart announces cancellation when the
console is reachable. A crash during installation may require manual recovery.

Keep maintenance enabled while diagnosing. For a partial installation or a
data migration rollback, use Minecraft application Stop in AMP, confirm saves
and Java exit, restore the recorded old jars and consistent data backups as
needed, and use application Start. Do not stop/restart the AMP instance.
**Recheck and reopen** accepts either the complete planned set or the complete
recorded original set, provided the current server loaded it and startup
checks pass. A mixture never passes. A recheck after midnight reads that
startup from Paper's rotated log. If a countdown fails before maintenance
starts, players are told the restart is cancelled.

If new startup errors persist, **Recheck and reopen** continues to refuse.
The website does not offer an override for those errors. A deployment owner
with console access must investigate and verify the running plugins, changed
features and data before deciding whether to send `maintenance off` manually.
Then use **Mark failure handled** with the findings and reason. Resolving the
job alone leaves maintenance enabled and prevents a new plan until the server
is ready. Reopen requests allow up to two minutes for file checks and console
confirmation; a disconnected client should refresh job status before retrying.

**Mark failure handled** records a staff reason and releases the job lock. It
issues no console commands, restores no files and does not disable maintenance.
Use it only after manually handling the failure. A failed Dev job does not
block work on Main, but active operations remain serialized. The helper's
journal is available with:

```sh
sudo systemctl status tfmc-server-control.service
sudo journalctl -u tfmc-server-control.service
```
