# Validation of GhostTrace 0.1.0

Checked in the available Linux/Python/Node environment:

- **10 backend tests passed**: persistent-field sanitization, exact broker affiliation, shared-IP attribution separation, public suffix boundaries, offline IPv4/IPv6 country and ASN lookup, cache handling, deduplication, record cap/retention, identifier labels, API authentication/Host/Origin boundaries, capture/pause/clear, malformed requests, and static-file traversal.
- **JavaScript classifier checks passed**: transient URL handling, mixed-purpose service exclusions, resource rules, identifier value removal, and resource exceptions.
- **Actual extension worker code passed a simulated Chrome API lifecycle test**: capture event ordering, cookie-header booleans, no retained cookie/query/path values, offline queue persistence across worker restarts, bridge delivery, redirect identities, site exclusions, cached/blocked results, private-window exclusion, pause, and capture disable.
- **Dashboard interaction checks passed in a DOM simulation connected to the real local API**: initialization, pairing instructions, demo totals, world-map shape and marker construction, broker filtering, evidence drawer, search, site filtering, view switching, and guide dialog. No JavaScript errors occurred in that check.
- Python and JavaScript syntax checks passed.

**Limits of this validation:** live Chrome/Edge extension capture, actual Windows launcher execution, and visual screenshot/mobile layout review could not be completed here. The cloud browser rejects localhost, and the downloadable test browser was blocked by the environment's network restrictions. Simulated lifecycle and DOM checks do not substitute for a live browser capture or pixel-level visual check.

The standalone demo makes the interface reviewable before installation. All runtime records and pairing credentials are excluded from the release ZIP.
