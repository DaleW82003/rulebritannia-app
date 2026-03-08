# Rule Britannia – Simulation Model

## 1. Purpose of the Simulation

Rule Britannia is a role-playing political simulation of British parliamentary democracy, set in the post-1997 general election period. Its design goal is to let human players inhabit the institutions and processes of Westminster government and experience how legislative, executive, and institutional decisions unfold over simulated time.

The simulation models:

- **Parliamentary government** — a party system with a government, official opposition, and minor parties competing across 650 seats.
- **Role-based political interaction** — every participant occupies a specific office (Prime Minister, Secretary of State, backbencher MP, etc.) that determines what they may do and say.
- **Legislative processes** — bills move through formal readings, report stages, and parliamentary divisions before becoming law.
- **Institutional decision-making** — cabinet papers, civil service briefings, budget-setting, and the management of devolved bodies all involve distinct actors and procedures.
- **Accelerated simulation time** — real calendar days map to simulated months, so a full parliamentary term can be experienced over weeks of real time.

The historical starting point (August 1997, immediately after Labour's landslide election victory) provides a realistic, data-backed world that players inhabit rather than an abstract one they must build from scratch.

---

## 2. Core Simulation Concepts

### Simulation time

Time is the central coordinating mechanism. Every deadline, every debate window, and every division closing date is expressed in *simulation months*. Two simulation months advance per real-world week (Monday marks one month, Thursday marks another). Sundays are frozen. The server and client share identical clock logic to ensure every participant sees the same current simulation date.

### Characters

A character is any human player registered in the system. Each character holds exactly one parliamentary role and, for MPs, one constituency. Characters cast votes in divisions, draft legislation, hold cabinet office, and interact with civil service machinery. Non-player characters (NPCs) fill the remaining seats not occupied by human players and vote according to party instructions.

### Constituencies

The electoral map is derived from the real 1997 general election result: 659 constituencies spread across England, Scotland, Wales, and Northern Ireland. Each constituency belongs to a party and may be held by a player or NPC. Constituency data grounds the simulation in historical reality and gives the seat counts that underpin all division weight calculations.

### Parliamentary bodies

Beyond the House of Commons the simulation tracks a set of additional democratic institutions: the House of Lords, the European Parliament, and the three devolved legislatures (Scottish Parliament, Welsh Assembly, and Northern Ireland Assembly), plus directly elected mayors. Each body has a seat count, controlling party, and visibility state.

### Legislation

A bill is a formal legislative proposal. It passes through a structured sequence of stages (readings, debate, report, division) before it either receives Royal Assent and becomes an Act, or is defeated or withdrawn. Amendments may be proposed and voted upon during the Second Reading and Report Debate stages.

### Divisions

A division is the formal parliamentary vote attached to a bill, motion, amendment, statement, or regulation. Players cast votes (Aye, No, or Abstain); NPC seats vote according to whip instructions; absent players delegate their weight to their party leader. The result is determined by weighted totals.

### Cabinet and shadow cabinet

The government is led by fifteen cabinet offices mirroring real departmental responsibilities. An opposition shadow cabinet mirrors this structure. Cabinet members can prepare and share draft legislation, set a headline policy agenda, and direct their departments through the civil service system.

### Civil service

Each cabinet office maps to a named government department (e.g., the Home Secretary's department is the Home Office). Departments issue briefings — structured memos that may present branching scenarios with choices and consequences — and track ongoing civil service cases such as scandals or investigations.

### Budget

The simulation maintains a budget comprising seven revenue lines (Income Tax, Corporation Tax, VAT, National Insurance, Fuel Duty, Stamp Duty, and Business Rate Appropriations) and fifteen expenditure lines covering all major departmental spending areas. Fiscal aggregates (deficit, debt, GDP ratios) derive from these figures. The Chancellor drafts the budget; admins and moderators approve or reject it.

---

## 3. Entities in the Simulation

### Characters

Players register and, once approved, are assigned a parliamentary role. Each character has:

- **Role** — their parliamentary position (e.g., `prime-minister`, `backbencher`, `secretary-state-health`).
- **Party** — the party they represent.
- **Constituency** — the seat they hold (for MPs).
- **Active / absent status** — used by the division engine when distributing vote weight.
- **Delegation** — the party leader to whom their vote weight flows when they are absent.
- **Profile attributes** — education level, career background, and family situation drawn from fixed enumerations.

### Constituencies

659 constituencies represent the UK electoral map as it stood after the 1997 general election. Each record carries:

- Name, region, and nation.
- The party that won the seat in 1997.
- Whether the seat is currently held by a player or NPC.

Constituency data is pre-loaded from a structured CSV of 1997 results and stored as JSON. It is not dynamically updated by election events within the current simulation; the 1997 results provide a stable starting distribution of seats.

### Parliamentary bodies

The simulation maintains a registry of democratic institutions beyond the Commons:

| Body | Seats |
|---|---|
| House of Lords | Variable |
| European Parliament | 87 |
| Scottish Parliament | 129 |
| Welsh Assembly | 60 |
| Northern Ireland Assembly | 108 |
| Directly Elected Mayors | Per mayoralty |

Each body has a control type (Majority, Coalition, or Minority), a controlling party, and a party-by-party breakdown. Bodies may be hidden or visible in the public interface.

### Cabinet

Fifteen full cabinet offices exist:

1. Prime Minister, First Lord of the Treasury, and Minister for the Civil Service
2. Chancellor of the Exchequer, and Second Lord of the Treasury
3. Secretary of State for the Home Department
4. Secretary of State for Foreign and Commonwealth Affairs
5. Secretary of State for Business and Trade, and President of the Board of Trade
6. Secretary of State for Defence
7. Secretary of State for Work and Pensions
8. Secretary of State for Education
9. Secretary of State for the Environment and Agriculture
10. Secretary of State for Health and Social Care
11. Secretary of State for Transport and Infrastructure
12. Secretary of State for Culture, Media and Sport
13. Secretary of State for the Home Nations
14. Leader of the House of Commons
15. (Whips Office)

A parallel set of fourteen shadow cabinet positions mirrors the government positions for the official opposition.

### Civil service

Thirteen departments correspond to the cabinet offices listed above (10 Downing Street, 11 Downing Street, Home Office, Foreign Office, Board of Trade, MoD, DWP, Department for Education, DEA, Department of Health, DoT, DCMS, and Department for the Home Nations). Departments are the actors in the civil service briefing and case systems.

### Legislation

A bill entity holds:

- **Metadata**: title, purpose, sponsoring department, Discourse forum URL.
- **Articles**: numbered clauses each with a heading and body text.
- **Extent and commencement clauses**: final article specifying geographic scope and when the Act takes effect.
- **Stage**: the current legislative position.
- **Amendments**: a list of proposed changes with supporting signatories and their own division records.
- **Stage reports**: content submitted during the Report Stage.

### Divisions

A division entity is linked to a parent entity (bill, motion, amendment, statement, or regulation) and records:

- Open/closed status and closing deadline (in both real and simulation time).
- Individual player votes (choice and weight).
- NPC votes per party.
- Party whip instructions.
- Rebellion log (players who voted against party instruction).
- Weighted tally of Ayes, Noes, and Abstentions.

---

## 4. Legislative Process

Bills move through a fixed sequence of stages. Stage advancement is controlled by the bill's sponsor or by admin/moderator oversight.

### Drafting

In the cabinet drafts system, ministers prepare draft legislation as cabinet papers before a bill is formally submitted. These drafts are visible only to cabinet members (and admins/moderators). A draft carries a title, purpose, and free-form content.

### First Reading

A bill is formally introduced to parliament at First Reading. This is a procedural stage: the bill is named and tabled without debate. It may be refused at this stage (status: `First Reading Refused`).

### Second Reading

The main debate stage. The bill is linked to a Discourse forum topic where players discuss it. Amendments may be proposed and supported during this window. The Second Reading window is two simulation months.

### Report Stage

The bill sponsor submits a Report Stage document that addresses the amendments received. This is followed by the Report Debate stage (also two simulation months), during which the amended text is discussed further.

### Final Division

A formal parliamentary vote is opened. The division remains open for one simulation month. All MPs (players and NPCs) cast votes; absent players delegate to their party leader. The weighted tally determines the outcome.

### Passage or defeat

- If Ayes exceed Noes: the bill passes and moves to `Passed – Awaiting Assent`. An admin or moderator then grants Royal Assent, moving the bill to `Act (Royal Assent Granted)`.
- If Noes exceed or equal Ayes: the bill is `Defeated in Division`.
- The sponsor may withdraw the bill at any stage, setting it to `Withdrawn`.

### Amendments

Amendments may be proposed and voted upon during the Second Reading and Report Debate stages. Each amendment has its own division. Amendments may be accepted, refused, or left pending according to their division result.

---

## 5. Voting and Divisions

### How votes are triggered

A division is created by an authorised actor (the bill sponsor, a government minister, or an admin) and attached to a parent entity. The division has a closing deadline expressed in simulation months. Once opened, all MPs may cast votes until the deadline.

### Weight calculation

The division engine assigns a numeric weight to each vote rather than counting one vote per player. The calculation works as follows:

1. The Speaker holds zero voting weight (they vote only in a tied division, casting by convention for the status quo).
2. Sinn Féin MPs do not take their seats and are automatically assigned an abstain vote with zero effective weight.
3. New backbenchers (those who joined within the last two simulation weeks) are each assigned weight 1.
4. The total remaining seats for each party are distributed among that party's settled players proportionally to their number.
5. Absent players' weight flows to their party leader. If the leader is also absent, weight flows to another available party member. If the leader has explicitly delegated to a named player of the same party, weight follows that delegation.

### Result calculation

After the division closes the tally function sums the weighted votes by choice. The outcome is:

- **Passed**: total Aye weight > total No weight.
- **Failed**: total No weight > total Aye weight.
- **Tied**: equal weights (exceedingly rare given weighted seat arithmetic).

### What is recorded

The division record stores every individual vote (actor name, party, choice, weight, timestamp), the NPC votes aggregated by party, the party whip instructions that were issued, any rebel requests made in advance, and the final rebellion log identifying players who voted against their party's instruction.

---

## 6. Simulation Time

### Mechanism

Simulation time is computed dynamically from three parameters stored in the game state:

- `startRealDate` — the real-world timestamp at which the simulation was started.
- `startSimMonth` / `startSimYear` — the simulation calendar date at that moment (default: August 1997).
- `isPaused` / `pausedAtRealDate` — if paused, time stops advancing from the stored real date.

The algorithm counts the number of Mondays and Thursdays that have elapsed between the start date and the current moment. Each Monday crossed advances the simulation by one month; each Thursday crossed advances it by another. This yields two simulation months per real week.

Sundays do not contain a Monday or Thursday boundary and therefore contribute no simulation time.

### Server and client parity

The clock module is implemented identically on both the server (`server/clock.js`) and client (`js/clock.js`). Every deadline check, countdown display, and "what month is it?" query uses the same algorithm, preventing any drift between what the server enforces and what the client shows.

### Helpers

The clock module exposes:

- `getSimDate(gameState, now)` — current simulation month and year.
- `plusSimMonths(month, year, n)` — a date *n* months in the future.
- `compareSimDates(a, b)` — chronological ordering of simulation dates.
- `isDeadlinePassed(deadline, gameState)` — whether a deadline has expired.
- `simMonthsRemaining(deadline, gameState)` — months remaining until a deadline.
- `countdownToSimMonth(target, gameState)` — human-readable countdown string (e.g., "2d 14h 30m").
- `realDateOfSimMonth(target, gameState)` — the real-world calendar date on which a simulation month will be reached.

### Pause and resume

An admin may pause the simulation at any point. While paused, the effective current time is fixed at `pausedAtRealDate`, so no deadlines advance and no new months tick over. Resuming the simulation shifts `startRealDate` forward by the paused interval so elapsed time is preserved correctly.

---

## 7. Geographic and Electoral Model

### The 1997 constituency dataset

The simulation's electoral map is derived from the real results of the United Kingdom general election of 1 May 1997. This election is the natural starting point for the simulation because:

- It produced a decisive result (Labour won 418 of 659 seats) that gives the government a workable majority without requiring complex coalition negotiation.
- It corresponds to the moment when several major constitutional changes (devolution, Bank of England independence) were about to be enacted, giving players meaningful legislative territory.
- The full 659-constituency result is publicly available and can be encoded reliably.

### Data structure

Each of the 659 constituency records holds:

```
id          — URL-safe slug identifier
name        — official constituency name
nation      — England | Scotland | Wales | Northern Ireland
region      — sub-national region (e.g., London, South East, Scotland)
party       — the party that won the seat in 1997
mpType      — "" (vacant) | "npc" | "character" (player)
mpName      — the name of the current occupant, if any
```

### Conversion from CSV

The raw data lives in `data/1997_structured.csv`. The conversion script `scripts/convert-1997-csv.js` reads four row types from that CSV (`constituency_result`, `vote_summary`, `seat_breakdown`, `overall_total`) and produces the structured JSON file `data/constituencies_1997.json`. The script normalises party name encodings (including handling Sinn Féin character encoding variants), maps devolved regions to their correct nations, and validates that exactly 659 constituencies are present before writing output.

### Use in gameplay

Constituency data feeds three primary gameplay systems:

1. **Character assignment** — when a player is approved as an MP they must claim a constituency that is not already taken by another player.
2. **Division weight** — the total number of seats held by each party determines how much collective vote weight that party's players share.
3. **Bodies** — devolved legislature seat counts and the national breakdown of the Commons are both derived from constituency-level party totals.

---

## 8. Role System

### Parliamentary roles

Every character in the simulation holds one of the following top-level parliamentary roles:

| Role identifier | Description |
|---|---|
| `prime-minister` | Government leader; access to full executive machinery |
| `leader-opposition` | Official opposition chief; commands shadow cabinet |
| `party-leader-3rd-4th` | Leader of a third or fourth party |
| `speaker` | Speaker of the House; does not vote; tie-break only |
| `backbencher` | Standard MP with no additional office |

In addition, characters may hold an **office** within their role:

- **Cabinet offices** — the fifteen government positions (Secretary of State, Chancellor, etc.).
- **Shadow cabinet offices** — the fourteen opposition mirror positions.
- **Parliamentary offices** — procedural roles such as Leader of the House of Commons.
- **Other offices** — roles that do not fit the above categories.

### Effect on permissions

A character's role and office determine what actions they may take:

- Only the Prime Minister (or admin/moderator) may open and manage cabinet papers.
- Only the Chancellor may draft the budget.
- Only cabinet members may access the civil service briefing and case systems for their department.
- Only a bill's sponsor or an authorised office holder may advance a bill through its stages or open a final division.
- Admins and moderators have universal management access across all systems.
- The Speaker moderates divisions but does not participate in the vote tally.

### Special handling for certain roles

- **Sinn Féin** MPs hold seats but do not take them. They are excluded from division tallies automatically.
- **The Speaker** participates in debates but has zero voting weight in divisions.
- **New backbenchers** (joined within two simulation weeks) have reduced weight (1 each) in divisions until they are considered settled.
- **Privy Council membership** (the post-nominal "PC") is awarded for life on appointment to Prime Minister, Leader of the Opposition, or leader of a third or fourth party. The post-nominal "MP" is universal for all players with a parliamentary seat.

---

## 9. Institutional Structure

The simulation models a hierarchy of UK government institutions. Decision-making flows between them as follows.

```
Crown (formal assent)
│
└── Parliament
    ├── House of Commons  ←─── primary legislative chamber
    │   ├── Government benches
    │   │   └── Cabinet (15 offices)
    │   │       └── Civil Service (13 departments)
    │   │           ├── Briefings (policy memos)
    │   │           └── Cases (scandals / investigations)
    │   └── Opposition benches
    │       └── Shadow Cabinet (14 positions)
    │
    └── House of Lords  (body in the system; non-voting in current model)
│
└── Devolved institutions
    ├── Scottish Parliament  (129 seats)
    ├── Welsh Assembly       (60 seats)
    ├── Northern Ireland Assembly (108 seats)
    └── Directly Elected Mayors
│
└── European Parliament  (87 seats, 1997-era)
```

### Decision flow for legislation

1. A government minister (or any MP) drafts a bill, often starting with a cabinet paper.
2. The bill is formally introduced in the House of Commons at First Reading.
3. It proceeds through Second Reading debate, Report Stage, and Report Debate.
4. A Final Division is called; the House votes by weighted division.
5. If passed, the bill waits for an admin or moderator to grant Royal Assent on behalf of the Crown.
6. The resulting Act is recorded with its extent and commencement date.

### Decision flow for the executive

1. The Prime Minister sets a cabinet headline agenda.
2. Cabinet ministers prepare papers through the cabinet drafts system.
3. Departments issue civil service briefings that may present branching policy scenarios to the relevant Secretary of State.
4. Civil service cases track ongoing departmental issues that may require ministerial decisions.
5. The Chancellor sets the budget through the budget system; it is reviewed and approved by admins/moderators.

---

## 10. Example Simulation Flow

The following illustrates how a government bill passes through the system from inception to Royal Assent.

**Step 1 – Cabinet preparation**  
The Secretary of State for Health drafts a cabinet paper titled "NHS Reform Bill" with a stated purpose and outline content. This is visible only to cabinet members.

**Step 2 – First Reading**  
The Secretary of State submits the bill formally. It receives its title, purpose, sponsoring department, and initial article text. The simulation records it as `First Reading`.

**Step 3 – Second Reading (debate opens)**  
An admin or the bill sponsor advances it to Second Reading. The simulation automatically creates a Discourse forum topic for debate. The Second Reading window lasts two simulation months (approximately one real week). During this time other players may propose amendments.

**Step 4 – Report Stage**  
The sponsor submits a Report Stage document responding to amendments. The Report Debate window opens (another two simulation months). Players debate the amendments and further amendments may be proposed.

**Step 5 – Final Division**  
The sponsor or an admin opens the Final Division. The division closes after one simulation month. All MPs — players and NPCs — cast votes. Absent players' weight flows to the party leader.

**Step 6 – Tally and outcome**  
When the division closes, the system totals weighted Ayes and Noes. If Ayes > Noes the bill is marked `Passed – Awaiting Assent`.

**Step 7 – Royal Assent**  
An admin or moderator grants Royal Assent. The bill becomes `Act (Royal Assent Granted)` and is recorded with its extent (e.g., "England and Wales") and commencement date (e.g., "in six months").

---

## 11. Data Sources

### Constituency data (`data/constituencies_1997.json`)

Derived from the 1997 UK general election results. Contains 659 records covering every Westminster constituency with party affiliation, region, and nation. This file is generated once by `scripts/convert-1997-csv.js` and treated as a static reference; it seeds the initial seat distribution used throughout the simulation.

### Raw CSV (`data/1997_structured.csv`)

The source data for constituency conversion. Structured with multiple row types (`constituency_result`, `vote_summary`, `seat_breakdown`, `overall_total`) allowing the conversion script to produce both individual constituency records and aggregate party totals.

### Demo dataset (`data/demo.json`)

A read-only snapshot of a running simulation used for public demonstration. It contains:

- A full `gameState` object (start date, sim start month/year, pause state).
- `parliament` object (seat totals per party, government party, setup type).
- A `players` array with sample characters across roles and parties.
- Default economic indicators (GDP growth 1.8%, inflation 2.6%, unemployment 4.3%).
- Placeholder data for newspapers, surveys, and order paper items.

The demo dataset establishes the shape of the live game state for frontend developers working without a database connection and for new users exploring the simulation before registering.

### How datasets shape the simulation world

- **Seat counts** from constituency data determine division vote weights; a party with 418 seats has proportionally more influence in a division than one with 46.
- **Regional distribution** from the CSV is used to filter constituencies by nation when assigning MPs to devolved institution contexts.
- **Economic defaults** in the demo dataset initialise the macroeconomic indicators that provide context for budget debates and policy decisions.

---

## 12. Simulation Constraints

Based on the current codebase, the following limitations are visible in the model.

**Simplified legislative process**  
Bills move through a linear sequence of stages; there is no committee stage, no Lords stage, no ping-pong between chambers, and no use of the Parliament Acts. The House of Lords exists as a tracked body but does not participate in the bill passage mechanism.

**Static constituency boundaries**  
The 1997 constituency data is fixed at start-up. There are no by-elections, no redistribution of seats, and no mechanism for seats to change hands during play. The seat count per party remains the 1997 election result for the lifetime of the simulation.

**NPC voting by instruction only**  
Non-player-character MPs vote according to party whip instructions entered by a whip or admin. They do not have independent policy preferences, rebellion probability, or behavioural modelling beyond applying the instruction mechanically.

**No AI-driven actors**  
There is no artificial intelligence generating political behaviour, strategy, or responses. All political agency comes from human players.

**Limited economic simulation**  
The budget system records revenues and expenditures and calculates aggregate fiscal metrics, but these figures do not feed back into simulated economic outcomes. GDP growth, inflation, and unemployment are static display values in the demo state; there is no dynamic model linking policy choices to economic indicators.

**No election mechanism**  
The simulation begins post-election and does not include a mechanism for calling a general election, running a campaign, or redistributing seats based on a result. The parliament composition reflects 1997 and does not change.

**Single chamber voting**  
Only the House of Commons participates in divisions. The House of Lords, devolved legislatures, and other bodies are tracked informationally but do not vote on Commons legislation.

**No public opinion system**  
Nine newspapers are represented in the data model, but there is no polling system, approval rating tracker, or mechanism by which media coverage affects character standing or electoral outcomes.

---

## 13. Potential Simulation Extensions

The following extensions would be reasonable evolutions of the existing architecture based on what the codebase already contains.

**Elections and seat redistribution**  
The constituency data structure already supports tracking party affiliation and MP occupancy per seat. An election engine could compute swing percentages, redistribute seats, and update the `parliament` object accordingly, triggering recalculation of all division weights.

**House of Lords legislative stage**  
The Lords already exist as a tracked body. Introducing a Lords reading stage between `Passed – Awaiting Assent` and Royal Assent would add a second chamber dynamic: the Lords could amend, delay, or return bills to the Commons.

**Dynamic economic model**  
Budget revenues and expenditures already feed into deficit and debt calculations. Connecting spending decisions to the economic indicator values (GDP, inflation, unemployment) would allow policy choices to have in-simulation consequences.

**Public opinion and polling**  
The nine newspapers in the data model provide a framework for a media system. A polling engine could track party approval ratings influenced by legislation passed, economic conditions, and media coverage, feeding into simulated election outcomes.

**NPC behavioural modelling**  
NPCs could be given ideological profiles and rebellion probabilities, making division outcomes less predictable and more dependent on genuine parliamentary management by government whips.

**Committee stage for legislation**  
A committee of MPs could be assigned to scrutinise a bill after Second Reading, proposing amendments with a quorum-based mini-division, before the bill returns to the floor for Report Stage.

**Devolved legislative processes**  
The Scottish Parliament, Welsh Assembly, and Northern Ireland Assembly already have seat counts and party breakdowns. Giving them their own bill stage pipelines and division systems would allow devolved legislation to be modelled separately from Westminster legislation.

**Party leadership contests**  
The role system already distinguishes between leaders at different levels. A leadership election mechanic — triggered by resignation or confidence vote — could allow the party membership to choose a new leader, updating role assignments automatically.

**By-elections**  
A by-election system could allow individual constituency seats to change hands mid-simulation, updating party seat totals and therefore division weights without requiring a full general election.
