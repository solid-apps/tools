// tools.js: find or create a person's tool index.
//
// A tool index is a private document in a pod that lists the panes and apps its owner wants
// (https://pod-os.org/vocab/tools). The preferences file links to it:
//
//   <WebID> tools:toolIndex <settings/toolIndex.jsonld> .
//
// Nothing here logs in or draws anything: the page gives a WebID, a fetch that carries the
// login, and rdflib for reading. Creating writes two things and nothing else: the new index
// file, and one link added to the preferences file, whose other contents are kept as they are.

export const TOOLS = 'https://pod-os.org/vocab/tools#'
const PREFERENCES_FILE = 'http://www.w3.org/ns/pim/space#preferencesFile'
const DASHBOARD = 'https://solidos.org/docs/browser/?pane=' + encodeURIComponent('https://solid-panes.github.io/tool-index/tool-index-pane.js') + '&uri='

const isJsonLd = (url) => /\.jsonld$/i.test(new URL(url).pathname)
const mediaType = (url) => isJsonLd(url) ? 'application/ld+json' : 'text/turtle'

class Problem extends Error {}
const problem = (text) => new Problem(text)

async function get (fetch, url, accept) {
  let response
  try { response = await fetch(url, { headers: { Accept: accept }, cache: 'no-store' }) } catch { throw problem('Could not reach ' + url) }
  return response
}

// Read a document into an rdflib store. Returns { store, missing }.
async function read ({ fetch, rdf }, url) {
  const response = await get(fetch, url, 'text/turtle, application/ld+json;q=0.9')
  if (response.status === 404) return { store: rdf.graph(), missing: true }
  if (!response.ok) throw problem(url + ' answered ' + response.status + (response.status === 401 || response.status === 403 ? ' (are you logged in as its owner?)' : ''))
  const type = (response.headers.get('content-type') || 'text/turtle').split(';')[0].trim()
  const text = await response.text()
  const store = rdf.graph()
  await new Promise((resolve, reject) => {
    try { rdf.parse(text, store, url, type, (error) => error ? reject(error) : resolve()) } catch (error) { reject(error) }
  }).catch(() => { throw problem('Could not understand ' + url) })
  return { store, missing: false }
}

// Where things stand for this person: { preferences, index, proposed }.
// `preferences` is '' if the profile names none; `index` is '' if there is no tool index yet;
// `proposed` is where a new one would go.
export async function lookUp ({ webId, fetch, rdf }) {
  const me = rdf.sym(webId)
  const profile = await read({ fetch, rdf }, me.doc().value)
  if (profile.missing) throw problem('Your profile could not be found at ' + me.doc().value)
  const preferencesNode = profile.store.any(me, rdf.sym(PREFERENCES_FILE))
  if (!preferencesNode) return { preferences: '', index: '', proposed: '' }
  const preferences = preferencesNode.value
  const prefs = await read({ fetch, rdf }, preferences)
  if (prefs.missing) throw problem('Your profile points to a preferences file that does not exist: ' + preferences)
  const link = prefs.store.statementsMatching(null, rdf.sym(TOOLS + 'toolIndex'), null)[0]
  const proposed = new URL(isJsonLd(preferences) ? 'toolIndex.jsonld' : 'toolIndex.ttl', preferences).href
  return { preferences, index: link ? link.object.value : '', proposed }
}

// The two writes, in words, for showing before anything is done.
export function plan ({ webId, preferences, proposed }) {
  return [
    { what: 'A new file', where: proposed, detail: 'An empty tool index. It is in your settings folder, so it is private to you.' },
    { what: 'One line added', where: preferences, detail: 'A link from your WebID to the new file. Nothing else in this file is changed.' }
  ]
}

function indexBody (url) {
  return isJsonLd(url)
    ? JSON.stringify({ '@context': { tools: TOOLS }, '@id': url, '@type': 'tools:ToolIndex' }, null, 2) + '\n'
    : '@prefix tools: <' + TOOLS + '> .\n\n<> a tools:ToolIndex .\n'
}

// The preferences file with the one link added, as text in the file's own format.
function withLink (text, url, webId, index) {
  if (!isJsonLd(url)) return text.replace(/\s*$/, '\n') + '\n<' + webId + '> <' + TOOLS + 'toolIndex> <' + index + '> .\n'
  const node = { '@id': webId, [TOOLS + 'toolIndex']: { '@id': index } }
  const doc = JSON.parse(text)
  if (Array.isArray(doc)) return JSON.stringify([...doc, node], null, 2) + '\n'
  if (Array.isArray(doc['@graph'])) return JSON.stringify({ ...doc, '@graph': [...doc['@graph'], node] }, null, 2) + '\n'
  const { '@context': context, ...rest } = doc
  return JSON.stringify({ ...(context ? { '@context': context } : {}), '@graph': [rest, node] }, null, 2) + '\n'
}

// Create the index and link to it. Returns { index, created, linked }.
// Stops with a Problem, having changed as little as possible, if anything is not as expected.
export async function create ({ webId, fetch, rdf }) {
  const before = await lookUp({ webId, fetch, rdf })
  if (!before.preferences) throw problem('Your profile does not name a preferences file, so there is nowhere to put the link.')
  if (before.index) return { index: before.index, created: false, linked: false }
  const index = before.proposed

  // 1. The index file, only if nothing is there.
  const existing = await get(fetch, index, mediaType(index))
  let created = false
  if (existing.status === 404) {
    const put = await fetch(index, { method: 'PUT', headers: { 'Content-Type': mediaType(index), 'If-None-Match': '*' }, body: indexBody(index) })
    if (!put.ok) throw problem('The new file could not be written (' + put.status + '). Nothing was changed.')
    created = true
  } else if (!existing.ok) {
    throw problem(index + ' answered ' + existing.status + '. Nothing was changed.')
  }

  // 2. The link, added to the preferences file as it stands now.
  const current = await get(fetch, before.preferences, mediaType(before.preferences))
  if (!current.ok) throw problem('Your preferences file could not be read (' + current.status + '). The new file is at ' + index + ' but is not linked yet.')
  let text
  try { text = withLink(await current.text(), before.preferences, webId, index) } catch { throw problem('Your preferences file is not in a form this app can add to. The new file is at ' + index + ' but is not linked yet.') }
  const headers = { 'Content-Type': mediaType(before.preferences) }
  const etag = current.headers.get('etag')
  if (etag) headers['If-Match'] = etag
  const saved = await fetch(before.preferences, { method: 'PUT', headers, body: text })
  if (!saved.ok) throw problem('The link could not be saved (' + saved.status + '). The new file is at ' + index + ' but is not linked yet.')

  // 3. Read it back.
  const after = await lookUp({ webId, fetch, rdf })
  if (after.index !== index) throw problem('The link was saved but could not be read back. Please check ' + before.preferences)
  return { index, created, linked: true }
}

// The dashboard for an index, in the SolidOS Browser.
export const dashboard = (index) => DASHBOARD + encodeURIComponent(index)
