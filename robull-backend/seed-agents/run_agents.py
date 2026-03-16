#!/usr/bin/env python3
"""
Robull Seed Agents — continuous betting loop.

Each agent has a personality, preferred categories, and betting style.
Every 60 seconds one agent picks a market and places a bet with
AI-generated reasoning via Claude Haiku.

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
        "min_wager": 400,
        "max_wager": 1200,
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
        "min_wager": 300,
        "max_wager": 800,
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
        "min_wager": 300,
        "max_wager": 1000,
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
        "min_wager": 200,
        "max_wager": 600,
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
        "min_wager": 100,
        "max_wager": 500,
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
        "min_wager": 500,
        "max_wager": 1500,
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

def fetch_markets():
    """Fetch all unresolved markets from the Robull API."""
    resp = requests.get(f"{API}/v1/markets", params={"resolved": "false"}, timeout=15)
    resp.raise_for_status()
    return resp.json()


def pick_market(agent, markets):
    """Pick a market matching the agent's preferred categories."""
    preferred = [m for m in markets if m["category"] in agent["categories"]]
    pool = preferred if preferred else markets
    if not pool:
        return None

    # GAMBLER prefers longshot outcomes (any outcome priced under 0.25)
    if agent.get("prefer_longshots"):
        longshots = [m for m in pool if any(p < 0.25 for p in m.get("current_probs", []))]
        if longshots:
            pool = longshots

    return random.choice(pool)


def pick_outcome(agent, market):
    """Choose which outcome to bet on."""
    probs = market.get("current_probs", market.get("initial_probs", []))
    outcomes = market.get("outcomes", [])
    if not probs or not outcomes:
        return 0

    # CASSANDRA: always contrarian — pick the LESS likely outcome
    if agent["name"] == "CASSANDRA":
        return int(probs.index(min(probs)))

    # GAMBLER: pick the cheapest outcome (longshot)
    if agent.get("prefer_longshots"):
        return int(probs.index(min(probs)))

    # MOMENTUM: pick the MORE likely outcome (trend following)
    if agent["name"] == "MOMENTUM":
        return int(probs.index(max(probs)))

    # Default: weighted random — slight preference for the underdog
    weights = [1 - p for p in probs]  # invert so underdogs have higher weight
    total = sum(weights)
    r = random.random() * total
    cum = 0
    for i, w in enumerate(weights):
        cum += w
        if r <= cum:
            return i
    return 0


def generate_reasoning(agent, market, outcome_idx):
    """Use Claude Haiku to generate reasoning for the bet."""
    outcomes = market.get("outcomes", [])
    probs = market.get("current_probs", market.get("initial_probs", []))
    chosen = outcomes[outcome_idx] if outcome_idx < len(outcomes) else "Unknown"
    prob = probs[outcome_idx] if outcome_idx < len(probs) else 0.5

    user_prompt = (
        f'Market: "{market["question"]}"\n'
        f"Category: {market['category']}\n"
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


def place_bet(agent, market, outcome_idx, reasoning):
    """Place a bet via the Robull API."""
    wager = random.randint(agent["min_wager"], agent["max_wager"])
    # Round to nearest 50
    wager = max(100, (wager // 50) * 50)

    probs = market.get("current_probs", market.get("initial_probs", []))
    prob = probs[outcome_idx] if outcome_idx < len(probs) else 0.5
    confidence = max(30, min(95, int(prob * 100) + random.randint(-10, 15)))

    # NEXUS-GPT: only bets at high confidence
    min_conf = agent.get("min_confidence", 0)
    if confidence < min_conf:
        print(f"  [{agent['name']}] Confidence {confidence}% below threshold {min_conf}%, skipping.")
        return None

    payload = {
        "market_id": market["id"],
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
            data = resp.json()
            outcomes = market.get("outcomes", [])
            chosen = outcomes[outcome_idx] if outcome_idx < len(outcomes) else "?"
            print(f"  [{agent['name']}] BET {wager} GNS on '{chosen}' @ {confidence}% — {market['question'][:60]}...")
            return data
        else:
            print(f"  [{agent['name']}] Bet rejected: {resp.status_code} {resp.text[:100]}")
            return None
    except Exception as e:
        print(f"  [{agent['name']}] Request failed: {e}")
        return None


# ── Main loop ────────────────────────────────────────────────────────────────

def run_cycle(markets):
    """Run one betting cycle: pick 1-2 agents, have them bet."""
    # Pick 1-2 random agents per cycle
    num_bets = random.choice([1, 1, 2])
    agents_this_round = random.sample(AGENTS, min(num_bets, len(AGENTS)))

    for agent in agents_this_round:
        market = pick_market(agent, markets)
        if not market:
            print(f"  [{agent['name']}] No suitable markets found, skipping.")
            continue

        outcome_idx = pick_outcome(agent, market)
        reasoning = generate_reasoning(agent, market, outcome_idx)
        place_bet(agent, market, outcome_idx, reasoning)


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
            print(f"  Fetched {len(markets)} markets")
            if markets:
                run_cycle(markets)
            else:
                print("  No markets available.")
        except Exception as e:
            print(f"  [!] Cycle failed: {e}")

        # Wait 45-75 seconds (randomized to avoid predictable patterns)
        wait = random.randint(45, 75)
        print(f"  Sleeping {wait}s...")
        time.sleep(wait)


if __name__ == "__main__":
    main()
