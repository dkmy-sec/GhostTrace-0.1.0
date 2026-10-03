/* Evaluate resource patterns transiently; never persist URLs or query values. */
(function (scope) {
  const compiled = new Map();
  const parameters = new Set(['_ga', '_gl', 'gclid', 'dclid', 'fbclid', 'msclkid', 'ttclid', 'mc_eid']);
  function normalize(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; }
  }
  function suffix(domain, ending) { return domain === ending || domain.endsWith('.' + ending); }
  function entryFor(domain, data) {
    const parts = domain.split('.');
    for (let i = 0; i < parts.length; i++) {
      const entry = data.trackers[parts.slice(i).join('.')];
      if (entry) return entry;
    }
    return null;
  }
  function inspect(url, site, type, data) {
    const domain = normalize(url);
    let entry = entryFor(domain, data);
    if (!entry && typeof data.cnames[domain] === 'string') entry = entryFor(data.cnames[domain], data);
    const result = {rule_index: null, rule_exception: false, identifier_params: []};
    try { result.identifier_params = [...new URL(url).searchParams.keys()].filter(x => parameters.has(x)); } catch {}
    if (!entry) return result;
    for (let i = 0; i < (entry.rules || []).length; i++) {
      const rule = entry.rules[i];
      let regex = compiled.get(rule.rule);
      if (regex === undefined) {
        try { regex = new RegExp(rule.rule); } catch { regex = null; }
        compiled.set(rule.rule, regex);
      }
      if (!regex || !regex.test(url)) continue;
      result.rule_index = i;
      const exceptions = rule.exceptions || {};
      result.rule_exception = (exceptions.domains || []).some(x => suffix(site, x)) || (exceptions.types || []).includes(type);
      break;
    }
    return result;
  }
  scope.GhostTraceClassifier = {normalize, inspect, entryFor};
  if (typeof module !== 'undefined') module.exports = scope.GhostTraceClassifier;
})(typeof self !== 'undefined' ? self : globalThis);
