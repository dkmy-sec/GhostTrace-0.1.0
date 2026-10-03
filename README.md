# GhostTrace 0.1.0

A local browser visibility tool: a live connection graph, an offline world map, and inspectable tracker and data broker affiliation labels.

## Start on Windows

1. Extract the ZIP completely. Do not run it from inside the ZIP viewer.
2. Install **Python 3.10 or newer** if needed: https://www.python.org/downloads/windows/. Enable the Python launcher or add Python to PATH.
3. Double-click **start_ghosttrace.bat**. The dashboard opens at **http://127.0.0.1:8765**. Leave that terminal window open.
4. In Chrome, open **chrome://extensions**. In Edge, use **edge://extensions**. Enable **Developer mode**, click **Load unpacked**, and select this package's **extension** folder.
5. Click **Pair extension** in the dashboard and copy its key. Open GhostTrace's browser toolbar popup, paste the key, and click **Save & connect**. Pin its toolbar icon if you like.
6. Browse a few pages. Both views update automatically. Click a graph node, map marker, or destination row to inspect its evidence.

**No pip installation, administrator access, interception certificate, or cloud account is required.** The included database reader runs in pure Python. The extension is for Chrome/Edge; Firefox is not included in this release.

On Linux/macOS, run `python3 run.py`. The extension uses the same installation steps in Chromium-based browsers.

## What you can do

- Switch between **both views**, **connection graph**, and **world map**.
- Filter by visited site, domain/IP, time window, tracker match, broker affiliation, identifier signal, or listed DNS alias.
- Drag graph nodes, pan the background, zoom with the wheel, and reset with the fit control. Clicking a visited page filters to that page.
- Inspect the destination owner, observed IPs, network operator/ASN, introducing pages, response/cache/failure states, and the source behind each label.
- Pause/resume recording in the dashboard, or disable collection and exclude sites in the extension popup.
- Export up to the newest 20,000 observations from the last seven days as CSV. Export currently covers all recorded sites, not only the active on-screen filter.
- Clear collector observations. If the extension has an offline queue, use **Discard queue** in its popup too.
- Use **Explore demo** to preview simulated activity. Demo records never enter the collector database.

## What the labels mean

| Label | Evidence | What it does not establish |
|---|---|---|
| Known tracker | Tracker Radar domain default or a matching resource rule, with its resource exceptions | Everything collected, consent status, or a data sale |
| Broker affiliation | Registry website match, or conservative exact normalized company-name match against Tracker Radar ownership | That this particular request sold information |
| Fingerprinting association | A matched tracker's historical Radar fingerprinting score exceeds 1 | Fingerprinting execution during this session |
| Identifier signal | Presence of a recognized advertising identifier parameter, such as `gclid` or `fbclid` | The identifier's value, who it identifies, or intent |
| Listed DNS alias | The bundled tracker dataset associates this hostname with an alias | A current live DNS verification |
| Unclassified | No current rule or evidence match | That the destination is safe or never collects information |

Cookies are shown as **header presence only**. A cookie alone is not treated as proof of tracking. Resource-specific exceptions help avoid classifying an entire mixed-purpose service as a tracker. These lists originate in blocking systems; their matches and exceptions are imperfect evidence for a visibility tool.

IP network operators are separate from domain ownership. A Cloudflare, AWS, Google, or other hosting IP does not automatically make every customer on that IP a tracker or a data broker. Ownership and broker matching are domain/company based. Acquisitions, affiliates, missing websites, changed DNS aliases, and names can leave gaps.

## Map precision

The bundled **DB-IP Country Lite** database identifies approximate destination countries; the ASN database identifies the IP's network operator. No external geolocation service or map tile server is contacted. The world map uses bundled Natural Earth shapes.

Map markers are arranged near country label coordinates to keep multiple endpoints visible. **They are display markers, not physical server pins or packet routes.** Domains can use multiple IPs/countries, shared hosting, CDNs, VPNs, and proxies. Country estimates can be missing or wrong. Failed/blocked requests and disk cache hits often have no fresh response IP; they remain visible in the graph but may not appear on the map.

## Data handling

- Collector binds only to **127.0.0.1**. API access requires a pairing key; unexpected Host/Origin values are rejected.
- Metadata: visited-site and destination hostnames, timestamp, observed response IP, request type/method, tab ID, result state, HTTP status, cookie-header booleans, recognized identifier **names**, and tracker rule numbers.
- Full URL paths, query values, usernames in URLs, fragments, page titles, request/response bodies, credentials, cookie values, and authorization headers are not persisted by GhostTrace.
- Resource patterns are evaluated inside the extension before the URL is discarded. The collector gets a rule number, not the resource URL. Headers are inspected transiently for cookie presence; their values are discarded.
- Browser private/incognito windows are excluded. Exclude sensitive sites in the popup to skip their browsing metadata entirely. Exclusions apply to the top-level site's hostname and its subdomains.
- Local observations expire after seven days, with a 100,000-record cap. The dashboard/export operates on at most 20,000 records per window; graph renders the top 60 destinations and up to 14 visited-page nodes.
- An offline extension queue is bounded to 2,500 sanitized observations. Its popup reports queue size and overflow. Disabling capture or changing the pairing key discards the queue. A paused collector discards submitted batches; the extension learns pause state during its next heartbeat.
- The application sends no telemetry. The extension talks only to the loopback collector. **update_intelligence.bat** explicitly downloads public datasets from their publishers; no browsing records are included. Clicking a source/attribution link opens that external website normally.
- Collector records live in **local-data/ghosttrace.sqlite3**; the pairing secret lives in **local-data/pairing-key.txt**. These are created on first launch and are not part of the ZIP. Local pairing protects against other websites, not a compromised local account.

## Coverage limits

This release observes browser requests, not every Windows application. It cannot reveal server-to-server forwarding, offline purchases of your personal information, a broker's existing profile of you, or what every encrypted payload contains. Browser-internal requests, permissions, memory caches, web workers, and API lifecycle gaps can reduce visibility. WebSocket/WebTransport coverage is limited to the browser API's exposed handshake events, not their ongoing messages. Failed requests do not prove the destination received data.

## Update the bundled datasets

Close the collector, run **update_intelligence.bat**, restart the collector, then **Reload** GhostTrace on the browser's extensions page. The on-demand updater refreshes Tracker Radar, the California registry, the Public Suffix List, and DB-IP country/ASN data. It tries recent monthly releases when the newest release is not yet available. It does not touch browsing records. If one download fails, that dataset's existing file remains; earlier successful datasets may already have updated.

The original bundle includes **1,028 tracker domains**, **603 California registry entries**, and **October 2026 DB-IP country/ASN databases**. Registry contents were marked updated July 29, 2026. See **data/SNAPSHOT.json** for sources and file hashes.

## Troubleshooting

| Symptom | Action |
|---|---|
| Python is missing | Install Python 3.10+ and enable its launcher/PATH, then reopen the BAT file |
| Waiting for extension | Check the collector terminal; open the popup and save the correct pairing key/port |
| Pairing rejected | Copy the current key from the dashboard. A moved/deleted `local-data` folder can generate a new key |
| Blank graph | Browse new pages after pairing; check time/site filters, capture toggle, exclusions, and pause state |
| Graph has entries but map is empty | The requests may be cached/blocked/failed/local or lack a mapped response IP |
| Port 8765 is in use | Close the other collector, or run `python run.py --port 8766` and set port 8766 in the popup |
| Grey/different company label | A dataset classification or ownership match is missing; inspect evidence rather than inferring from the IP provider |

## Development and validation

Python standard library server/SQLite plus vendored `maxminddb` 3.1.0. Vanilla HTML/CSS/JavaScript and a Manifest V3 extension; no frontend build or remote dependencies.

Run backend/privacy checks from this directory:

```bash
python -m unittest discover -s tests -v
```

Optional JavaScript classification checks, if Node is installed:

```bash
node tests/test_rules.cjs
```

Sources and licensing are in **THIRD_PARTY_NOTICES.md**. GhostTrace code is MIT licensed; bundled third-party datasets retain their respective licenses, including Tracker Radar's noncommercial/share-alike terms.

## Publish on GitHub

Use this folder as the repository root. The included `.gitignore` keeps private `local-data/`, pairing keys, browsing exports, and common local development files out of new commits. Keep the public `data/` and `vendor/` folders and the license notices so a fresh checkout works. See **[PUBLISHING.md](PUBLISHING.md)** for publishing steps, local-data cleanup, and handling files that were already tracked.
