# Third-party data and code

## DuckDuckGo Tracker Radar / Tracker Blocking dataset

Copyright Duck Duck Go, Inc. Data used from https://staticcdn.duckduckgo.com/trackerblocking/v2.1/tds.json and the documented Tracker Radar ecosystem at https://github.com/duckduckgo/tracker-radar.

Data license: **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International**: https://creativecommons.org/licenses/by-nc-sa/4.0/. GhostTrace's `extension/tracker-rules.js` is a reduced derivative of that dataset and retains the same data license. Source dataset: `data/tracker-radar.json`. Changes: retained request patterns/actions/exceptions and alias mappings for offline classification. The complete source retains ownership/category information.

Dataset matches are attribution/classification signals. They do not establish a data sale, wrongdoing, or execution of fingerprinting during a particular session.

## California Data Broker Registry

Publisher: California Privacy Protection Agency. Source: https://cppa.ca.gov/data_broker_registry/registry.csv and https://cppa.ca.gov/data_broker_registry/. 2026 registry, reflecting registration disclosures about prior-year operations; page marked updated July 29, 2026 at bundle creation.

Bundled factual extract keeps company names, submitted DBA names, and primary websites. Public contact details and the other disclosure fields were removed. Affiliation labels are separate from the behavior observed in a request. This is not an endorsement by the agency.

## DB-IP Lite country and ASN databases

Publisher: DB-IP.com. **Creative Commons Attribution 4.0 International**: https://creativecommons.org/licenses/by/4.0/. Source: https://db-ip.com/db/lite.php. October 2026 release at bundle creation.

The dashboard includes the required **IP Geolocation by DB-IP** link to https://db-ip.com. Databases are reduced-coverage/accuracy estimates. No address lookup API service is exposed publicly by GhostTrace.

## Natural Earth

Country boundaries and country label coordinates: Natural Earth 1:110m Admin 0 Countries, https://www.naturalearthdata.com/; downloaded from the project's https://github.com/nvkelso/natural-earth-vector repository.

Natural Earth data is **public domain**. Changes: stripped unrelated metadata; retained shapes, country codes, names, and label coordinates. Country labels are used to arrange display markers, not estimate precise server positions. Boundary depiction does not express a political position.

## Public Suffix List

Source: https://publicsuffix.org/list/public_suffix_list.dat. License: **Mozilla Public License 2.0**, https://mozilla.org/MPL/2.0/. The source data file retains its license header. Used to distinguish registrable sites, including multi-label suffixes and private suffixes.

## maxminddb Python reader 3.1.0

Copyright MaxMind, Inc. https://github.com/maxmind/MaxMind-DB-Reader-python. **Apache License 2.0**; complete license is included in `vendor/MAXMINDDB_LICENSE`.

Unmodified pure Python module and package metadata are vendored. C extensions are not bundled. The API uses `MODE_MMAP` for platform-independent local file lookup.
