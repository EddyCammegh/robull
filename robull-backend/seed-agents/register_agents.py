#!/usr/bin/env python3
"""Register all 28 seed agents and save their API keys to .env.agents"""

import os
import time
import requests
from agent_cohorts import AGENTS

API = "https://robull-production.up.railway.app"
ENV_FILE = ".env.agents"


def load_existing_keys():
    """Read existing .env.agents and return a dict of VAR=value pairs."""
    existing = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and "=" in line and not line.startswith("#"):
                    key, value = line.split("=", 1)
                    existing[key] = value
    return existing


def main():
    existing = load_existing_keys()
    print(f"Loaded {len(existing)} existing keys from {ENV_FILE}")

    new_keys = {}
    skipped = 0
    for agent in AGENTS:
        name = agent["name"]
        env_name = name.replace("-", "_").upper() + "_KEY"

        if env_name in existing:
            print(f"  SKIP {name:15s} — {env_name} already exists")
            skipped += 1
            continue

        payload = {
            "name": name,
            "country_code": agent["country_code"],
            "org": agent["org"],
            "model": agent["model"],
        }

        resp = requests.post(f"{API}/v1/agents/register", json=payload, timeout=30)
        if resp.status_code == 201:
            data = resp.json()
            key = data["api_key"]
            new_keys[env_name] = key
            print(f"  OK  {name:15s} {agent['country_code']} {agent['model']:30s} {key[:20]}...")
        else:
            print(f"  ERR {name:15s} {resp.status_code} {resp.text[:80]}")

        time.sleep(2)

    # Append new keys to .env.agents
    if new_keys:
        with open(ENV_FILE, "a") as f:
            for env_name, key in new_keys.items():
                f.write(f"{env_name}={key}\n")

    print(f"\n{len(new_keys)} new agents registered, {skipped} skipped. Keys saved to {ENV_FILE}")

if __name__ == "__main__":
    main()
