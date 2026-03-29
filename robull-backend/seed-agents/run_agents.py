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

import os, sys, time, random, json, re
from datetime import datetime, timezone
from typing import Optional
from pathlib import Path
from dotenv import load_dotenv
import requests

# Load keys from .env.agents, fall back to .env
_env_agents_path = Path(__file__).parent / ".env.agents"
print(f"  Loading env from: {_env_agents_path.resolve()}")
load_dotenv(_env_agents_path)
load_dotenv(Path(__file__).parent / ".env")

# Debug: count keys loaded from .env.agents
_loaded_keys = 0
if _env_agents_path.exists():
    _loaded_keys = sum(1 for line in _env_agents_path.read_text().splitlines() if line.strip() and "=" in line and not line.startswith("#"))
print(f"  Keys in .env.agents: {_loaded_keys}")

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

TAVILY_KEY = os.environ.get("TAVILY_API_KEY", "")
tavily_client = None
if TAVILY_KEY:
    from tavily import TavilyClient
    tavily_client = TavilyClient(api_key=TAVILY_KEY)
    print("  Tavily: connected")
else:
    print("  Tavily: NO KEY — agents will reason without web search")

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
CRITICAL: Every bullet point MUST be on its own separate line. Never put multiple bullets on the same line.

You MUST respond using this EXACT format. No prose. Only bullets.

STRENGTHS:
• [2-4 bullets, each a standalone fact or argument, max 20 words]

RISKS:
• [2-4 bullets, each a standalone fact or argument, max 20 words]

VERDICT:
• [one or two bullets maximum with the final call]

CHOSEN: [exact outcome label]

Rules:
• No prose whatsoever
• Each bullet is one standalone fact or argument, maximum 20 words
• Each section has 2-4 bullets maximum
• CHOSEN must be on its own line at the very end
• Every bullet must be on its own line"""

# ── Helpers ─────────────────────────────────────────────────────────────────

_balance_cache: dict[str, float] = {}


def search_for_context(question: str, category: str) -> str:
    """Search Tavily for web context relevant to a market question."""
    if not tavily_client:
        return ""
    try:
        query = f"{question} {category}"
        if category == "CRYPTO" or any(w in question.lower() for w in ("price", "above", "below", "btc", "eth", "bitcoin", "ethereum")):
            query = f"current price today {query}"
        result = tavily_client.search(
            query=query,
            search_depth="basic",
            max_results=3,
        )
        parts = []
        if result.get("answer"):
            parts.append(f"Web Summary: {result['answer']}")
        for r in result.get("results", [])[:3]:
            title = r.get("title", "")
            content = r.get("content", "")[:200]
            parts.append(f"- {title}: {content}")
        return _strip_market_probabilities("\n".join(parts))
    except Exception as e:
        print(f"  [!] Tavily search failed: {e}")
        return ""


# Strip any phrase containing a percentage figure — removes the whole
# surrounding clause (up to sentence/clause boundaries) so no numeric
# probability context leaks into Stage 1.
_PCT_CLAUSE = re.compile(
    r'[^.,;:\n]*\d+\.?\d*\s*[%¢][^.,;:\n]*[.,;:]?\s*',
    re.IGNORECASE,
)


def _strip_market_probabilities(text: str) -> str:
    """Aggressively remove all percentage figures and their surrounding phrases from web context."""
    cleaned = _PCT_CLAUSE.sub('', text)
    # Collapse any resulting double-spaces or blank lines
    cleaned = re.sub(r' {2,}', ' ', cleaned)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned.strip()


def fetch_markets():
    resp = requests.get(f"{API}/v1/markets", params={"resolved": "false", "blind": "true"}, timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_events():
    resp = requests.get(f"{API}/v1/events", params={"blind": "true"}, timeout=15)
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
        probs = m.get("current_probs", m.get("initial_probs")) or [0.5, 0.5]
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
            "probabilities": [o.get("probability", 0.5) for o in active],
            "volume": float(e.get("volume", 0)),
        })

    # Deduplicate: remove binary markets that overlap with multi-outcome events.
    # If a binary market's question matches an event title (60+ char overlap),
    # drop the binary version — the event version is always preferred.
    event_titles = [o["question"].lower() for o in ops if o["type"] == "event"]
    deduped = []
    for o in ops:
        if o["type"] == "binary":
            q = o["question"].lower()
            is_dupe = any(
                q[:60] in et or et[:60] in q
                for et in event_titles
                if len(et) >= 60 and len(q) >= 60
            )
            if is_dupe:
                continue
        deduped.append(o)
    return deduped


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


def _parse_chosen_outcome(reasoning: str, outcomes: list[str]) -> Optional[str]:
    """Extract the agent's chosen outcome from its reasoning text."""
    # Look for explicit "CHOSEN: <label>" line
    for line in reasoning.splitlines():
        stripped = line.strip().upper()
        if stripped.startswith("CHOSEN:"):
            chosen_text = line.split(":", 1)[1].strip()
            # Match against available outcomes (case-insensitive)
            for o in outcomes:
                if o.lower() == chosen_text.lower():
                    return o
            # Fuzzy: check if outcome label appears in the chosen text
            for o in outcomes:
                if o.lower() in chosen_text.lower():
                    return o
    # Fallback: scan VERDICT section for any outcome label
    in_verdict = False
    for line in reasoning.splitlines():
        if line.strip().upper().startswith("VERDICT"):
            in_verdict = True
        elif in_verdict and line.strip().upper().startswith(("PRICE CHECK", "STRENGTHS", "RISKS")):
            break
        if in_verdict:
            for o in outcomes:
                if o.lower() in line.lower():
                    return o
    return None


def generate_reasoning(agent, opp):
    """Generate reasoning and return (reasoning_text, chosen_outcome_index)."""
    outcomes = opp.get("outcomes", [])
    probs = opp.get("probabilities", [])

    # Current date/time header for the prompt
    now_utc = datetime.now(timezone.utc)
    date_line = f"TODAY: {now_utc.strftime('%A, %B %d, %Y at %H:%M')} UTC\n\n"

    # Fetch web context before building prompt
    web_context = search_for_context(opp["question"], opp.get("category", ""))
    context_block = f"\n\nWEB CONTEXT:\n{web_context}" if web_context else ""

    # Stage 1: Blind reasoning — no prices, agent picks its own outcome
    if opp["type"] == "event":
        outcome_lines = "\n".join(
            f"  - {outcomes[i]}" for i in range(min(len(outcomes), 12))
        )
        user_prompt = (
            f"{date_line}"
            f'Event: "{opp["question"]}"\n'
            f"Category: {opp['category']}\n"
            f"Available outcomes:\n{outcome_lines}\n"
            f"{context_block}\n\n"
            f"You must choose ONE outcome to bet on. Analyse all options and select the one you have most conviction in.\n"
            f"Using only the information above and your own knowledge, complete ALL sections below.\n\n"
            f"{REASONING_FORMAT}"
        )
    else:
        user_prompt = (
            f"{date_line}"
            f'Market: "{opp["question"]}"\n'
            f"Category: {opp['category']}\n"
            f"Outcomes: {', '.join(outcomes)}\n"
            f"{context_block}\n\n"
            f"You must choose ONE outcome to bet on. Analyse all options and select the one you have most conviction in.\n"
            f"Using only the information above and your own knowledge, complete ALL sections below.\n\n"
            f"{REASONING_FORMAT}"
        )

    provider = agent.get("provider", "anthropic")
    model = agent.get("model", "claude-sonnet-4")

    try:
        if provider == "openai" and openai_client:
            resp = openai_client.chat.completions.create(
                model=model,
                max_tokens=500,
                messages=[
                    {"role": "system", "content": agent["system"]},
                    {"role": "user", "content": user_prompt},
                ],
            )
            reasoning = resp.choices[0].message.content.strip()
        elif claude_client:
            if provider == "openai":
                claude_model = "claude-sonnet-4-20250514"
            elif model == "claude-haiku-4-5-20251001":
                claude_model = "claude-haiku-4-5-20251001"
            else:
                claude_model = "claude-sonnet-4-20250514"
            resp = claude_client.messages.create(
                model=claude_model,
                max_tokens=500,
                system=agent["system"],
                messages=[{"role": "user", "content": user_prompt}],
            )
            reasoning = resp.content[0].text.strip()
        else:
            # No AI client — fall back to random outcome
            idx = random.randrange(len(outcomes))
            return f"Taking {outcomes[idx]} based on current analysis.", idx
    except Exception as e:
        print(f"  [!] AI API error ({provider}/{model}): {e}")
        idx = random.randrange(len(outcomes))
        return f"Taking {outcomes[idx]} based on current analysis.", idx

    # Parse the agent's chosen outcome
    chosen = _parse_chosen_outcome(reasoning, outcomes)
    if chosen:
        outcome_idx = outcomes.index(chosen)
    else:
        # Agent didn't clearly state a choice — fall back to random
        outcome_idx = random.randrange(len(outcomes))
        chosen = outcomes[outcome_idx]
        print(f"  [!] Could not parse outcome from reasoning, falling back to '{chosen}'")

    # Stage 2: Log price check internally but don't include in public reasoning
    prob = probs[outcome_idx] if outcome_idx < len(probs) else 0.5
    print(f"  PRICE CHECK: {chosen} @ {prob:.1%}")

    # Strip PRICE CHECK and CHOSEN lines from public reasoning
    clean_reasoning = re.sub(r'\n*PRICE CHECK:.*$', '', reasoning, flags=re.DOTALL).strip()
    clean_reasoning = re.sub(r'\n*CHOSEN:.*', '', clean_reasoning).strip()

    # Ensure every • bullet is on its own line
    clean_reasoning = re.sub(r'(?<!\n)•', '\n•', clean_reasoning)
    # Ensure section headers have a blank line before them
    clean_reasoning = re.sub(r'(?<!\n\n)(STRENGTHS:|RISKS:|VERDICT:)', r'\n\n\1', clean_reasoning)
    clean_reasoning = re.sub(r'\n{3,}', '\n\n', clean_reasoning).strip()

    return clean_reasoning, outcome_idx


def place_bet(agent, opp, outcome_idx, reasoning):
    balance = get_balance(agent["name"])
    max_allowed = max(50, balance * 0.05)  # mirrors backend: BASE_MAX_BET * (balance / 10000)
    ceil = min(agent["max_wager"], int(max_allowed))
    floor = min(agent["min_wager"], ceil)
    wager = random.randint(floor, ceil)
    wager = max(100, (wager // 50) * 50)

    probs = opp.get("probabilities") or []
    prob = probs[outcome_idx] if outcome_idx < len(probs) else None
    confidence = max(30, min(95, int(prob * 100) + random.randint(-10, 15))) if prob is not None else random.randint(45, 80)

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
CRITICAL: Every bullet point MUST be on its own separate line. Never put multiple bullets on the same line.

{other_agent} just placed this bet on "{event_title}":
Outcome: {outcome_label}
Reasoning: {other_reasoning}

AVAILABLE OUTCOMES (you MUST pick one of these EXACTLY as written):
{available_outcomes}

You are {my_name}. {my_system}

STRESS TEST {other_agent}'s reasoning. Disagreement is MORE valuable than agreement.
If you see ANY flaw, gap, or questionable assumption — DISAGREE and explain why.
If you genuinely cannot find a flaw: AGREE and explain what you ADD.
If the topic is outside your expertise: PASS.

You MUST start your response with exactly one of: AGREE, DISAGREE, or PASS
Then use this EXACT format. No prose. Only bullets.

AGREE/DISAGREE/PASS
OUTCOME: [exact outcome label from the list above, or none if PASS]

STRENGTHS:
• [2-4 bullets, each a standalone fact or argument, max 20 words]

RISKS:
• [2-4 bullets, each a standalone fact or argument, max 20 words]

VERDICT:
• [one or two bullets maximum with the final call]

CHOSEN: [exact outcome label]

Rules:
• No prose whatsoever
• Each bullet is one standalone fact or argument, maximum 20 words
• Each section has 2-4 bullets maximum
• CHOSEN must be on its own line at the very end
• Every bullet must be on its own line"""


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

        reasoning, outcome_idx = generate_reasoning(agent, opp)
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
    print(f"  Tavily: {'yes' if tavily_client else 'NO'}")
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
