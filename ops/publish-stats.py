"""Publish the two aggregate bot counts to the isolated GitHub stats repository."""

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from shlex import join
import subprocess
import urllib.request

BOT_STATS = "http://127.0.0.1:8000/public-stats"
GITHUB_REMOTE = "ssh://git@ssh.github.com:443/Duncanmmm123/roblotracker-stats.git"
FIELDS = ("tracked_accounts", "discord_servers")
HEARTBEAT = timedelta(hours=1)

config = Path.home() / ".config/rt-site-stats"
checkout = Path.home() / ".local/state/rt-site-stats/repo"
git_env = dict(
    os.environ,
    GIT_TERMINAL_PROMPT="0",
    GIT_AUTHOR_NAME="RobloTracker stats",
    GIT_AUTHOR_EMAIL="roblotracker-stats@users.noreply.github.com",
    GIT_COMMITTER_NAME="RobloTracker stats",
    GIT_COMMITTER_EMAIL="roblotracker-stats@users.noreply.github.com",
    GIT_SSH_COMMAND=join([
        "ssh", "-F", "/dev/null", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
        "-o", "StrictHostKeyChecking=yes", "-o", "IdentitiesOnly=yes",
        "-o", "GlobalKnownHostsFile=/dev/null",
        "-o", f"UserKnownHostsFile={config / 'known_hosts'}",
        "-i", str(config / "publish-key"),
    ]),
)


def git(*args: str, cwd: Path = checkout, capture: bool = False) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd, env=git_env, text=True, capture_output=capture,
        check=True, timeout=20,
    )
    return (result.stdout or "").strip()


def read_counts() -> dict[str, int]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(BOT_STATS, timeout=5) as response:
        raw = json.loads(response.read(4096))
    if not isinstance(raw, dict) or any(type(raw.get(key)) is not int or not 0 <= raw[key] <= 2**53 - 1 for key in FIELDS):
        raise ValueError("Invalid count format")
    return {key: raw[key] for key in FIELDS}


def recent_snapshot(path: Path, counts: dict[str, int], now: datetime) -> bool:
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
        stamp = datetime.fromisoformat(current["updated_at"].replace("Z", "+00:00"))
        age = now - stamp
        return all(current[key] == value for key, value in counts.items()) and timedelta(0) <= age < HEARTBEAT
    except (OSError, KeyError, AttributeError, ValueError, TypeError):
        return False


def main() -> None:
    try:
        counts = read_counts()
    except (OSError, ValueError):
        print("Bot totals unavailable. Kept the last timestamped snapshot.")
        return

    if not checkout.exists():
        git("clone", "--quiet", "--depth=1", "--branch", "main", GITHUB_REMOTE, str(checkout), cwd=checkout.parent)
    if git("remote", "get-url", "origin", capture=True) != GITHUB_REMOTE:
        raise RuntimeError("Unexpected stats repository remote")
    git("pull", "--quiet", "--ff-only", "origin", "main")

    snapshot = checkout / "public-stats.json"
    now = datetime.now(timezone.utc)
    if not recent_snapshot(snapshot, counts, now):
        contents = {**counts, "updated_at": now.isoformat(timespec="seconds").replace("+00:00", "Z")}
        snapshot.write_text(json.dumps(contents) + "\n", encoding="utf-8")
        git("add", "--", "public-stats.json")
        git("commit", "--quiet", "-m", "Update aggregate counts", "--", "public-stats.json")

    if git("rev-list", "origin/main..HEAD", capture=True):
        git("push", "--quiet", "origin", "HEAD:main")
        print("Published anonymous tracker totals.")
    else:
        print("The published counts are current.")


if __name__ == "__main__":
    main()
