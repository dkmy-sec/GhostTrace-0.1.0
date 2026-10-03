"""Bounded, sanitized browser observations in a local SQLite file."""
from __future__ import annotations
import csv
import io
import ipaddress
import json
import sqlite3
import threading
import time
from pathlib import Path
from .intel import host

IDENTIFIERS = {"_ga", "_gl", "gclid", "dclid", "fbclid", "msclkid", "ttclid", "mc_eid"}
STATES = {"response", "redirect", "failed", "client-blocked", "cached", "attempt"}


class Store:
    def __init__(self, path: Path, intel, max_events: int = 100000):
        self.intel, self.max_events = intel, max_events
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS events(
            id TEXT PRIMARY KEY, ts REAL, site TEXT, domain TEXT, ip TEXT,
            type TEXT, method TEXT, state TEXT, status INTEGER, tab INTEGER,
            evidence TEXT, attribution TEXT, geo TEXT)""")
        self.db.execute("CREATE INDEX IF NOT EXISTS events_ts ON events(ts)")
        self.db.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)")
        self.db.execute("DELETE FROM events WHERE ts < ?", ((time.time() - 7 * 86400) * 1000,))
        self.db.commit()

    def setting(self, key: str, default=None):
        with self.lock:
            row = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            return json.loads(row[0]) if row else default

    def set_setting(self, key, value):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (key, json.dumps(value)))
            self.db.commit()

    def sanitize(self, raw: dict):
        domain, site = host(raw.get("domain")), host(raw.get("site"))
        if not domain or not site:
            raise ValueError("Each event needs valid site and destination domains")
        raw_e = raw.get("evidence", {})
        if not isinstance(raw_e, dict):
            raw_e = {}
        evidence = {"cookie_sent": bool(raw_e.get("cookie_sent")), "cookie_set": bool(raw_e.get("cookie_set")),
                    "identifier_params": sorted({p for p in raw_e.get("identifier_params", []) if isinstance(p, str) and p in IDENTIFIERS}),
                    "rule_index": raw_e.get("rule_index") if isinstance(raw_e.get("rule_index"), int) else None,
                    "rule_exception": bool(raw_e.get("rule_exception"))}
        address = ""
        try:
            address = str(ipaddress.ip_address(raw.get("ip", "")))
        except (ValueError, TypeError):
            pass
        ts = float(raw.get("ts", time.time() * 1000))
        if not (0 < ts < 1e14):
            raise ValueError("Invalid timestamp")
        state = raw.get("state", "attempt")
        if state not in STATES:
            state = "attempt"
        # Cache hits are observations, not fresh network contact.
        if state == "cached":
            address = ""
        event_id = raw.get("id", "")
        if not isinstance(event_id, str) or not re_identifier(event_id):
            raise ValueError("Invalid event identifier")
        status = raw.get("status", 0)
        if not isinstance(status, int) or not 0 <= status <= 599:
            status = 0
        return (event_id, ts, site, domain, address,
                safe_word(raw.get("type", "other")), safe_word(raw.get("method", "GET")),
                state, status, int(raw.get("tab", -1)), json.dumps(evidence),
                json.dumps(self.intel.classify(domain, site, evidence)), json.dumps(self.intel.geo(address)))

    def ingest(self, raws):
        if not isinstance(raws, list) or len(raws) > 500:
            raise ValueError("Send at most 500 events per batch")
        records = [self.sanitize(raw) for raw in raws if isinstance(raw, dict)]
        if len(records) != len(raws):
            raise ValueError("Invalid event")
        with self.lock:
            before = self.db.total_changes
            self.db.executemany("INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", records)
            inserted = self.db.total_changes - before
            self.db.execute("DELETE FROM events WHERE ts < ?", ((time.time() - 7 * 86400) * 1000,))
            # Keep the newest max_events records even when a tab is very noisy.
            self.db.execute("DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY ts DESC LIMIT -1 OFFSET ?)", (self.max_events,))
            self.db.commit()
            return inserted

    def events(self, hours=1, limit=10000, site="", search=""):
        hours = min(168, max(1 / 60, float(hours)))
        query, args = "SELECT * FROM events WHERE ts>=?", [(time.time() - hours * 3600) * 1000]
        if site:
            query += " AND site=?"
            args.append(host(site))
        if search:
            query += " AND (domain LIKE ? OR site LIKE ? OR ip LIKE ?)"
            args.extend(["%" + search[:253] + "%"] * 3)
        query += " ORDER BY ts DESC LIMIT ?"
        args.append(min(20000, max(1, int(limit))))
        with self.lock:
            rows = self.db.execute(query, args).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            for key in ["evidence", "attribution", "geo"]:
                item[key] = json.loads(item[key])
            result.append(item)
        return result

    def dashboard(self, hours=1, site="", search="", mode="all"):
        all_events = self.events(hours, 20000, site, search)
        events = all_events
        if mode != "all":
            events = [e for e in events if mode in e["attribution"]["flags"]]
        nodes, edges, sites, countries = {}, {}, {}, {}
        for event in events:
            site, domain = event["site"], event["domain"]
            sites[site] = sites.get(site, 0) + 1
            code = event["geo"]["country_code"]
            if code and event["ip"]:
                countries[code] = countries.get(code, 0) + 1
            if domain not in nodes:
                nodes[domain] = {"domain": domain, "count": 0, "sites": set(), "ips": set(),
                                 "flags": set(), "attribution": event["attribution"], "geo": event["geo"],
                                 "last_seen": event["ts"], "states": {}, "events": []}
            n = nodes[domain]
            n["count"] += 1
            n["sites"].add(site)
            n["flags"].update(event["attribution"]["flags"])
            if event["ip"]:
                n["ips"].add(event["ip"])
                if n["geo"]["lat"] is None:
                    n["geo"] = event["geo"]
            n["states"][event["state"]] = n["states"].get(event["state"], 0) + 1
            if len(n["events"]) < 25:
                n["events"].append(event)
            key = (site, domain)
            edges[key] = edges.get(key, 0) + 1
        for node in nodes.values():
            for key in ["sites", "ips", "flags"]:
                node[key] = sorted(node[key])
        # Per-IP country grouping preserves multi-IP/multi-country destinations.
        map_points = {}
        for event in events:
            if not event["ip"] or event["geo"]["lat"] is None:
                continue
            key = (event["domain"], event["ip"])
            if key not in map_points:
                map_points[key] = {"domain": event["domain"], "ip": event["ip"], "geo": event["geo"], "flags": event["attribution"]["flags"], "count": 0}
            map_points[key]["count"] += 1
        return {"stats": {"requests": len(events), "destinations": len(nodes),
                           "trackers": sum("tracker" in n["flags"] for n in nodes.values()),
                           "brokers": sum("broker" in n["flags"] for n in nodes.values()),
                           "countries": len(countries), "sites": len(sites),
                           "unmapped": sum(not e["ip"] or e["geo"]["lat"] is None for e in events)},
                "nodes": sorted(nodes.values(), key=lambda n: -n["count"]),
                "edges": [{"site": k[0], "domain": k[1], "count": v} for k, v in edges.items()],
                "sites": sorted(sites), "timeline": events[:150], "map_points": list(map_points.values()),
                "window_capped": len(all_events) == 20000}

    def clear(self):
        with self.lock:
            self.db.execute("DELETE FROM events")
            self.db.commit()

    def export_csv(self, hours=168):
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(["timestamp_ms", "site", "domain", "ip", "request_type", "state", "owner", "labels", "country", "asn"])
        for e in self.events(hours, 20000):
            row = [e["ts"], e["site"], e["domain"], e["ip"], e["type"], e["state"], e["attribution"]["owner"], ";".join(e["attribution"]["flags"]), e["geo"]["country"], e["geo"]["asn"] or ""]
            writer.writerow(["'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@")) else v for v in row])
        return output.getvalue().encode("utf-8-sig")


def safe_word(value):
    import re
    return re.sub(r"[^a-zA-Z0-9_-]", "", str(value))[:40]


def re_identifier(value):
    import re
    return bool(re.fullmatch(r"[a-zA-Z0-9_.:-]{1,160}", value))
