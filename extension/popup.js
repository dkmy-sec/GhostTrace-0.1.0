const $ = id => document.getElementById(id);
function show(data, populate=false) {
  if (data.settings && populate) {
    $('key').value = data.settings.key; $('port').value = data.settings.port;
    $('enabled').checked = data.settings.enabled; $('excluded').value = data.settings.excluded.join(', ');
  }
  $('status').textContent = data.connected ? data.paused ? 'Collector connected · recording paused' : 'Collector connected · recording ready' : 'Collector offline or not paired';
  $('message').textContent = (data.error || '') + (data.queue ? ` · ${data.queue} queued` : '') + (data.dropped ? ` · ${data.dropped} older observations dropped` : '');
}
chrome.runtime.sendMessage({action:'status'}).then(x => show(x,true));
$('form').addEventListener('submit', async event => {
  event.preventDefault();
  $('message').textContent='Connecting…';
  show(await chrome.runtime.sendMessage({action:'save',settings:{key:$('key').value,port:$('port').value,enabled:$('enabled').checked,excluded:$('excluded').value}}));
});
$('dashboard').addEventListener('click',()=>chrome.tabs.create({url:'http://127.0.0.1:'+Number($('port').value || 8765)}));
$('discard').addEventListener('click',async()=>show(await chrome.runtime.sendMessage({action:'discard'})));
