"""Offline enrichment. Never resolve or send an observed domain to a third party."""
from __future__ import annotations

import csv
import ipaddress
import json
import re
import sys
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "vendor"))


def host(value: object) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        return ""
    value = value.strip()
    try:
        parsed = urlsplit(value if "://" in value else "//" + value)
        name = (parsed.hostname or "").rstrip(".").lower()
        if not name:
            return ""
        try:
            return str(ipaddress.ip_address(name))
        except ValueError:
            name = name.encode("idna").decode("ascii")
            if len(name) > 253 or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", s) for s in name.split(".")):
                return ""
            return name
    except (ValueError, UnicodeError):
        return ""


def legal_name(value: str) -> str:
    words = re.sub(r"[^a-z0-9 ]", " ", value.lower()).split()
    while words and words[-1] in {"inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company"}:
        words.pop()
    return " ".join(words)


class Intel:
    def __init__(self, root: Path = ROOT):
        self.root = root
        self.radar = json.loads((root / "data/tracker-radar.json").read_text(encoding="utf-8"))
        self.trackers = self.radar["trackers"]
        self.cnames = self.radar.get("cnames", {})
        self.suffixes, self.exceptions, self.wildcards = set(), set(), set()
        for line in (root / "data/public_suffix_list.dat").read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            try:
                line = line.encode("idna").decode("ascii")
            except UnicodeError:
                continue
            if line.startswith("!"):
                self.exceptions.add(line[1:])
            elif line.startswith("*."):
                self.wildcards.add(line[2:])
            else:
                self.suffixes.add(line)
        self.broker_domains, self.broker_names = {}, {}
        registry = root / "data/broker-registry.csv"
        with registry.open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.broker_count = len(rows)
        for row in rows:
            name = row.get("Data broker name:", "").strip()
            website = row.get("Data broker primary website:", "").strip()
            info = {"name": name, "website": website,
                    "source": "2026 California Data Broker Registry",
                    "source_url": "https://cppa.ca.gov/data_broker_registry/",
                    "evidence": "Registry affiliation; not proof this request sold data"}
            domain = host(website)
            if domain:
                self.broker_domains[self.site(domain)] = info
            if name:
                self.broker_names[legal_name(name)] = info
            for alias in re.split(r"[;\n]", row.get("Doing Business As (DBA), if applicable:", "")):
                if alias.strip():
                    self.broker_names[legal_name(alias)] = info
        self.locations = json.loads((root / "data/country-centers.json").read_text())
        self.readers = {}
        try:
            import maxminddb
            for kind in ["country", "asn", "city"]:
                path = root / f"data/dbip-{kind}-lite.mmdb"
                if path.exists():
                    self.readers[kind] = maxminddb.open_database(str(path), mode=maxminddb.MODE_MMAP)
        except ImportError:
            pass

    @lru_cache(maxsize=20000)
    def site(self, domain: str) -> str:
        try:
            ipaddress.ip_address(domain)
            return domain
        except ValueError:
            pass
        labels = domain.split(".")
        count = 1
        for i in range(len(labels)):
            tail = ".".join(labels[i:])
            if tail in self.exceptions:
                count = len(labels) - i - 1
                break
            if tail in self.suffixes:
                count = max(count, len(labels) - i)
            if i > 0 and tail in self.wildcards:
                count = max(count, len(labels) - i + 1)
        return ".".join(labels[-min(len(labels), count + 1):])

    def tracker(self, domain: str):
        labels = domain.split(".")
        for i in range(len(labels)):
            entry = self.trackers.get(".".join(labels[i:]))
            if entry:
                return entry
        return None

    def classify(self, domain: str, site: str, evidence: dict) -> dict:
        entry = self.tracker(domain)
        alias = self.cnames.get(domain)
        if isinstance(alias, str) and not entry:
            entry = self.tracker(alias)
        elif isinstance(alias, dict):
            alias = alias.get("domain", "")
        owner_data = (entry or {}).get("owner", {})
        owner = owner_data.get("displayName") or owner_data.get("name") or "Unidentified owner"
        broker = self.broker_domains.get(self.site(domain))
        if not broker:
            # Conservative exact legal-name match only. No fuzzy matching or CDN/IP attribution.
            for name in [owner_data.get("name", ""), owner_data.get("ownedBy", "")]:
                if name and legal_name(name) in self.broker_names:
                    broker = self.broker_names[legal_name(name)]
                    break
        flags, reasons = [], []
        tracker_match = bool(entry and entry.get("default") == "block")
        rule = evidence.get("rule_index")
        if entry and isinstance(rule, int) and 0 <= rule < len(entry.get("rules", [])):
            matched_rule = entry["rules"][rule]
            # Browser evaluates URL transiently. Only the rule number crosses the bridge.
            tracker_match = matched_rule.get("action", "block") != "ignore"
            if evidence.get("rule_exception"):
                tracker_match = False
            if tracker_match:
                reasons.append({"kind": "Tracker resource rule", "detail": f"Rule {rule + 1} for {entry['domain']}; URL discarded", "source": "DuckDuckGo Tracker Radar", "url": "https://github.com/duckduckgo/tracker-radar"})
        if tracker_match:
            flags.append("tracker")
            if not reasons:
                reasons.append({"kind": "Known tracker domain", "detail": entry["domain"], "source": "DuckDuckGo Tracker Radar", "url": "https://github.com/duckduckgo/tracker-radar"})
        if broker:
            flags.append("broker")
            reasons.append({"kind": "Broker affiliation", "detail": broker["name"] + ": " + broker["evidence"], "source": broker["source"], "url": broker["source_url"]})
            if owner == "Unidentified owner":
                owner = broker["name"]
        # Radar's fingerprinting score describes historical crawl observations, not this session.
        if tracker_match and entry.get("fingerprinting", 0) > 1:
            flags.append("fingerprinting")
            reasons.append({"kind": "Fingerprinting association", "detail": "Radar has recorded fingerprinting behavior; not a live execution test", "source": "DuckDuckGo Tracker Radar", "url": "https://github.com/duckduckgo/tracker-radar"})
        if alias:
            flags.append("alias")
            reasons.append({"kind": "Listed DNS alias", "detail": str(alias) + "; dataset snapshot, not a current DNS lookup", "source": "DuckDuckGo Tracker Radar", "url": "https://github.com/duckduckgo/tracker-radar"})
        third_party = self.site(domain) != self.site(site)
        if third_party and (evidence.get("cookie_sent") or evidence.get("cookie_set")):
            reasons.append({"kind": "Cookie header observed", "detail": "Third-party request/response included a cookie header; values were discarded. This alone does not prove tracking.", "source": "Browser observation", "url": ""})
        params = evidence.get("identifier_params", [])
        if params:
            reasons.append({"kind": "Identifier parameter", "detail": ", ".join(params) + "; parameter names only, no values", "source": "Browser observation", "url": ""})
            if "tracker" not in flags:
                flags.append("suspected")
        return {"owner": owner, "categories": (entry or {}).get("categories", []),
                "flags": flags, "third_party": third_party, "broker": broker,
                "reasons": reasons, "tracker_domain": (entry or {}).get("domain", "")}

    @lru_cache(maxsize=20000)
    def geo(self, address: str) -> dict:
        empty = {"country_code": "", "country": "Unmapped", "lat": None, "lon": None,
                 "precision": "unknown", "asn": None, "network": ""}
        try:
            ip = ipaddress.ip_address(address)
            if not ip.is_global:
                return {**empty, "country": "Local / reserved address"}
        except ValueError:
            return empty
        result = dict(empty)
        reader = self.readers.get("city") or self.readers.get("country")
        if reader:
            found = reader.get(str(ip)) or {}
            country = found.get("country", {})
            code = country.get("iso_code", "")
            point = self.locations.get(code, {})
            result.update(country_code=code, country=country.get("names", {}).get("en", code) or "Unmapped",
                          lat=point.get("lat"), lon=point.get("lon"), precision="country" if point else "unknown")
            if found.get("location", {}).get("latitude") is not None:
                loc = found["location"]
                result.update(lat=loc["latitude"], lon=loc["longitude"], precision="approximate city",
                              city=found.get("city", {}).get("names", {}).get("en", ""), accuracy_radius=loc.get("accuracy_radius"))
        if self.readers.get("asn"):
            network = self.readers["asn"].get(str(ip)) or {}
            result.update(asn=network.get("autonomous_system_number"), network=network.get("autonomous_system_organization", ""))
        return result
