import NDK, { NDKRelaySet, NDKRelay, NDKEvent } from "@nostrband/ndk";
import { nip19 } from "@nostrband/nostr-tools";
import { decode as bolt11Decode } from "light-bolt11-decoder";
import { walletstore } from "./walletstore";

const KIND_META = 0;
const KIND_NOTE = 1;
const KIND_CONTACT_LIST = 3;
const KIND_COMMUNITY_APPROVAL = 4550;
const KIND_ZAP = 9735;
const KIND_HIGHLIGHT = 9802;
const KIND_BOOKMARKS = 30001;
const KIND_LONG_NOTE = 30023;
const KIND_APP = 31990;
const KIND_LIVE_EVENT = 30311;
const KIND_COMMUNITY = 34550;
const KIND_NWC_PAYMENT_REQUEST = 23194;
const KIND_NWC_PAYMENT_REPLY = 23195;

// we only care about web apps
const PLATFORMS = ["web"];

const ADDR_TYPES = ['', 'npub', 'note', 'nevent', 'nprofile', 'naddr'];

export const nostrbandRelay = "wss://relay.nostr.band/";
export const nostrbandRelayAll = "wss://relay.nostr.band/all";

const readRelays = [
  nostrbandRelay,
  //  "wss://relay.damus.io", // too slow
  "wss://eden.nostr.land",
  "wss://nos.lol",
  "wss://relay.nostr.bg",
  "wss://nostr.mom",
];
const writeRelays = [...readRelays, "wss://nostr.mutinywallet.com"]; // for broadcasting
export const allRelays = [nostrbandRelayAll, ...writeRelays];

// global ndk instance for now
let ndk = null;

const kindAppsCache = {};
const metaCache = {};
const eventCache = {};
const addrCache = {};

function fetchEventsRead(ndk, filter) {
  return new Promise(async (ok) => {
    const events = await ndk.fetchEvents(filter, {}, NDKRelaySet.fromRelayUrls(readRelays, ndk));
    for (const e of events.values()) {
      let addr = e.id;
      if (e.kind === KIND_META
	  || e.kind === KIND_CONTACT_LIST
	  || (e.kind >= 10000 && e.kind < 20000)
	  || (e.kind >= 10000 && e.kind < 20000)
      ) {
	addr = e.kind + ":" + e.pubkey + ":" + getTagValue(e, 'd');
      }

      eventCache[e.id] = e;
      addrCache[addr] = e;
    }
    ok(events);
  });
}

export function getTags(e, name) {
  return e.tags.filter((t) => t.length > 0 && t[0] === name);
}

export function getTag(e, name) {
  const tags = getTags(e, name);
  if (tags.length === 0) return null;
  return tags[0];
}

export function getTagValue(e, name, index, def) {
  const tag = getTag(e, name);
  if (tag === null || !tag.length || (index && index >= tag.length))
    return def !== undefined ? def : '';
  return tag[1 + (index || 0)];
}

export function getEventTagA(e) {
  let addr = e.kind + ':' + e.pubkey + ':';
  if (e.kind >= 30000 && e.kind < 40000) addr += getTagValue(e, 'd');
  return addr;
}

function parseContentJson(c) {
  try {
    return JSON.parse(c);
  } catch (e) {
    console.log("Bad json: ", c, e);
    return {};
  }
}

function isWeb(e) {
  for (const t of e.tags) {
    if (t[0] === "web")
      return true;

    if (t[0] === "android"
	|| t[0] === "ios"
	|| t[0] === "windows"
	|| t[0] === "macos"
	|| t[0] === "linux"
    )
      return false;
  }

  return true;
}

function findHandlerUrl(e, k) {
  for (const t of e.tags) {
    if (t[0] !== "web" || t.length < 3) continue;

    if (k === KIND_META && (t[2] === "npub" || t[2] === "nprofile")) {
      return [t[1], t[2]];
    }

    if (k >= 30000 && k < 40000 && t[2] === "naddr") {
      return [t[1], t[2]];
    }

    return [t[1], t[2]];
  }

  return null;
}

const sortAsc = (arr) => arr.sort((a, b) => a.order - b.order);
const sortDesc = (arr) => arr.sort((a, b) => b.order - a.order);

export async function fetchApps() {
  // try to fetch best apps list from our relay
  const top = await ndk.fetchTop(
    {
      kinds: [KIND_APP],
      limit: 50,
    },
    // note: send to this separate endpoint bcs this req might be slow
    NDKRelaySet.fromRelayUrls([nostrbandRelayAll], ndk)
  );
  console.log("top apps", top?.ids.length);

  let events = null;
  if (top.ids.length) {
    // fetch the app events themselves from the list
    events = await fetchEventsRead(
      ndk,
      {
        ids: top.ids,
      }
    );
  } else {
    console.log("top apps empty, fetching new ones");
    // load non-best apps from other relays just to avoid
    // completely breaking the UX due to our relay being down
    events = await fetchEventsRead(
      ndk,
      {
        kinds: [KIND_APP],
        limit: 50,
      }
    );
  }
  events = [...events.values()];
  console.log("top app events", events.length);

  // load authors of the apps, we need them both for the app
  // info and for apps that inherit the author's profile info
  let profiles = await fetchEventsRead(
    ndk,
    {
      authors: events.map((e) => e.pubkey),
      kinds: [KIND_META],
    }
  );
  profiles = [...profiles.values()];

  // assign order to the apps, sort by top or by published date
  if (top)
    top.ids.forEach((id, i) => {
      const e = events.find((e) => e.id == id);
      if (e) e.order = top.ids.length - i;
    });
  else events.forEach((e, i) => (e.order = Number(getTagValue(e, "published_at"))));

  // sort events by order desc
  sortDesc(events);

  // convert to a convenient app object
  const apps = [];
  events.forEach((e) => {
    // app author
    const author = profiles.find((p) => p.pubkey == e.pubkey);

    // app profile - it's own, or inherited from the author
    const profile = e.content ? parseContentJson(e.content) : parseContentJson(author ? author.content : "");

    // app's handled kinds and per-kind handler urls for the 'web' platform,
    // we don't add a kind that doesn't have a proper handler
    const kinds = [];
    const handlers = {};
    e.tags.forEach((t) => {
      let k = 0;
      if (t.length < 2 || t[0] != "k") return;

      try {
        k = parseInt(t[1]);
      } catch (e) {
        return;
      }

      const url_type = findHandlerUrl(e, k);
      if (!url_type) return;

      kinds.push(k);
      handlers[k] = {
        url: url_type[0],
        type: url_type[1],
      };
    });

    if (!isWeb(e))
      return;
    
    //    if (Object.keys(handlers).length == 0)
    //      return;
    
    const app = {
      naddr: nip19.naddrEncode({
        pubkey: e.pubkey,
        kind: e.kind,
        identifier: getTagValue(e, "d"),
      }),
      name: profile ? profile.display_name || profile.name : "<Noname app>",
      url: (profile && profile.website) || "",
      picture: (profile && profile.picture) || "",
      about: (profile && profile.about) || "",
      kinds,
      handlers,
    };

    if (app.name && app.url)
      apps.push(app);
  });

  return apps;
}

export function parseAddr(id) {
  let addr = {
    kind: undefined,
    pubkey: undefined,
    event_id: undefined,
    d_tag: undefined,
    relays: undefined,
    hex: false,
  };

  try {
    const { type, data } = nip19.decode(id);

    switch (type) {
      case 'npub':
        addr.kind = 0;
        addr.pubkey = data;
        break;
      case 'nprofile':
        addr.kind = 0;
        addr.pubkey = data.pubkey;
        addr.relays = data.relays;
        break;
      case 'note':
        addr.event_id = data;
        break;
      case 'nevent':
        addr.event_id = data.id;
        addr.relays = data.relays;
        addr.pubkey = data.author;
        // FIXME add support for kind to nevent to nostr-tool
        break;
      case 'naddr':
        addr.d_tag = data.identifier || '';
        addr.kind = data.kind;
        addr.pubkey = data.pubkey;
        addr.relays = data.relays;
        break;
      default:
        throw 'bad id';
    }
  } catch (e) {
    if (id.length === 64) {
      addr.event_id = id;
      addr.hex = true;
    } else {
      console.error('Failed to parse addr', e);
      return null;
    }
  }

  return addr;
};

function dedupEvents(events) {
  const map = {};
  for (const e of events) {
    let addr = e.id;
    if (
      e.kind === 0 ||
      e.kind === 3 ||
      (e.kind >= 10000 && e.kind < 20000) ||
      (e.kind >= 30000 && e.kind < 40000)
    ) {
      addr = getEventTagA(e);
    }
    if (!(addr in map) || map[addr].created_at < e.created_at) {
      map[addr] = e;
    }
  }
  return Object.values(map);
}

async function collectEvents(reqs) {
  const results = await Promise.allSettled(Array.isArray(reqs) ? reqs : [reqs]);
  let events = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value !== null) {
        if (typeof r.value[Symbol.iterator] === 'function')
          events.push(...r.value);
        else events.push(r.value);
      }
    }
  }
  return dedupEvents(events);
}

async function fetchEventByAddr(ndk, addr) {

  let id = "";
  const filter = {};
  if (addr.event_id) {
    // note, nevent
    filter.ids = [addr.event_id];
    id = addr.event_id;
  } else if (
    addr.pubkey &&
    addr.d_tag !== undefined &&
    addr.kind !== undefined
  ) {
    // naddr
    filter['#d'] = [addr.d_tag];
    filter.authors = [addr.pubkey];
    filter.kinds = [addr.kind];
    id = addr.kind + ":" + addr.pubkey + ":" + addr.d_tag;
  } else if (addr.pubkey && addr.kind !== undefined) {
    // npub, nprofile
    filter.authors = [addr.pubkey];
    filter.kinds = [addr.kind];
    id = addr.kind + ":" + addr.pubkey + ":";
  }

  if (id in addrCache) {
    console.log("event in addr cache", id);
    return addrCache[id];
  }

  console.log("loading event by filter", JSON.stringify(filter));
  
  const reqs = [fetchEventsRead(ndk, filter)];
  if (addr.hex) {
    const profileFilter = {
      kinds: [0],
      authors: [addr.event_id],
    };
    // console.log("loading profile by filter", profile_filter);
    reqs.push(fetchEventsRead(ndk, profileFilter));
  }

  const events = await collectEvents(reqs);
  const event = events.length > 0 ? events[0] : null;
  if (event)
    addrCache[id] = event;
  return event;
}

function prepareHandlers(events, filterKinds, metaPubkey) {
  const info = {
    meta: null,
    apps: {},
  };

  const metas = {};
  for (const e of events) {
    if (e.kind === KIND_META) {
      metas[e.pubkey] = e;

      e.profile = parseContentJson(e.content);

      if (metaPubkey && metaPubkey === e.pubkey) info.meta = e;
    }
  }

  for (const e of events) {
    if (e.kind !== KIND_APP)
      continue;

    // set naddr
    e.naddr = nip19.naddrEncode({
      pubkey: e.pubkey,
      kind: e.kind,
      identifier: getTagValue(e, "d"),
    });

    // init handler profile, inherit from pubkey meta if needed
    e.inheritedProfile = !e.content;
    e.meta = e.pubkey in metas ? metas[e.pubkey] : null;
    if (e.inheritedProfile) e.profile = e.meta?.profile || {};
    else e.profile = parseContentJson(e.content);

    // parse handler kinds
    const kinds = new Set();
    for (const t of getTags(e, 'k')) {
      if (t.length < 2)
	continue;
      const k = Number(t[1]);
      if (k < 0 || k > 10000000 || isNaN(k))
	continue;
      kinds.add(k);
    }
    e.kinds = [...kinds];

    // drop handlers that don't handle our kinds
    if (filterKinds && filterKinds.length)
      e.kinds = e.kinds.filter(k => filterKinds.includes(k));
    if (!e.kinds.length)
      continue;

    // parse platforms and urls
    const ps = {};
    e.urls = [];
    for (const p of PLATFORMS) {

      // urls for platform p
      const urls = getTags(e, p);
      for (const url of urls) {
        if (url.length < 2)
	  continue;

        const type = url.length > 2 ? url[2] : '';

	// default or one of known types?
        if (type != "" && !ADDR_TYPES.find(t => t === type))
	  continue;

        ps[p] = 1;
        e.urls.push({
          url: url[1],
          type,
        });
      }
    }
    e.platforms = Object.keys(ps);
    
    // dedup by app name
    e.app_id = getTagValue(e, 'd');
    if (e.content !== '')
      e.app_id = e.profile.name || e.profile.display_name || '';

    // init 
    if (!(e.app_id in info.apps)) {
      info.apps[e.app_id] = {
        app_id: e.app_id,
        handlers: [],
        kinds: [],
        platforms: [],
      };
    }

    // add app handler
    const app = info.apps[e.app_id];
    app.handlers.push(e);
    app.kinds.push(...e.kinds);
    app.platforms.push(...e.platforms);
  }

  return info;
}

async function fetchAppsByKinds(ndk, kinds) {

  // fetch apps ('handlers')
  const filter = {
    kinds: [KIND_APP],
    limit: 50,
  };
  if (kinds && kinds.length > 0) filter['#k'] = kinds.map((k) => '' + k);

//  let events = await collectEvents(fetchEventsRead(ndk, filter));
//  console.log('events', events);

  const top = await ndk.fetchTop(filter, NDKRelaySet.fromRelayUrls([nostrbandRelayAll], ndk))
  console.log("top kind apps", top?.ids.length);

  let events = null;
  if (top.ids.length) {
    // fetch the app events themselves from the list
    events = await collectEvents(fetchEventsRead(ndk, { ids: top.ids }));
  } else {
    console.log("top apps empty, fetching new ones");
    // load non-best apps from other relays just to avoid
    // completely breaking the UX due to our relay being down
    events = await collectEvents(fetchEventsRead(ndk, filter));
  }
//  console.log('events', events);

  if (top)
    top.ids.forEach((id, i) => {
      const e = events.find((e) => e.id == id);
      if (e) e.order = top.ids.length - i;
    });
  else events.forEach((e, i) => (e.order = Number(getTagValue(e, "published_at"))));
  
  // fetch app profiles
  const pubkeys = {};
  for (const e of events) pubkeys[e.pubkey] = 1;

  // we need profiles in case app info inherits content
  // from it's profile
  if (events.length > 0) {
    const metas = await collectEvents(
      fetchEventsRead(ndk, {
        kinds: [KIND_META],
        authors: Object.keys(pubkeys),
      }),
    );
//    console.log('metas', metas);

    events = [...events, ...metas];
  }

  // parse
  const info = prepareHandlers(events, kinds);
  return info;
}

function getUrl(app, ad) {

  const findUrlType = (type) => {
    return app.urls.find((u) => u.type === type);
  };

  const allUrl = findUrlType('');

  const findUrl = (id) => {
    const { type } = nip19.decode(id);
    const u = findUrlType(type) || allUrl;
    if (u != null) return u.url.replace('<bech32>', id);
    return null;
  };

  const naddrId = {
    identifier: ad.d_tag || '',
    pubkey: ad.pubkey,
    kind: ad.kind,
    relays: ad.relays,
  };
  const neventId = {
    // FIXME add kind!
    id: ad.event_id,
    relays: ad.relays,
    author: ad.pubkey,
  };

  let url = '';
  if (ad.kind === 0) {
    if (!url && ad.pubkey)
      url = findUrl(nip19.npubEncode(ad.pubkey))
	 || findUrl(nip19.nprofileEncode({ pubkey: ad.pubkey, relays: ad.relays }))
      // || findUrl(nip19.naddrEncode(naddrId))
    ;
    if (!url && ad.event_id)
      url = findUrl(nip19.neventEncode(neventId)) 
	 || findUrl(nip19.noteEncode(ad.event_id))
    ;
  } else if (
    ad.kind === 3 ||
    (ad.kind >= 10000 && ad.kind < 20000)
  ) {
    // specific order - naddr preferred
    url =
      // FIXME naddr?
      findUrl(nip19.neventEncode(neventId)) ||
      findUrl(nip19.noteEncode(ad.event_id));
  } else if (
    (ad.kind >= 30000 && ad.kind < 40000)
  ) {
    // specific order - naddr preferred
    url =
      findUrl(nip19.naddrEncode(naddrId));
    if (!url && ad.event_id)
      url = findUrl(nip19.neventEncode(neventId))
	 || findUrl(nip19.noteEncode(ad.event_id))
    ;
  } else {
    // specific order - naddr preferred
    url =
      findUrl(nip19.neventEncode(neventId)) ||
      findUrl(nip19.noteEncode(ad.event_id));
  }

  return url;
};

export async function fetchAppsForEvent(id, event) {
  const addr = parseAddr(id);
  if (!addr)
    throw new Error("Bad address");

  // if event content is known take kind from there
  if (event && addr.kind === undefined)
    addr.kind = event.kind;

  // if kind unknown need to fetch event from network 
  if (addr.kind === undefined) {
    if (!event)
      event = await fetchEventByAddr(ndk, addr);

    if (!event)
      throw new Error("Failed to fetch target event");
    
    addr.kind = event.kind;
    addr.event_id = event.id;
    addr.pubkey = event.pubkey;
    if (event.kind >= 30000 && event.kind < 40000) {
      addr.d_tag = getTagValue(event, 'd');
    }    
  }
  console.log('resolved addr', addr);
  
  // now fetch the apps for event kind
  let info = null;
  if (addr.kind in kindAppsCache) {
    info = kindAppsCache[addr.kind];
    console.log("apps for kind", addr.kind, "in cache", info);
  }
  if (!info)
    info = await fetchAppsByKinds(ndk, [addr.kind]);
  info.addr = addr;

  // put to cache
  if (Object.keys(info.apps).length > 0)
    kindAppsCache[addr.kind] = info;
  
  // init convenient url property for each handler
  // to redirect to this event
  for (const id in info.apps) {
    const app = info.apps[id];
    for (const h of app.handlers) {
      h.eventUrl = getUrl(h, addr);
    }
  }
    
  return info;
}

export async function fetchEventByBech32(b32) {
  const addr = parseAddr(b32);
  console.log("b32", b32, "addr", JSON.stringify(addr));
  if (!addr)
    throw new Error("Bad address");

  return await fetchEventByAddr(ndk, addr);
}

export async function searchProfiles(q) {
  // try to fetch best profiles from our relay
  const top = await ndk.fetchTop(
    {
      kinds: [KIND_META],
      search: q,
      limit: 30,
    },
    NDKRelaySet.fromRelayUrls([nostrbandRelayAll], ndk)
  );
  console.log("top profiles", top?.ids.length);

  let events = [];
  if (top.ids.length) {
    // fetch the app events themselves from the list
    events = await fetchEventsRead(
      ndk,
      {
        ids: top.ids,
      }
    );

    events = [...events.values()].map(e => rawEvent(e));  
  }

  events.forEach(e => {
    e.profile = parseProfileJson(e);
    e.order = top.ids.findIndex(i => e.id === i);
  });

  sortAsc(events);

  return events;
}

function rawEvent(e) {
  return {
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    kind: e.kind,
    tags: e.tags,
    content: e.content,
    identifier: getTagValue(e, 'd'),
    order: e.created_at
  };
}

async function fetchMetas(pubkeys) {
  
  let metas = [];
  let reqPubkeys = [];
  pubkeys.forEach(p => {
    if (p in metaCache)
      metas.push(metaCache[p]);
    else
      reqPubkeys.push(p);
  });  

  if (reqPubkeys.length > 0) {
    let events = await fetchEventsRead(ndk, {
      kinds: [KIND_META],
      authors: reqPubkeys,
    });

    // drop ndk stuff
    events = [...events.values()].map(e => rawEvent(e));

    // parse profiles
    events.forEach(e => {
      e.profile = parseProfileJson(e);
    });

    // put to cache
    events.forEach(e => metaCache[e.pubkey] = e);
    
    // merge with cached results
    metas = [...metas, ...events];
  }

  console.log("meta cache", Object.keys(metaCache).length);
  return metas;
}

async function augmentEventAuthors(events) {

  if (events.length > 0) {
    // profile infos
    const metas = await fetchMetas(events.map(e => e.pubkey));

    // assign to notes
    events.forEach(e => e.author = metas.find(m => m.pubkey === e.pubkey));
  }

  return events;
}

async function fetchEventsByIds({ ids, kinds, authors }) {

  let results = [];
  let reqIds = [];
  ids.forEach(id => {
    if (id in eventCache) {
      // make sure kinds match
      if (kinds.includes(eventCache[id].kind))
	results.push(eventCache[id]);
    } else {
      reqIds.push(id);
    }
  });  
  
  if (reqIds.length > 0) {
    let events = await ndk.fetchEvents(
      {
	ids: reqIds,
	kinds,
      },
      {}, // opts
      NDKRelaySet.fromRelayUrls([nostrbandRelay], ndk)
    );
    console.log("ids", ids, "reqIds", reqIds, "kinds", kinds, "events", events);

    events = [...events.values()].map(e => rawEvent(e));

    events.forEach(e => eventCache[e.id] = e);

    results = [...results, ...events];

    console.log("event cache", Object.keys(eventCache).length);
  }
  
  if (authors)
    results = await augmentEventAuthors(results);

  // desc by tm
  sortDesc(results);
  
  console.log("events by ids prepared", results);
  return results;
}

async function augmentLongNotes(events) {
  events.forEach((e) => {
    e.title = getTagValue(e, 'title');
    e.summary = getTagValue(e, 'summary');
    e.published_at = Number(getTagValue(e, 'published_at'));
  });
  return events;
}

async function augmentZaps(events, minZap) {

  events.forEach((e) => {
    e.description = parseContentJson(getTagValue(e, "description"));
    try {
      e.bolt11 = bolt11Decode(getTagValue(e, "bolt11"));      
    } catch {
      e.bolt11 = {};
    };
    e.amountMsat = Number(e.bolt11?.sections?.find(s => s.name === 'amount').value);
    e.targetEventId = getTagValue(e, 'e');
    e.targetAddr = getTagValue(e, 'a');
    e.targetPubkey = getTagValue(e, 'p');
    e.providerPubkey = e.pubkey;
    e.senderPubkey = e.description?.pubkey;
  });

  // drop zaps w/o a target event
  events = events.filter(e => !!e.targetEventId);
  
  if (minZap) {
    events = events.filter(e => e.amountMsat / 1000 >= minZap);
  }

  if (events.length > 0) {
    // target event infos
    const ids = events.map(e => e.targetEventId).filter(id => !!id);
    let targets = await fetchEventsByIds({
      ids,
      kinds: [KIND_NOTE, KIND_LONG_NOTE, KIND_COMMUNITY, KIND_LIVE_EVENT, KIND_APP],
      authors: false
    });

    // profile infos
    const pubkeys = new Set();
    events.forEach(e => {
      pubkeys.add(e.providerPubkey);
      if (e.targetPubkey)
	pubkeys.add(e.targetPubkey);
      if (e.senderPubkey)
	pubkeys.add(e.senderPubkey);
    });
    console.log("zap meta pubkeys", pubkeys);
    const metas = await fetchMetas([...pubkeys.values()]);
    
    // assign to zaps
    events.forEach(e => {
      e.targetEvent = targets.find(t => t.id === e.targetEventId);
      e.targetMeta = metas.find(m => m.pubkey === e.targetPubkey);
      e.providerMeta = metas.find(m => m.pubkey === e.providerPubkey);
      e.senderMeta = metas.find(m => m.pubkey === e.senderPubkey);
    });
  }

  // desc 
  sortDesc(events);
  
  return events;
}

async function augmentCommunities(events, addrs) {

  const pubkeys = new Set();
  events.forEach((e) => {
    e.name = e.identifier;
    e.description = getTagValue(e, 'description');
    e.image = getTagValue(e, 'image');
    e.moderators = getTags(e, 'p')
      .filter(p => p.length >= 4 && p[3] === 'moderator')
      .map(p => p[1]);

    if (addrs) {
      const apprs = addrs.filter(a => a.pubkey === e.pubkey && a.identifier === e.identifier);
      e.last_post_tm = apprs[0].tm;
      e.order = apprs[0].tm;
      e.posts = apprs.length;
    }

    pubkeys.add(e.pubkey);
    e.moderators.forEach(m => pubkeys.add(m));
  });

  console.log("communities meta pubkeys", pubkeys);
  const metas = await fetchMetas([...pubkeys.values()]);
    
  // assign to events
  events.forEach(e => {
    e.author = metas.find(m => m.pubkey === e.pubkey);
    e.moderatorsMetas = metas.filter(m => e.moderators.includes(m.pubkey));
  });  
  
  // desc
  sortDesc(events);
  
  return events;
}

async function searchEvents({ q, kind, limit = 30, authors = false }) {
  let events = await ndk.fetchEvents(
    {
      kinds: [kind],
      search: q,
      limit,
    },
    {}, // opts
    NDKRelaySet.fromRelayUrls([nostrbandRelay], ndk)
  );
  events = [...events.values()].map(e => rawEvent(e));  
  if (authors)
    events = await augmentEventAuthors(events);

  // desc by tm
  sortDesc(events);

  if (events.length > limit)
    events.length = limit;
  
  console.log("search events prepared", events);

  return events;
}

export async function searchNotes(q, limit = 30) {
  return searchEvents({
    q,
    kind: KIND_NOTE,
    limit,
    authors: true,
  });
}

export async function searchLongNotes(q, limit = 30) {
  let events = await searchEvents({
    q,
    kind: KIND_LONG_NOTE,
    limit,
    authors: true,
  });
  events = await augmentLongNotes(events);
  return events;
}

export async function searchLiveEvents(q, limit = 30) {
  let events = await searchEvents({
    q,
    kind: KIND_LIVE_EVENT,
    limit,
  });
  events = await augmentLiveEvents({ events, limit, ended: true });
  return events;
}

export async function searchCommunities(q, limit = 30) {
  let events = await searchEvents({
    q,
    kind: KIND_COMMUNITY,
    limit
  });
  events = await augmentCommunities(events);
  console.log("search comms", events);
  return events;
}

// used for handling a sequence of events and an eose after them,
// since each event-handling callback might be async we have to execute
// them one by one through a queue to ensure eose marker comes last
class PromiseQueue {

  queue = [];
  
  constructor() {
  }

  appender(cb) {
    return (...args) => {
      this.queue.push([cb, [...args]]);
      if (this.queue.length === 1)
	this.execute();
    }
  }

  async execute() {
    // the next cb in the queue
    const [cb, args] = this.queue[0];

    // execute the next cb
    await cb(...args);

    // mark the last cb as done
    this.queue.shift();

    // have the next one? proceed
    if (this.queue.length > 0)
      this.execute();
  }
};

async function fetchPubkeyEvents(
  { kind, pubkeys, tagged = false, authors = false, limit = 30, identifiers = null }) {

  const pks = [...pubkeys];
  if (pks.length > 200)
    pks.length = 200;

  const filter = {
    kinds: [kind],
    limit,
  };

  if (tagged)
    filter['#p'] = pks;
  else
    filter.authors = pks;

  if (identifiers)
    filter['#d'] = identifiers;
  
  let events = await fetchEventsRead(ndk, filter);
  events = [...events.values()].map(e => rawEvent(e));  
  if (authors)
    events = await augmentEventAuthors(events);

  // desc by tm
  sortDesc(events);

  if (events.length > limit)
    events.length = limit;
  
  return events;
}

export async function fetchFollowedLongNotes(contactPubkeys) {
  let events = await fetchPubkeyEvents({
    kind: KIND_LONG_NOTE,
    pubkeys: contactPubkeys,
    authors: true
  });
  events = await augmentLongNotes(events);
  return events;
}

export async function fetchFollowedHighlights(contactPubkeys) {
  let events = await fetchPubkeyEvents({
    kind: KIND_HIGHLIGHT,
    pubkeys: contactPubkeys,
    authors: true
  });
  return events;
}

export async function fetchFollowedZaps(contactPubkeys, minZap) {
  let events = await fetchPubkeyEvents({
    kind: KIND_ZAP,
    pubkeys: contactPubkeys,
    tagged: true,
    limit: 200,
  });
  events = await augmentZaps(events, minZap);
  return events;
}

export async function fetchFollowedCommunities(contactPubkeys) {
  const approvals = await fetchPubkeyEvents({
    kind: KIND_COMMUNITY_APPROVAL,
    pubkeys: contactPubkeys,
    limit: 100
  });

  // desc
  sortDesc(approvals);
//  console.log("approvals", approvals);  

  const addrs = approvals.map(e => { return { tm: e.created_at, p: getTagValue(e, 'a').split(':') } } )
    .filter(a => a.p.length == 3 && Number(a.p[0]) === KIND_COMMUNITY)
    .map(a => { return { tm: a.tm, pubkey: a.p[1], identifier: a.p[2] } });
//  console.log("addrs", addrs);

  let events = await fetchPubkeyEvents({
    kind: KIND_COMMUNITY,
    pubkeys: [... new Set(addrs.map(a => a.pubkey))],
    identifiers: [... new Set(addrs.map(a => a.identifier))],
    authors: true,
  });
  
  events = await augmentCommunities(events, addrs);
  console.log("communities", events);
  return events;
}

async function augmentLiveEvents({ events, contactPubkeys, limit, ended = false }) {

  // convert to an array of raw events

  const MAX_LIVE_TTL = 3600;
  events.forEach(e => {
    e.title = getTagValue(e, 'title');
    e.summary = getTagValue(e, 'summary');
    e.starts = Number(getTagValue(e, 'starts'));
    e.current_participants = Number(getTagValue(e, 'current_participants'));
    e.status = getTagValue(e, 'status');

    // NIP-53: Clients MAY choose to consider status=live events
    // after 1hr without any update as ended.
    if ((Date.now() / 1000 - e.created_at) > MAX_LIVE_TTL)
      e.status = 'ended';

    const ps = getTags(e, 'p');
    e.host = ps.find(p => p.length >= 4 && (p[3] === 'host' || p[3] === 'Host'))?.[1];
    e.members = ps
      .filter(p => p.length >= 4 && (!contactPubkeys || contactPubkeys.includes(p[1])))
      .map(p => p[1]);

    // newest-first
    e.order = e.starts;

    // reverse order of all non-live events and make
    // them go after live ones
    if (e.status !== 'live')
      e.order = -e.order; 
  });

  // drop ended ones
  events = events.filter(e => {
    return !!e.host
    // For now let's show live events where some of our following are participating
    //	&& contactPubkeys.includes(e.host)
	&& (ended || e.status !== 'ended');
  });

  if (events.length > 0) {
    // profile infos
    const metas = await fetchMetas(events.map(e => [e.pubkey, ...e.members]).flat());
    
    // assign to live events
    events.forEach(e => {
      e.author = metas.find(m => m.pubkey === e.pubkey); // provider
      e.hostMeta = e.host ? metas.find(m => m.pubkey === e.host) : null; // host
      e.membersMeta = metas.filter(m => e.members.includes(m.pubkey)); // all members: host, speakers, participants
    });
  }

  // desc 
  sortDesc(events);
  
  // crop
  if (events.length > limit)
    events.length = limit;

  return events;
}

export async function fetchFollowedLiveEvents(contactPubkeys, limit = 30) {

  let events = await fetchPubkeyEvents({
    kind: KIND_LIVE_EVENT,
    pubkeys: contactPubkeys,
    tagged: true
  });

  events = await augmentLiveEvents({events, contactPubkeys, limit});
  
  return events;
}

class Subscription {

  lastSub = null;
  
  constructor(label, onEvent) {
    this.label = label;
    this.onEvent = onEvent;
  }

  async restart(filter, cb) {

    // gc
    if (this.lastSub) {
      this.lastSub.stop();
      this.lastSub = null;
    }

    const events = new Map();
    let eose = false;
    
    const sub = await ndk.subscribe(
      filter, { closeOnEose: false },
      NDKRelaySet.fromRelayUrls(readRelays, ndk),
      /* autoStart */ false
    );

    // ensure async callbacks are executed one by one
    const pq = new PromiseQueue();
    
    // helper to transform and return the event
    const returnEvent = async (event) => {
      const e = await this.onEvent(rawEvent(event));
      console.log("returning", this.label, e);
      await cb(e);
    };

    // call cb on each event
    sub.on("event", (event) => {

      // dedup
      const dedupKey = event.deduplicationKey();
      const existingEvent = events.get(dedupKey);
      // console.log("dedupKey", dedupKey, "existingEvent", existingEvent?.created_at, "event", event.created_at);
      if (existingEvent?.created_at > event.created_at) {
	// ignore old event
	return;
      }
      events.set(dedupKey, event);

      // add to promise queue
      pq.appender(async (event) => {
	console.log("got new", this.label, "event", event, "from", event.relay.url);

	// we've reached the end and this is still the newest event?
	if (eose && events.get(dedupKey) == event)
	  await returnEvent(event);

      }) (event);
    });

    // notify that initial fetch is over
    sub.on("eose", pq.appender((sub, reason) => {
      console.log("eose was", eose, this.label, "events", events.size, "reason", reason, "at", Date.now());
      if (eose)
	return; // WTF second one?
      
      eose = true;
      [...events.values()].forEach(async (e) => { await returnEvent(e) });
    }));

    // start
    console.log("start", this.label, "at", Date.now());
    sub.start();

    // store
    this.lastSub = sub;
  }
}

const parseProfileJson = (e) => {
  const profile = parseContentJson(e.content);
  profile.pubkey = e.pubkey;
  profile.npub = nip19.npubEncode(e.pubkey);
  return profile;
}

const profileSub = new Subscription("profile", (p) => {
  p.profile = parseProfileJson(p);
  return p;
});

export async function subscribeProfiles(pubkeys, cb) {
  profileSub.restart({
    authors: [...pubkeys],
    kinds: [KIND_META],
  }, cb);
}

const contactListSub = new Subscription("contact list", async (contactList) => {

  contactList.contactPubkeys = [...new Set(
    contactList.tags
	       .filter(t => t.length >= 2 && t[0] === 'p')
	       .map(t => t[1])
  )];
  contactList.contactEvents = [];

  if (contactList.contactPubkeys.length) {

    // profiles
    contactList.contactEvents = await fetchMetas(contactList.contactPubkeys);

    // assign order
    contactList.contactEvents.forEach(p => {
      p.order = contactList.contactPubkeys.findIndex(pk => pk == p.pubkey);
    });

    // order by recently-added-first
    sortDesc(contactList.contactEvents);
  }
  
  return contactList;
});

export async function subscribeContactList(pubkey, cb) {
  contactListSub.restart({
    authors: [pubkey],
    kinds: [KIND_CONTACT_LIST],
  }, cb);
}

const bookmarkListSub = new Subscription("bookmark list", async (bookmarkList) => {

  bookmarkList.bookmarkEventIds = [...new Set(
    bookmarkList.tags
		.filter(t => t.length >= 2 && t[0] === 'e')
		.map(t => t[1])
  )];
  bookmarkList.bookmarkEvents = [];

  if (bookmarkList.bookmarkEventIds.length) {
    bookmarkList.bookmarkEvents = await fetchEventsByIds({
      ids: bookmarkList.bookmarkEventIds,
      kinds: [KIND_NOTE, KIND_LONG_NOTE],
      authors: true
    });
    
    bookmarkList.bookmarkEvents.forEach(e => {
      e.order = bookmarkList.bookmarkEventIds.findIndex(id => id == e.id);
    });

    sortDesc(bookmarkList.bookmarkEvents);
  }
  
  return bookmarkList;
});

export async function subscribeBookmarkList(pubkey, cb) {
  bookmarkListSub.restart({
    authors: [pubkey],
    kinds: [KIND_BOOKMARKS],
  }, cb);
}

export function stringToBech32(s, hex = false) {

  const BECH32_REGEX =
    /[a-z]{1,83}1[023456789acdefghjklmnpqrstuvwxyz]{6,}/g;
    
  const array = [...s.matchAll(BECH32_REGEX)].map(a => a[0]);

  let bech32 = "";
  for (let b32 of array) {
    try {
      const { type, data } = nip19.decode(b32);
      //      console.log("b32", b32, "type", type, "data", data);
      switch (type) {
        case "npub":
        case "nprofile":
        case "note":
        case "nevent":
        case "naddr":
          bech32 = b32;
          break;
      }
    } catch (e) {
      console.log("bad b32", b32, "e", e);
    }

    if (bech32)
      return bech32;
  }

  if (hex) {
    if (s.length == 64 && s.match(/0-9A-Fa-f]{64}/g))
      return s;
  }

  return "";
}

export function createAddrOpener(cb) {
  return (event) => {
    let addr = event.id;

    if (event.kind === KIND_META) {
      // npub
      addr = nip19.npubEncode(event.pubkey);
    } else if (
      (event.kind >= 10000 && event.kind < 20000)
      || (event.kind >= 30000 && event.kind < 40000)
    ) {
      // naddr
      addr = nip19.naddrEncode({
	pubkey: event.pubkey,
	kind: event.kind,
	identifier: getTagValue(event, 'd'),
	relays: [nostrbandRelay],
      });
    } else {
      // nevent
      addr = nip19.neventEncode({
	id: event.id,
	relays: [nostrbandRelay],
      });
    }

    console.log("addr", addr);
    cb(addr);
  };
}

export function connect() {
  
  ndk = new NDK({ explicitRelayUrls: allRelays });

  const scheduleStats = () => {
    setTimeout(() => {
      console.log("ndk stats", JSON.stringify(ndk.pool.stats()));
      scheduleStats();
    }, 5000);
  };
  scheduleStats();
  
  return ndk.connect(/* timeoutMs */ 1000, /* minConns */ 3);
}

export function launchZapDialog(id, event) {
  const d = document.createElement("div");
  d.setAttribute("data-npub", nip19.npubEncode(event.pubkey));
  if (event.kind != 0)
    d.setAttribute("data-note-id", nip19.noteEncode(event.id));
  window.nostrZap.initTarget(d);
  d.click();
  d.remove();
}

function addRelay(r) {
  if (!ndk.pool.relays.get(r))
    ndk.pool.addRelay(new NDKRelay(r));
  return ndk.pool.relays.get(r);
}

export async function addWalletInfo(info) {
  const relay = await addRelay(info.relay);
  relay.on("notice", (msg) => console.log("notice from", info.relay, msg));  
  relay.on("publish:failed", (event, err) => console.log("publish failed to", info.relay, event, err));  
}

export async function sendPayment(info, payreq) {
  localStorage.debug = "ndk:-";

  const relay = await addRelay(info.relay);
  console.log("relay", relay.url, "status", relay.status);

  const req = {
    method: "pay_invoice",
    params: {
      invoice: payreq,
    }
  };

  const encReq = await walletstore.encrypt(info.publicKey, JSON.stringify(req));
  console.log("encReq", encReq);
    
  const event = {
    pubkey: info.publicKey,
    kind: KIND_NWC_PAYMENT_REQUEST,
    tags: [["p", info.publicKey]],
    content: encReq,
    created_at: Math.floor(Date.now() / 1000),
  };
  
  const signed = await walletstore.signEvent(event);
  console.log("signed", JSON.stringify(signed));
  console.log("signed id", signed.id);

  const relaySet = NDKRelaySet.fromRelayUrls([info.relay], ndk);
  
  const sub = await ndk.subscribe(
    {
      kinds:[KIND_NWC_PAYMENT_REPLY],
      "#e": [signed.id],
      authors: [info.publicKey]
    },
    { closeOnEose: false },
    relaySet,
    /* autoStart */ false
  );

  const TIMEOUT_MS = 30000; // 30 sec
  const res = new Promise((ok, err) => {

    // make sure we don't wait forever
    const to = setTimeout(() => {
      sub.stop();
      err("Timeout error, payment might have failed");
    }, TIMEOUT_MS);

    sub.on("event", async (e) => {
      e = rawEvent(e);
      if (e.pubkey === info.publicKey
	  && e.tags.find(t => t.length >= 2 && t[0] === 'e' && t[1] === signed.id)) {
	clearTimeout(to);
	console.log("payment reply event", JSON.stringify(e));

	const rep = JSON.parse(await walletstore.decrypt(e.pubkey, e.content));
	console.log("payment reply", JSON.stringify(rep));

	if (rep.result_type === "pay_invoice") {
	  if (rep.error)
	    err(rep.error.message || "Error from the wallet");
	  else
	    ok({preimage: rep.result.preimage});
	} else {
	  err("Invalid payment reply");
	}

      } else {
	console.log("irrelevant event received", JSON.stringify(e));
      }
    });
  });

  // publish when we're 100% sure we've subscribed to replies
  sub.on("eose", async () => {

    // publish
    const r = await ndk.publish(
      new NDKEvent(ndk, signed),
      relaySet,
      TIMEOUT_MS / 2);

    console.log("published", r);

  });
  
  // subscribe before publishing
  await sub.start();

  return res;
}
