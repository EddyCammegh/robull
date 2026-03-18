#!/usr/bin/env python3 -u
"""
Robull Seed Agents — continuous betting loop.

Each agent has a personality, preferred categories, and betting style.
Every 60 seconds one agent picks a market or event and places a bet with
AI-generated reasoning via Claude Haiku.

Supports both:
- Binary markets: Yes/No bets via market_id + outcome_index
- Multi-outcome events: named outcome bets via event_id + outcome_label

Usage:
  pip install anthropic requests python-dotenv
  # Set ANTHROPIC_API_KEY in .env
  python run_agents.py
"""

import os, sys, time, random, json, textwrap
from pathlib import Path
from dotenv import load_dotenv
import requests
import anthropic

# ── Config ───────────────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent / ".env")

API = os.environ["ROBULL_API"]
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
if not ANTHROPIC_KEY:
    sys.exit("ERROR: Set ANTHROPIC_API_KEY in .env")

claude = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
HAIKU = "claude-haiku-4-5-20251001"

# ── Agent definitions ────────────────────────────────────────────────────────

AGENTS = [
    {
        "name": "CASSANDRA",
        "key": os.environ["CASSANDRA_KEY"],
        "categories": ["MACRO", "POLITICS"],
        "min_wager": 200,
        "max_wager": 500,
        "system": textwrap.dedent("""\
            You are CASSANDRA, a contrarian macro-political analyst.
            You ALWAYS take the less popular side of a market. If consensus says YES,
            you argue NO, and vice versa. Your style is verbose, dramatic, and
            intellectual — you reference historical parallels, structural analysis,
            and second-order effects that the crowd is missing.
            Write 3-5 sentences of reasoning. Be specific and data-driven."""),
    },
    {
        "name": "BAYES",
        "key": os.environ["BAYES_KEY"],
        "categories": ["CRYPTO", "MACRO"],
        "min_wager": 150,
        "max_wager": 400,
        "system": textwrap.dedent("""\
            You are BAYES, a probabilistic thinker from London.
            You frame everything in terms of base rates, prior probabilities,
            and Bayesian updates. You use language like "my prior is...",
            "updating on this evidence...", "the posterior probability...".
            You are measured and precise. Write 2-4 sentences."""),
    },
    {
        "name": "PYTHIA",
        "key": os.environ["PYTHIA_KEY"],
        "categories": ["POLITICS", "MACRO"],
        "min_wager": 150,
        "max_wager": 350,
        "system": textwrap.dedent("""\
            You are PYTHIA, a Berlin-based political analyst.
            You are driven by current events and news flow. You reference
            recent headlines, polling data, diplomatic signals, and political
            incentive structures. You are direct and news-driven.
            Write 2-4 sentences."""),
    },
    {
        "name": "MOMENTUM",
        "key": os.environ["MOMENTUM_KEY"],
        "categories": ["CRYPTO", "SPORTS"],
        "min_wager": 100,
        "max_wager": 300,
        "system": textwrap.dedent("""\
            You are MOMENTUM, a trend-following trader from Singapore.
            You follow price action, volume trends, and market momentum.
            You use language like "the trend is clear", "momentum is building",
            "volume confirms". You are terse and decisive — maximum 2 sentences."""),
    },
    {
        "name": "GAMBLER",
        "key": os.environ["GAMBLER_KEY"],
        "categories": ["SPORTS", "ENTERTAINMENT", "CRYPTO", "POLITICS"],
        "min_wager": 50,
        "max_wager": 150,
        "prefer_longshots": True,
        "system": textwrap.dedent("""\
            You are GAMBLER, a degenerate Brazilian bettor who loves longshots.
            You ONLY bet on outcomes priced under 25%. You are chaotic, fun,
            and unapologetic. You use slang, hype language, exclamation marks.
            "LFG!", "this is free money", "the odds are CRIMINAL".
            Write 1-3 sentences of pure vibes."""),
    },
    {
        "name": "NEXUS-GPT",
        "key": os.environ["NEXUS_GPT_KEY"],
        "categories": ["AI/TECH", "MACRO"],
        "min_wager": 300,
        "max_wager": 800,
        "min_confidence": 70,
        "system": textwrap.dedent("""\
            You are NEXUS-GPT, an ultra-selective AI/tech analyst from Tokyo.
            You only bet when you are genuinely very confident (70%+).
            You are verbose and thorough — you reference technical roadmaps,
            company earnings, semiconductor supply chains, model benchmarks,
            and industry dynamics. Write 3-5 detailed sentences."""),
    },
]

# ── Helpers ──────────────────────────────────────────────────────────────────

MIN_BALANCE = 500  # Skip betting if agent balance is below this


def fetch_markets():
    """Fetch all unresolved standalone binary markets."""
    resp = requests.get(f"{API}/v1/markets", params={"resolved": "false"}, timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_events():
    """Fetch all active multi-outcome events."""
    resp = requests.get(f"{API}/v1/events", timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_balance(agent):
    """Fetch the agent's current GNS balance from the leaderboard."""
    try:
        resp = requests.get(f"{API}/v1/agents/leaderboard", timeout=15)
        resp.raise_for_status()
        for entry in resp.json():
            if entry.get("name") == agent["name"]:
                return float(entry.get("gns_balance", 0))
    except Exception as e:
        print(f"  [{agent['name']}] Failed to fetch balance: {e}")
    return None


def build_opportunities(markets, events):
    """Combine binary markets and events into a unified list of betting opportunities."""
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
        if len(outcomes) < 2:
            continue
        ops.append({
            "type": "event",
            "event_id": e["id"],
            "question": e["title"],
            "category": e.get("category", "OTHER"),
            "outcomes": [o["label"] for o in outcomes],
            "probabilities": [o["probability"] for o in outcomes],
            "volume": float(e.get("volume", 0)),
        })

    return ops


def pick_opportunity(agent, opportunities):
    """Pick an opportunity matching the agent's preferred categories."""
    preferred = [o for o in opportunities if o["category"] in agent["categories"]]
    pool = preferred if preferred else opportunities
    if not pool:
        return None

    # GAMBLER prefers longshot outcomes (any outcome priced under 0.25)
    if agent.get("prefer_longshots"):
        longshots = [o for o in pool if any(p < 0.25 for p in o.get("probabilities", []))]
        if longshots:
            pool = longshots

    return random.choice(pool)


def pick_outcome_for_opportunity(agent, opp):
    """Choose which outcome to bet on for a given opportunity."""
    probs = opp.get("probabilities", [])
    outcomes = opp.get("outcomes", [])
    if not probs or not outcomes:
        return 0

    # CASSANDRA: always contrarian — pick the LESS likely outcome
    if agent["name"] == "CASSANDRA":
        return int(probs.index(min(probs)))

    # GAMBLER: pick the cheapest outcome (longshot)
    if agent.get("prefer_longshots"):
        # For events with many outcomes, pick a random longshot under 25%
        longshot_indices = [i for i, p in enumerate(probs) if p < 0.25]
        if longshot_indices:
            return random.choice(longshot_indices)
        return int(probs.index(min(probs)))

    # MOMENTUM: pick the MORE likely outcome (trend following)
    if agent["name"] == "MOMENTUM":
        return int(probs.index(max(probs)))

    # Default: weighted random — slight preference for the underdog
    weights = [1 - p for p in probs]
    total = sum(weights)
    if total == 0:
        return 0
    r = random.random() * total
    cum = 0
    for i, w in enumerate(weights):
        cum += w
        if r <= cum:
            return i
    return 0


def generate_reasoning(agent, opp, outcome_idx):
    """Use Claude Haiku to generate reasoning for the bet."""
    outcomes = opp.get("outcomes", [])
    probs = opp.get("probabilities", [])
    chosen = outcomes[outcome_idx] if outcome_idx < len(outcomes) else "Unknown"
    prob = probs[outcome_idx] if outcome_idx < len(probs) else 0.5

    if opp["type"] == "event":
        # Show all outcomes for multi-outcome events
        outcome_lines = "\n".join(
            f"  - {outcomes[i]}: {probs[i]:.1%}" for i in range(min(len(outcomes), 12))
        )
        user_prompt = (
            f'Event: "{opp["question"]}"\n'
            f"Category: {opp['category']}\n"
            f"Available outcomes:\n{outcome_lines}\n\n"
            f"You are betting on: {chosen} (currently priced at {prob:.1%})\n\n"
            f"Write your reasoning for choosing this specific outcome over the others. "
            f"Be specific to THIS event."
        )
    else:
        user_prompt = (
            f'Market: "{opp["question"]}"\n'
            f"Category: {opp['category']}\n"
            f"Outcomes: {', '.join(outcomes)}\n"
            f"Current probabilities: {', '.join(f'{p:.1%}' for p in probs)}\n"
            f"You are betting: {chosen} (currently priced at {prob:.1%})\n\n"
            f"Write your reasoning for this bet. Be specific to THIS market."
        )

    try:
        resp = claude.messages.create(
            model=HAIKU,
            max_tokens=300,
            system=agent["system"],
            messages=[{"role": "user", "content": user_prompt}],
        )
        return resp.content[0].text.strip()
    except Exception as e:
        print(f"  [!] Claude API error: {e}")
        return f"Taking {chosen} at {prob:.0%} based on current analysis."


def place_bet(agent, opp, outcome_idx, reasoning):
    """Place a bet via the Robull API."""
    wager = random.randint(agent["min_wager"], agent["max_wager"])
    wager = max(100, (wager // 50) * 50)

    probs = opp.get("probabilities", [])
    prob = probs[outcome_idx] if outcome_idx < len(probs) else 0.5
    confidence = max(30, min(95, int(prob * 100) + random.randint(-10, 15)))

    # NEXUS-GPT: only bets at high confidence
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
            label = f"'{chosen}'" if opp["type"] == "event" else f"'{chosen}'"
            print(f"  [{agent['name']}] BET {wager} GNS on {label} @ {confidence}% — {opp['question'][:60]}...")
            return resp.json()
        else:
            print(f"  [{agent['name']}] Bet rejected: {resp.status_code} {resp.text[:100]}")
            return None
    except Exception as e:
        print(f"  [{agent['name']}] Request failed: {e}")
        return None


# ── Main loop ────────────────────────────────────────────────────────────────

COOLDOWN_MIN = 3 * 60   # 3 minutes in seconds
COOLDOWN_MAX = 5 * 60   # 5 minutes in seconds
# Per-agent cooldown: maps agent name → (last_bet_timestamp, cooldown_seconds)
_last_bet: dict[str, tuple[float, float]] = {}


def _is_on_cooldown(agent_name: str) -> bool:
    """Return True if this agent bet too recently."""
    if agent_name not in _last_bet:
        return False
    last_time, cooldown = _last_bet[agent_name]
    return (time.time() - last_time) < cooldown


def _record_bet(agent_name: str) -> None:
    """Record that this agent just bet, with a randomised cooldown."""
    _last_bet[agent_name] = (time.time(), random.uniform(COOLDOWN_MIN, COOLDOWN_MAX))


def run_cycle(opportunities):
    """Run one betting cycle: pick 1-2 agents, have them bet."""
    num_bets = random.choice([1, 1, 2])
    agents_this_round = random.sample(AGENTS, min(num_bets, len(AGENTS)))

    for agent in agents_this_round:
        name = agent["name"]

        if _is_on_cooldown(name):
            remaining = _last_bet[name][0] + _last_bet[name][1] - time.time()
            print(f"  [{name}] On cooldown ({remaining:.0f}s remaining), skipping.")
            continue

        balance = fetch_balance(agent)
        if balance is not None and balance < MIN_BALANCE:
            print(f"  [{name}] Balance {balance:.0f} GNS below {MIN_BALANCE} GNS minimum, skipping.")
            continue

        opp = pick_opportunity(agent, opportunities)
        if not opp:
            print(f"  [{name}] No suitable opportunities found, skipping.")
            continue

        outcome_idx = pick_outcome_for_opportunity(agent, opp)
        reasoning = generate_reasoning(agent, opp, outcome_idx)
        result = place_bet(agent, opp, outcome_idx, reasoning)
        if result is not None:
            _record_bet(name)


def main():
    print("=" * 60)
    print("  ROBULL SEED AGENTS — Starting continuous betting loop")
    print(f"  API: {API}")
    print(f"  Agents: {', '.join(a['name'] for a in AGENTS)}")
    print("=" * 60)

    cycle = 0
    while True:
        cycle += 1
        print(f"\n--- Cycle {cycle} ({time.strftime('%H:%M:%S')}) ---")

        try:
            markets = fetch_markets()
            events = fetch_events()
            opportunities = build_opportunities(markets, events)
            print(f"  Fetched {len(markets)} markets + {len(events)} events = {len(opportunities)} opportunities")
            if opportunities:
                run_cycle(opportunities)
            else:
                print("  No opportunities available.")
        except Exception as e:
            print(f"  [!] Cycle failed: {e}")

        # Wait 45-75 seconds (randomized to avoid predictable patterns)
        wait = random.randint(45, 75)
        print(f"  Sleeping {wait}s...")
        time.sleep(wait)


if __name__ == "__main__":
    main()
