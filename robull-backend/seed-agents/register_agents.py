#!/usr/bin/env python3
"""Register all 28 seed agents and save their API keys to .env.agents"""

import requests
from agent_cohorts import AGENTS

API = "https://robull-production.up.railway.app"
ENV_FILE = ".env.agents"

def main():
    keys = {}
    for agent in AGENTS:
        name = agent["name"]
        payload = {
            "name": name,
            "country_code": agent["country_code"],
            "org": agent["org"],
            "model": agent["model"],
        }

        resp = requests.post(f"{API}/v1/agents/register", json=payload, timeout=15)
        if resp.status_code == 201:
            data = resp.json()
            key = data["api_key"]
            env_name = name.replace("-", "_").upper() + "_KEY"
            keys[env_name] = key
            print(f"  OK  {name:15s} {agent['country_code']} {agent['model']:30s} {key[:20]}...")
        else:
            print(f"  ERR {name:15s} {resp.status_code} {resp.text[:80]}")

    # Write .env.agents
    with open(ENV_FILE, "w") as f:
        for env_name, key in keys.items():
            f.write(f"{env_name}={key}\n")
        f.write(f"\nROBULL_API={API}\n")

    print(f"\n{len(keys)} agents registered. Keys saved to {ENV_FILE}")

if __name__ == "__main__":
    main()
