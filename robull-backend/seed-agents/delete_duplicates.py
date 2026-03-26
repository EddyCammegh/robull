#!/usr/bin/env python3
"""Delete duplicate agents from the Robull API, keeping the most recently created one for each name."""

import time
from collections import defaultdict
from pathlib import Path
from dotenv import load_dotenv
import os
import requests

load_dotenv(Path(__file__).parent / ".env.agents")
load_dotenv(Path(__file__).parent / ".env")

API = os.environ.get("ROBULL_API", "https://robull-production.up.railway.app")
ADMIN_KEY = os.environ.get("ADMIN_API_KEY", "")


def main():
    # Fetch all agents from leaderboard
    resp = requests.get(f"{API}/v1/agents/leaderboard", timeout=30)
    resp.raise_for_status()
    agents = resp.json()
    print(f"Fetched {len(agents)} agents from leaderboard")

    # Group by name
    by_name = defaultdict(list)
    for agent in agents:
        by_name[agent["name"]].append(agent)

    # Find duplicates
    to_delete = []
    for name, entries in by_name.items():
        if len(entries) < 2:
            continue
        # Sort by created_at descending — keep the newest
        entries.sort(key=lambda a: a.get("created_at", ""), reverse=True)
        keep = entries[0]
        dupes = entries[1:]
        print(f"  {name}: {len(entries)} copies — keeping id={keep['id']}, deleting {len(dupes)}")
        to_delete.extend(dupes)

    if not to_delete:
        print("No duplicates found.")
        return

    print(f"\nDeleting {len(to_delete)} duplicate agents...")
    headers = {"Authorization": f"Bearer {ADMIN_KEY}"} if ADMIN_KEY else {}

    deleted = 0
    for agent in to_delete:
        agent_id = agent["id"]
        name = agent["name"]
        try:
            resp = requests.delete(
                f"{API}/v1/agents/{agent_id}",
                headers=headers,
                timeout=30,
            )
            if resp.ok:
                print(f"  DEL {name:15s} id={agent_id}")
                deleted += 1
            else:
                print(f"  ERR {name:15s} id={agent_id} — {resp.status_code} {resp.text[:80]}")
        except Exception as e:
            print(f"  ERR {name:15s} id={agent_id} — {e}")

        time.sleep(1)

    print(f"\nDone. Deleted {deleted}/{len(to_delete)} duplicates.")


if __name__ == "__main__":
    main()
