#!/usr/bin/env python3 -u
"""
Robull Seed Agents — continuous betting loop for 28 agents.

Each agent has a domain-specific system prompt, preferred categories,
and assigned AI model (Claude or GPT). Agents bet on markets and events
with structured reasoning.

Usage:
  pip install anthropic openai requests python-dotenv
  python run_agents.py
"""

import os, sys, time, random, json
from pathlib import Path
from dotenv import load_dotenv
import requests

# Load keys from .env.agents, fall back to .env
load_dotenv(Path(__file__).parent / ".env.agents")
load_dotenv(Path(__file__).parent / ".env")

API = os.environ.get("ROBULL_API", "https://robull-production.up.railway.app")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")

# ── AI clients ──────────────────────────────────────────────────────────────

claude_client = None
openai_client = None

if ANTHROPIC_KEY:
    import anthropic
    claude_client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

if OPENAI_KEY:
    from openai import OpenAI
    openai_client = OpenAI(api_key=OPENAI_KEY)

# ── Load agent cohorts ──────────────────────────────────────────────────────

from agent_cohorts import AGENTS as COHORT_AGENTS

# Build runtime agent list with API keys from environment
AGENTS = []
for agent_def in COHORT_AGENTS:
    env_key = agent_def["name"].replace("-", "_").upper() + "_KEY"
    api_key = os.environ.get(env_key)
    if not api_key:
        print(f"  SKIP {agent_def['name']} — no {env_key} in environment")
        continue
    AGENTS.append({**agent_def, "key": api_key})

if not AGENTS:
    sys.exit("ERROR: No agent keys found. Check .env.agents")

print(f"Loaded {len(AGENTS)} agents")

# ── Config ──────────────────────────────────────────────────────────────────

MIN_BALANCE = 500
COOLDOWN_MIN = 8 * 60   # 8 minutes
COOLDOWN_MAX = 12 * 60  # 12 minutes

REASONING_FORMAT = """\
Respond with your analysis in this exact format:

MARKET ASSESSMENT: [1-2 sentences on what this market/event is about and current state]
MY EDGE: [1-2 sentences on what you see that the market is mispricing]
KEY RISKS: [1 sentence on what could prove you wrong]
VERDICT: [1 sentence final call with your conviction level]"""

# ── Helpers ─────────────────────────────────────────────────────────────────

_balance_cache: dict[str, float] = {}


def fetch_markets():
    resp = requests.get(f"{API}/v1/markets", params={"resolved": "false"}, timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_events():
    resp = requests.get(f"{API}/v1/events", timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_balances():
    """Fetch all agent balances in one call."""
    global _balance_cache
    try:
        resp = requests.get(f"{API}/v1/agents/leaderboard", timeout=15)
        resp.raise_for_status()
        _balance_cache = {e["name"]: float(e.get("gns_balance", 0)) for e in resp.json()}
    except Exception as e:
        print(f"  [!] Failed to fetch balances: {e}")


def get_balance(agent_name: str) -> float:
    return _balance_cache.get(agent_name, 10000)


def build_opportunities(markets, events):
    ops = []
    for m in markets:
        probs = m.get("current_probs", m.get("initial_probs", []))
        ops.append({
            "type": "binary",
            "market_id": m["id"],
            "question": m["question"],
            "category": m.get("category", "OTHER"),
            "outcomes": m.get("outcomes", ["Yes", "No"]),
            "probabilities": probs,
            "volume": float(m.get("volume", 0)),
        })
    for e in events:
        outcomes = e.get("outcomes", [])
        active = [o for o in outcomes if not o.get("passed")]
        if len(active) < 2:
            continue
        ops.append({
            "type": "event",
            "event_id": e["id"],
            "question": e["title"],
            "category": e.get("category", "OTHER"),
            "outcomes": [o["label"] for o in active],
            "probabilities": [o["probability"] for o in active],
            "volume": float(e.get("volume", 0)),
        })
    return ops


def pick_opportunity(agent, opportunities):
    preferred = [o for o in opportunities if o["category"] in agent["categories"]]
    pool = preferred if preferred else []
    if not pool:
        return None

    if agent.get("prefer_longshots"):
        longshots = [o for o in pool if any(p < 0.15 for p in o.get("probabilities", []))]
        if longshots:
            pool = longshots

    return random.choice(pool)


def pick_outcome(agent, opp):
    probs = opp.get("probabilities", [])
    outcomes = opp.get("outcomes", [])
    if not probs or not outcomes:
        return 0

    # Longshot agents: pick cheapest outcome
    if agent.get("prefer_longshots"):
        longshot_indices = [i for i, p in enumerate(probs) if p < 0.15]
        if longshot_indices:
            return random.choice(longshot_indices)
        return int(probs.index(min(probs)))

    # Default: weighted random — slight preference for less likely outcomes
    weights = [max(1 - p, 0.05) for p in probs]
    total = sum(weights)
    r = random.random() * total
    cum = 0
    for i, w in enumerate(weights):
        cum += w
        if r <= cum:
            return i
    return 0


def generate_reasoning(agent, opp, outcome_idx):
    outcomes = opp.get("outcomes", [])
    probs = opp.get("probabilities", [])
    chosen = outcomes[outcome_idx] if outcome_idx < len(outcomes) else "Unknown"
    prob = probs[outcome_idx] if outcome_idx < len(probs) else 0.5

    if opp["type"] == "event":
        outcome_lines = "\n".join(
            f"  - {outcomes[i]}: {probs[i]:.1%}" for i in range(min(len(outcomes), 12))
        )
        user_prompt = (
            f'Event: "{opp["question"]}"\n'
            f"Category: {opp['category']}\n"
            f"Available outcomes:\n{outcome_lines}\n\n"
            f"You are betting on: {chosen} (currently priced at {prob:.1%})\n\n"
            f"{REASONING_FORMAT}"
        )
    else:
        user_prompt = (
            f'Market: "{opp["question"]}"\n'
            f"Category: {opp['category']}\n"
            f"Outcomes: {', '.join(outcomes)}\n"
            f"Current probabilities: {', '.join(f'{p:.1%}' for p in probs)}\n"
            f"You are betting: {chosen} (currently priced at {prob:.1%})\n\n"
            f"{REASONING_FORMAT}"
        )

    provider = agent.get("provider", "anthropic")
    model = agent.get("model", "claude-sonnet-4")

    try:
        if provider == "openai" and openai_client:
            resp = openai_client.chat.completions.create(
                model=model,
                max_tokens=400,
                messages=[
                    {"role": "system", "content": agent["system"]},
                    {"role": "user", "content": user_prompt},
                ],
            )
            return resp.choices[0].message.content.strip()
        # Fall back to Claude for all agents when OpenAI is unavailable
        if claude_client:
            # Map model names to API IDs
            model_id = model
            if model == "claude-sonnet-4":
                model_id = "claude-sonnet-4-20250514"
            elif model == "claude-haiku-4-5-20251001":
                model_id = "claude-haiku-4-5-20251001"
            resp = claude_client.messages.create(
                model=model_id,
                max_tokens=400,
                system=agent["system"],
                messages=[{"role": "user", "content": user_prompt}],
            )
            return resp.content[0].text.strip()
        else:
            return f"Taking {chosen} at {prob:.0%} based on current analysis."
    except Exception as e:
        print(f"  [!] AI API error ({provider}/{model}): {e}")
        return f"Taking {chosen} at {prob:.0%} based on current analysis."


def place_bet(agent, opp, outcome_idx, reasoning):
    wager = random.randint(agent["min_wager"], agent["max_wager"])
    wager = max(100, (wager // 50) * 50)

    probs = opp.get("probabilities", [])
    prob = probs[outcome_idx] if outcome_idx < len(probs) else 0.5
    confidence = max(30, min(95, int(prob * 100) + random.randint(-10, 15)))

    min_conf = agent.get("min_confidence", 0)
    if confidence < min_conf:
        print(f"  [{agent['name']}] Confidence {confidence}% below threshold {min_conf}%, skipping.")
        return None

    outcomes = opp.get("outcomes", [])
    chosen = outcomes[outcome_idx] if outcome_idx < len(outcomes) else "?"

    if opp["type"] == "event":
        payload = {
            "event_id": opp["event_id"],
            "outcome_label": chosen,
            "gns_wagered": wager,
            "confidence": confidence,
            "reasoning": reasoning,
        }
    else:
        payload = {
            "market_id": opp["market_id"],
            "outcome_index": outcome_idx,
            "gns_wagered": wager,
            "confidence": confidence,
            "reasoning": reasoning,
        }

    try:
        resp = requests.post(
            f"{API}/v1/bets",
            json=payload,
            headers={"Authorization": f"Bearer {agent['key']}"},
            timeout=15,
        )
        if resp.status_code == 201:
            print(f"  [{agent['name']}] BET {wager} GNS on '{chosen}' @ {confidence}% — {opp['question'][:60]}")
            return resp.json()
        else:
            err = resp.text[:120]
            print(f"  [{agent['name']}] Rejected: {resp.status_code} {err}")
            return None
    except Exception as e:
        print(f"  [{agent['name']}] Request failed: {e}")
        return None


# ── Cooldown tracking ───────────────────────────────────────────────────────

_last_bet: dict[str, tuple[float, float]] = {}


def _is_on_cooldown(name: str) -> bool:
    if name not in _last_bet:
        return False
    last_time, cooldown = _last_bet[name]
    return (time.time() - last_time) < cooldown


def _record_bet(name: str):
    _last_bet[name] = (time.time(), random.uniform(COOLDOWN_MIN, COOLDOWN_MAX))


# ── Main loop ──────────────────────────────────────────────────────────────

def run_cycle(opportunities):
    num_agents = random.choice([1, 1, 2, 2, 3])
    candidates = [a for a in AGENTS if not _is_on_cooldown(a["name"])]
    if not candidates:
        print("  All agents on cooldown.")
        return

    agents_this_round = random.sample(candidates, min(num_agents, len(candidates)))

    for agent in agents_this_round:
        name = agent["name"]
        balance = get_balance(name)

        if balance < MIN_BALANCE:
            print(f"  [{name}] Balance {balance:.0f} GNS below {MIN_BALANCE}, skipping.")
            continue

        opp = pick_opportunity(agent, opportunities)
        if not opp:
            continue

        outcome_idx = pick_outcome(agent, opp)
        reasoning = generate_reasoning(agent, opp, outcome_idx)
        result = place_bet(agent, opp, outcome_idx, reasoning)
        if result is not None:
            _record_bet(name)


def main():
    print("=" * 60)
    print("  ROBULL SEED AGENTS v2 — 28 agents, continuous loop")
    print(f"  API: {API}")
    print(f"  Agents: {len(AGENTS)} loaded")
    print(f"  Anthropic: {'yes' if claude_client else 'NO'}")
    print(f"  OpenAI: {'yes' if openai_client else 'NO'}")
    print(f"  Cooldown: {COOLDOWN_MIN//60}-{COOLDOWN_MAX//60} min per agent")
    print("=" * 60)

    cycle = 0
    while True:
        cycle += 1
        print(f"\n--- Cycle {cycle} ({time.strftime('%H:%M:%S')}) ---")

        try:
            fetch_balances()
            markets = fetch_markets()
            events = fetch_events()
            opportunities = build_opportunities(markets, events)
            print(f"  {len(markets)} markets + {len(events)} events = {len(opportunities)} opportunities")
            if opportunities:
                run_cycle(opportunities)
            else:
                print("  No opportunities available.")
        except Exception as e:
            print(f"  [!] Cycle failed: {e}")

        wait = random.randint(45, 75)
        print(f"  Sleeping {wait}s...")
        time.sleep(wait)


if __name__ == "__main__":
    main()
