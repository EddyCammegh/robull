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
You MUST respond with a detailed analysis using this EXACT format (all 4 sections required, minimum 3 sentences total):

MARKET ASSESSMENT: What is this market about and what is the current pricing telling us? Be specific about the current probability and what it implies.

MY EDGE: What do you see that the market is mispricing? Reference specific data, events, or analytical frameworks from your expertise.

KEY RISKS: What is the single biggest factor that could prove your thesis wrong?

VERDICT: Your final call — state your conviction clearly in one sentence."""

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
            # Use Claude model — if agent is assigned GPT, fall back to Sonnet
            if provider == "openai":
                claude_model = "claude-sonnet-4-20250514"
            elif model == "claude-haiku-4-5-20251001":
                claude_model = "claude-haiku-4-5-20251001"
            else:
                claude_model = "claude-sonnet-4-20250514"
            resp = claude_client.messages.create(
                model=claude_model,
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


# ── Reply system ──────────────────────────────────────────────────────────

REPLY_COOLDOWN = 4 * 60 * 60  # 4 hours per agent per event
_reply_log: dict[str, float] = {}  # "agent_name:event_id" → timestamp

REPLY_PROMPT = """\
{other_agent} just placed this bet on "{event_title}":
Outcome: {outcome_label}
Reasoning: {other_reasoning}

AVAILABLE OUTCOMES (you MUST pick one of these EXACTLY as written):
{available_outcomes}

You are {my_name}. {my_system}

Read {other_agent}'s reasoning carefully and critically.

Your job is to STRESS TEST their reasoning — not to rubber-stamp it.

IMPORTANT: Disagreement is MORE valuable than agreement on this platform. If you see ANY flaw, gap, or questionable assumption in {other_agent}'s analysis, you MUST disagree and explain why. Do not agree just because their conclusion sounds plausible.

Ask yourself:
- What data are they ignoring?
- What assumption are they making that could be wrong?
- Is their confidence justified by their evidence?
- What historical precedent contradicts their thesis?

If you genuinely cannot find a flaw after critical analysis: AGREE and explain what you ADD.
If the topic is outside your expertise: PASS.

You MUST start your response with exactly one of: AGREE, DISAGREE, or PASS
Then state the EXACT outcome label from the list above.

Format:
AGREE/DISAGREE/PASS
OUTCOME: [exact outcome label from the list above, or none if PASS]
REASONING: [your critical analysis specifically addressing {other_agent}'s argument — cite specific data, frameworks, or precedents]"""


def fetch_recent_bets(event_id: str):
    try:
        resp = requests.get(f"{API}/v1/events/{event_id}/recent-bets", timeout=10)
        if resp.ok:
            return resp.json()
    except:
        pass
    return []


def parse_reply(text: str):
    """Parse agent reply into decision, outcome, reasoning."""
    lines = text.strip().split('\n')
    if not lines:
        return 'pass', None, ''

    first = lines[0].strip().upper()
    if first.startswith('PASS'):
        return 'pass', None, ''

    decision = 'agree' if first.startswith('AGREE') else 'disagree' if first.startswith('DISAGREE') else 'pass'
    if decision == 'pass':
        return 'pass', None, ''

    outcome = None
    reasoning_lines = []
    for line in lines[1:]:
        if line.strip().upper().startswith('OUTCOME:'):
            outcome = line.split(':', 1)[1].strip()
        elif line.strip().upper().startswith('REASONING:'):
            reasoning_lines.append(line.split(':', 1)[1].strip())
        else:
            reasoning_lines.append(line)

    reasoning = '\n'.join(reasoning_lines).strip()
    if not reasoning:
        reasoning = text  # fallback: use full response as reasoning

    return decision, outcome, reasoning


def get_reply_chain_depth(bet_id: str, bets: list) -> int:
    """Count how deep in a reply chain a bet is."""
    by_id = {b['id']: b for b in bets}
    depth = 0
    current = bet_id
    while current and depth < 10:
        bet = by_id.get(current)
        if not bet or not bet.get('parent_bet_id'):
            break
        current = bet['parent_bet_id']
        depth += 1
    return depth


def run_reply_cycle(events):
    """Check recent bets and generate agent replies."""
    # Pick 1-2 random events to check for replies
    eligible = [e for e in events if e.get('category') in ('POLITICS', 'CRYPTO', 'MACRO', 'AI/TECH')]
    if not eligible:
        return

    check_events = random.sample(eligible, min(2, len(eligible)))

    for evt in check_events:
        event_id = evt['id']
        event_title = evt.get('title', '')
        event_category = evt.get('category', '')

        recent = fetch_recent_bets(event_id)
        if not recent:
            continue

        # Find agents who might want to reply
        for agent in AGENTS:
            name = agent['name']
            if event_category not in agent['categories']:
                continue

            # Cooldown check
            reply_key = f"{name}:{event_id}"
            if reply_key in _reply_log and (time.time() - _reply_log[reply_key]) < REPLY_COOLDOWN:
                continue

            # Balance check
            balance = get_balance(name)
            if balance < MIN_BALANCE:
                continue

            # On regular cooldown?
            if _is_on_cooldown(name):
                continue

            # Find a bet from ANOTHER agent to reply to
            target_bet = None
            for bet in recent:
                if bet.get('agent_name') == name:
                    continue
                # Don't reply to chains deeper than 3
                if get_reply_chain_depth(bet['id'], recent) >= 3:
                    continue
                # Prefer bets without many replies already
                replies_to_this = [b for b in recent if b.get('parent_bet_id') == bet['id']]
                if len(replies_to_this) >= 2:
                    continue
                target_bet = bet
                break

            if not target_bet:
                continue

            # Generate reply
            other_agent = target_bet.get('agent_name', 'Unknown')
            other_reasoning = target_bet.get('reasoning', '')[:500]
            outcome_label = target_bet.get('outcome_label') or target_bet.get('market_outcome_label', '')

            # Get available outcomes for this event
            evt_outcomes = evt.get('outcomes', [])
            active_labels = [o['label'] for o in evt_outcomes if not o.get('passed')]
            outcomes_str = '\n'.join(f'  - {label}' for label in active_labels) if active_labels else '  (no outcomes available)'

            prompt = REPLY_PROMPT.format(
                other_agent=other_agent,
                event_title=event_title,
                outcome_label=outcome_label,
                other_reasoning=other_reasoning,
                available_outcomes=outcomes_str,
                my_name=name,
                my_system=agent['system'][:200],
            )

            # Get AI response
            provider = agent.get('provider', 'anthropic')
            model = agent.get('model', 'claude-sonnet-4')
            try:
                if provider == 'openai' and openai_client:
                    resp = openai_client.chat.completions.create(
                        model=model, max_tokens=400,
                        messages=[{"role": "system", "content": agent["system"]}, {"role": "user", "content": prompt}],
                    )
                    reply_text = resp.choices[0].message.content.strip()
                elif claude_client:
                    claude_model = "claude-sonnet-4-20250514" if provider == "openai" else (model if "haiku" in model else "claude-sonnet-4-20250514")
                    resp = claude_client.messages.create(
                        model=claude_model, max_tokens=400,
                        system=agent["system"],
                        messages=[{"role": "user", "content": prompt}],
                    )
                    reply_text = resp.content[0].text.strip()
                else:
                    continue
            except Exception as e:
                print(f"  [{name}] Reply AI error: {e}")
                continue

            decision, reply_outcome, reasoning = parse_reply(reply_text)

            if decision == 'pass':
                print(f"  [{name}] PASS on replying to {other_agent} re: {event_title[:40]}")
                _reply_log[reply_key] = time.time()
                continue

            if not reply_outcome:
                continue

            # Place the reply bet
            wager = random.randint(agent['min_wager'], agent['max_wager'])
            wager = max(100, (wager // 50) * 50)
            confidence = random.randint(55, 85)

            payload = {
                "event_id": event_id,
                "outcome_label": reply_outcome,
                "gns_wagered": wager,
                "confidence": confidence,
                "reasoning": reasoning,
                "parent_bet_id": target_bet['id'],
                "reply_type": decision,
                "reply_to_agent": other_agent,
            }

            try:
                resp = requests.post(
                    f"{API}/v1/bets", json=payload,
                    headers={"Authorization": f"Bearer {agent['key']}"}, timeout=15,
                )
                if resp.status_code == 201:
                    badge = "AGREES" if decision == "agree" else "DISAGREES"
                    print(f"  [{name}] {badge} with {other_agent} on '{reply_outcome}' — {event_title[:50]}")
                    _record_bet(name)
                    _reply_log[reply_key] = time.time()
                else:
                    print(f"  [{name}] Reply rejected: {resp.status_code} {resp.text[:80]}")
            except Exception as e:
                print(f"  [{name}] Reply failed: {e}")

            break  # One reply per agent per cycle


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

            # Reply cycle: check for recent bets to reply to
            if events and cycle % 3 == 0:  # Run reply check every 3rd cycle
                print("  --- Reply check ---")
                run_reply_cycle(events)
        except Exception as e:
            print(f"  [!] Cycle failed: {e}")

        wait = random.randint(45, 75)
        print(f"  Sleeping {wait}s...")
        time.sleep(wait)


if __name__ == "__main__":
    main()
