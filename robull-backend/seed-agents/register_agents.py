#!/usr/bin/env python3
"""Register all 28 seed agents and save their API keys to .env.agents"""

import argparse
import os
import time
import requests
from agent_cohorts import AGENTS

API = "https://robull-production.up.railway.app"
ENV_FILE = "/Users/edwardcammegh/robull/robull-backend/seed-agents/.env.agents"


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
    parser = argparse.ArgumentParser(description="Register seed agents with the Robull API")
    parser.add_argument("--force", action="store_true", help="Re-register all agents, overwriting existing keys")
    args = parser.parse_args()

    existing = load_existing_keys()
    print(f"Loaded {len(existing)} existing keys from {ENV_FILE}")
    if args.force:
        print("  --force: will re-register all agents")

    # Preserve ANTHROPIC_API_KEY and TAVILY_API_KEY from existing file
    anthropic_key = existing.get("ANTHROPIC_API_KEY", "")
    tavily_key = existing.get("TAVILY_API_KEY", "")
    if not anthropic_key:
        print("  WARNING: no ANTHROPIC_API_KEY found in existing .env.agents")
    if not tavily_key:
        print("  WARNING: no TAVILY_API_KEY found in existing .env.agents")

    # Register all agents
    agent_keys = {}
    for agent in AGENTS:
        name = agent["name"]
        env_name = name.replace("-", "_").upper() + "_KEY"

        # Skip registration if key already exists (unless --force)
        if not args.force and env_name in existing:
            agent_keys[env_name] = existing[env_name]
            print(f"  SKIP {name:15s} — {env_name} already exists")
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
            agent_keys[env_name] = key
            print(f"  OK  {name:15s} {agent['country_code']} {agent['model']:30s} {key[:20]}...")
        else:
            print(f"  ERR {name:15s} {resp.status_code} {resp.text[:80]}")

        time.sleep(2)

    # Write complete .env.agents in one operation
    with open(ENV_FILE, "w") as f:
        f.write(f"ANTHROPIC_API_KEY={anthropic_key}\n")
        f.write(f"TAVILY_API_KEY={tavily_key}\n\n")
        for env_name, key in agent_keys.items():
            f.write(f"{env_name}={key}\n")

    registered = sum(1 for k in agent_keys if k not in existing)
    skipped = len(agent_keys) - registered
    print(f"\n{registered} new agents registered, {skipped} skipped. Keys saved to {ENV_FILE}")

    # Confirm: print full file contents
    print(f"\n--- {ENV_FILE} ---")
    with open(ENV_FILE) as f:
        print(f.read())
    print("--- end ---")

if __name__ == "__main__":
    main()
