# Ouahad Hackathons: product and data design v1

`hackathons.ouahad.space` is one public catalog with two views: **In Morocco** and **International online from Morocco**. Filter by domain, location, format, eligibility, and application status. An edition can appear in both views using the same card if both routes are verified. Show age, student, and team restrictions alongside geographic eligibility. Unknown eligibility stays out of international recommendations and alerts; unknown registration stays out of open results.

## Catalog and archive

- A **competition** is the named series or standalone event. An **edition** is one occurrence, with its own stable ID, domains, official links, and source evidence. Cards, saves, and entry counts use the edition ID. Keep source/external IDs as references to it; link another source or another edition of a series only with organizer evidence.
- A **stage** is a documented competitive step within an edition, such as a qualifier or final. It can have its own venue or online route, eligibility, entry method (direct application or advancement), schedule, application deadline, submission cutoff, and links. Keep these dates separate and preserve their precision and zone. Published rounds and progression rules can override edition defaults for that stage; missing facts remain unknown. Workshops, voting windows, and submission deadlines do not create stages on their own.
- For a listing with one documented event window and no documented rounds, use one internal stage for that window; display it as the event, without naming a round or asserting that no other rounds exist. Add named stages only when verified. An edition is open to new entrants if a verified direct entry route is open. When all entry routes are known closed, put it in the archive with **Applications closed**, even if a final is still ahead. Show **Finished** when the event has ended; leave unknown status visible as unknown where the listing otherwise qualifies. Archived editions keep their URLs and remain in My Hackathons.

Map the ten Phase 1 drafts to separate competitions, each with one edition and one event window. No named rounds, cross-record links, or publication approvals are implied.

| Phase 1 listing | Edition and stage mapping |
| --- | --- |
| Hackathon Open Data 2026 | Dec 21–22 in Rabat; apply by Nov 20. |
| TechNovate — Blue Tech | Dec 18–19 in Agadir; Nov 30 cutoff, current registration and eligibility unknown. |
| Think AI Morocco 2024 | May 16–19; final report is a submission cutoff, not a round. |
| Water4Future, 3rd edition | Nov 23–24; applications closed Nov 4. Selection is not a stage. |
| Mémoire, Patrimoine, Innovation & Investissement | Apr 3–4; March 24 application cutoff. |
| NASA Space Apps 2025 — Universal Event | Oct 4–5; Universal is the online route. Keep the team-local submission rule as a note. |
| United Hacks v8 | Jan 8–10, 2027; known project cutoff, unknown registration. |
| GitHub Game Off 2026 | Nov 1–Dec 1; no voting stage. Morocco eligibility unknown. |
| Radish Jam | June 22–July 10 program window from the API. |
| Ember | Feb 27–Mar 15 program window from the API; conflicting evidence leaves the submission timestamp unset. |

## Accounts and My Hackathons

Only private features require an account. **Save** bookmarks an edition. **Mark application submitted** is a separate, explicit action tied to the relevant stage. Opening an organizer link changes no status. Record decisions (pending, accepted, declined by organizer), attendance intent (undecided, going, won't attend), actual attendance, and results such as advanced or placed separately. Confirming advancement adds the next stage to the same edition; it does not record attendance or another application. If advancement alone does not secure a spot, keep the next stage conditional until the user records confirmation.

**Add external opportunity** lets a user enter a title, optional organizer URL, domain and any known stage dates. It uses the same tracking rules but is visible only to that user, excluded from catalog search and alerts, and edited by hand. If that edition later appears in the catalog, offer an explicit link that preserves the user's history and counts it once; a URL match alone never merges records.

## Conflicts and email

Check active stage commitments as soon as both applications are marked submitted. Include known downstream stages labeled **If you advance**. Intersecting exact attendance times give a **confirmed schedule overlap** even for pending applications; show acceptance uncertainty separately. Compare times in a common zone; touching endpoints don't overlap. Overlapping date ranges without exact hours, or an online window without required attendance times, give a **possible overlap**. With missing dates, say the conflict can't be checked. A submission deadline alone isn't an attendance commitment.

Keep two independent email opt-ins, both off by default. **New opportunities** is a digest of newly published open matches against saved filters and verified eligibility. **My event reminders** sends one reminder per accepted stage, unless the user marks it **Won't attend**. Default to 24 hours before an exact start or the previous local day for a date-only start, with the time labeled as unpublished. With no reliable start date, show an in-app notice and leave the email unscheduled. Recompute conflicts on a verified date change, replace any pending reminder for the old schedule, and show the change in My Hackathons. If a reminder already went out, send one correction to opted-in users who still plan to attend or are undecided. Marking **Won't attend** cancels pending emails and removes that stage from active conflicts while keeping its history. Recheck consent, schedule, and attendance intent at send time.

## Private progress and a worked example

Count an edition once after the first submitted application or confirmed entry via invitation or direct admission. Saves alone don't count. Keep separate counts for editions accepted and attended, and for stage attendances and results. Show totals by one primary domain per edition (or **Uncategorized**); secondary topics remain filters. Use the same rules for private external entries. All progress stays private, with no leaderboard.

Imagine a user submits applications for a climate-tech regional qualifier and a game development hackathon. The qualifier is on a different weekend, but its published national final shares a date with the game event. Before acceptance, My Hackathons shows two pending applications and **Possible overlap if you advance**; no event reminder is scheduled.

The user is accepted to the qualifier, attends, and advances into a confirmed final slot. The organizer publishes a final time of 10:00–15:00, overlapping the other event's 11:00–16:00 in the same zone. The warning becomes **Confirmed overlap**. When the other organizer also accepts them, the user marks that event **Won't attend**. With event reminders enabled, they receive the upcoming final reminder 24 hours before it starts and none for the game event. After they attend the final, progress shows **two edition entries, two editions ever accepted, one edition attended, two stage attendances, and one advancement**. Climate tech has one entry, two attendances, and one advancement; game development has one entry, no attendance, and the decision not to attend. There is no win unless the user records one.

## Source coverage and the next coding task

Phase 1 proved a local draft pipeline: six manual references and four feed-backed records with manual review. UCA RSS refreshes identity, title, and article link; its post date and headline are not evidence of event dates or current registration. Hack Club refreshes identity, title, site, online format, and program dates; it does not verify Moroccan eligibility, deadlines, or stages. Manual intake still covers organizers without a usable feed. The six automated tests pass, including replay of all ten records and retention on source failure. Phase 1's archive preview checks elapsed dates; the proposed public archive also includes verified closures before the event ends.

Keep source observations separate from approved facts, with evidence URLs and distinct fetch and review timestamps. Changes to verified dates, links, eligibility, or stage relationships go to review. On failures or missing rows, retain records, retry failed fetches with backoff, and flag stale sources, missing IDs, and disagreements. Label missing or stale evidence and suppress unsupported open or eligible recommendations. A published cutoff still takes effect during an outage.

Build in this order: **(1)** catalog data and review boundary, **(2)** daily Worker and monitoring, **(3)** read-only public catalog and archive, **(4)** private accounts, tracking, conflicts and progress, **(5)** opt-in email delivery. Before publishing, the only decision needed from the owner is who will review and approve listings and handle flagged changes; that does not block local work.

**Next coding task:** build the catalog data and review boundary in local D1 development. Map the ten fixtures to stable competition, edition, and event-window records; persist source observations and approved facts separately; queue unknown candidates and changes to verified fields; expose a local read for open and archived drafts. Completion means the fixtures replay twice with stable IDs, failed or missing feeds preserve records, conflicting updates require review, and a verified closure appears in the archive even before the event ends. Keep the existing importer usable. Leave scheduling, cloud provisioning, deployment, public UI, accounts, and email for later tasks.
