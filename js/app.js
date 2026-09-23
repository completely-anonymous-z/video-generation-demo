const { createGroup, observeGroup, filmstripMotion, fmt } = window.CastAV || {};

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const node = (tag, className = '', html = '') => { const n = document.createElement(tag); n.className = className; n.innerHTML = html; return n; };
const icons = {
  play: '<path d="m7 4 13 8-13 8Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  sound: '<path d="m11 5-5 4H3v6h3l5 4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 5-5 4H3v6h3l5 4Z"/><path d="m16 9 6 6m0-6-6 6"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6m0 6v6h-6m-6 0H3v-6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.play}</svg>`;
const color = (slot) => slot == null || slot < 0 ? 'var(--muted)' : `var(--c${slot % 6})`;
const safeURL = (value) => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
const isFile = () => location.protocol === 'file:';
const versioned = (src, version) => isFile() ? src : `${src}?v=${version}`;
const mediaURL = (c, id) => versioned(c.videos[id], c.media?.[id]?.version || '20260914e3');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let activeGroup = null, unobserve = null, selectedId;
let allCases = [], allMethods = [], filmstripRows = [];
const order = ["selected_icy_cave", "seminar_diaphragm", "hallway_offscreen"];
const shortTitles = {
  hallway_offscreen: 'A voice beyond the frame',
};
const axisLabels = { who_speaks: 'Speaker identity', who_acts: 'Actions', cast_camera: 'Cast & camera', what_sounds: 'Sound events', hero: 'Speaker identity' };

function renderIdentity(site) {
  document.title = `${site.method} — ${site.title}`;
  $('#paper-title').textContent = site.title;
  if (!site.anonymous && site.authors?.length) {
    const byline = $('#byline');
    byline.hidden = false;
    byline.innerHTML = site.authors.map((a) => {
      const href = safeURL(a.url);
      return `<span>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : esc(a.name)}${a.sup ? `<sup>${esc(a.sup)}</sup>` : ''}</span>`;
    }).join(' &nbsp;·&nbsp; ');
    if (site.affiliations?.length) byline.append(node('p', '', site.affiliations.map(esc).join(' &nbsp; ')));
    if (site.notes) byline.append(node('p', '', esc(site.notes)));
  }
  if (!site.anonymous) {
    if (site.bibtex?.trim()) { $('#citation').hidden = false; $('#bib').textContent = site.bibtex; }
  }
}

function renderFilmstrip() {
  const backdrop = $('#filmstrip-background');
  const field = node('div', 'filmstrip-field');
  filmstripRows.forEach((sequence, row) => {
    const band = node('div', `filmstrip-band filmstrip-band-${row + 1}`);
    band.style.setProperty('--film-duration', `${[88, 108, 94][row] * sequence.length / 6}s`);
    const track = node('div', 'filmstrip-track');
    // Two equal groups make a seamless, compositor-only loop.
    for (let repeat = 0; repeat < 2; repeat++) {
      const group = node('div', 'filmstrip-group');
      sequence.forEach((entry) => {
        const portrait = entry.portrait === true;
        const frame = node('div', 'filmstrip-frame' + (portrait ? ' is-portrait' : ''));
        const image = node('img'); image.src = entry.image; image.alt = ''; image.width = 480; image.height = 270; image.decoding = 'async'; image.draggable = false;
        frame.append(image); group.append(frame);
      });
      track.append(group);
    }
    band.append(track); field.append(band);
  });
  backdrop.append(field);
  filmstripMotion($('#hero-opening'), backdrop, $('#film-motion'));
}

function renderShowreel(spec) {
  const host = $('#showreel-player');
  const shell = node('div', 'showreel-shell');
  const frame = node('div', 'showreel-frame');
  frame.style.aspectRatio = `${spec.width} / ${spec.height}`;
  const video = node('video'); video.src = versioned(spec.video, spec.version); video.poster = spec.poster; video.playsInline = true; video.preload = 'metadata'; video.muted = false; video.loop = false;
  video.setAttribute('aria-label', 'Proposed method showreel with original generated audio');
  const cover = node('div', 'showreel-cover');
  const start = node('button', 'showreel-start', `${icon('play')}<span>Play with sound</span><small>${fmt(spec.duration)} seconds</small>`);
  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(video.duration)) $('small', start).textContent = `${fmt(video.duration)} seconds`;
    if (video.videoWidth && video.videoHeight) frame.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  });
  cover.append(start);
  const full = node('button', 'fullscreen-button', icon('expand')); full.setAttribute('aria-label', 'View showreel full screen');
  full.addEventListener('click', () => {
    video.controls = true;
    if (video.requestFullscreen) video.requestFullscreen().catch(() => { video.controls = false; });
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });
  const message = node('div', 'media-message'); message.hidden = true; message.setAttribute('role', 'status');
  frame.append(video, cover, full, message);
  const transport = node('div', 'transport showreel-transport');
  const play = node('button', 'play-button', icon('play')); play.setAttribute('aria-label', 'Play showreel');
  const scrub = node('input', 'scrub'); scrub.type = 'range'; scrub.min = 0; scrub.max = 1000; scrub.step = 1; scrub.value = 0; scrub.setAttribute('aria-label', 'Showreel playback position');
  const time = node('span', 'time', `0.0 / ${fmt(spec.duration)}`);
  const sound = node('button', 'sound-button'); sound.setAttribute('aria-pressed', 'true');
  transport.append(play, scrub, time, sound);
  shell.append(frame, transport); host.append(shell);
  const group = createGroup(video);
  function paintSound() {
    const on = Boolean(group.audioId);
    sound.innerHTML = `${icon(on ? 'sound' : 'mute')}<span>${on ? 'Sound on' : 'Sound off'}</span>`;
    sound.setAttribute('aria-pressed', String(on)); sound.setAttribute('aria-label', on ? 'Mute showreel' : 'Enable showreel sound');
    const verb = video.ended ? 'Replay' : video.currentTime > .1 ? 'Resume' : 'Play';
    $('span', start).textContent = `${verb} ${on ? 'with sound' : 'muted'}`;
  }
  group.onAudio = paintSound;
  group.onState = ({ playing, ended, error, waiting }) => {
    cover.hidden = playing || error;
    play.innerHTML = icon(playing ? 'pause' : 'play'); play.disabled = error;
    play.setAttribute('aria-label', playing ? 'Pause showreel' : ended ? 'Replay showreel' : 'Play showreel');
    start.disabled = error;
    if (!error) { message.hidden = !waiting; message.textContent = waiting ? 'Loading the showreel…' : ''; }
    paintSound();
  };
  group.onTick = (t, duration) => {
    const d = duration || spec.duration, fraction = d ? t / d : 0;
    scrub.value = String(Math.round(fraction * 1000)); scrub.style.setProperty('--progress', `${fraction * 100}%`); scrub.setAttribute('aria-valuetext', `${fmt(t)} of ${fmt(d)} seconds`);
    time.textContent = `${fmt(t)} / ${fmt(d)}`;
    paintSound();
  };
  group.onError = (_, text) => {
    message.hidden = false; message.replaceChildren(node('p', '', esc(text))); cover.hidden = true;
    const retry = node('button', '', 'Reload showreel'); retry.addEventListener('click', () => group.retry()); message.append(retry);
  };
  start.addEventListener('click', () => group.play());
  play.addEventListener('click', () => group.playing ? group.pause() : group.play());
  sound.addEventListener('click', () => group.setAudio(group.audioId ? null : 'ours'));
  scrub.addEventListener('input', () => group.seek(Number(scrub.value) / 1000));
  group.setVisible(false); observeGroup(frame, group); group.onTick(0, spec.duration); group.setAudio('ours');
}

function structuredScreenplay(c) {
  const s = c.screenplay;
  const ordinal = ['first', 'second', 'third'];
  const cast = s.cast.map((member, i) => `        <${ordinal[i] || `character_${i + 1}`}>
            <appearance>${member.appearance}</appearance>
            <posture>${member.posture || ''}</posture>
            <frame_position>${member.position || ''}</frame_position>
            <actions>${member.actions || ''}</actions>
        </${ordinal[i] || `character_${i + 1}`}>`).join('\n');
  const events = s.events.map((event, i) => `        <${ordinal[i] || `event_${i + 1}`}>
            <dialogue>
                <voice>${event.voice || ''}</voice>
                <character_id>${event.speaker}: ${event.speaker_desc || ''}</character_id>
                <words: English>${event.words || ''}</words>
            </dialogue>
            <event>${event.action || ''}</event>${event.lighting ? `\n            <lighting>${event.lighting}</lighting>` : ''}
            <camera_motion>${event.camera || ''}</camera_motion>
        </${ordinal[i] || `event_${i + 1}`}>`).join('\n');
  return `Structured Description:
    [SCENE]
        ${s.scene}
    [END_SCENE]
    [VISIBLE_MAIN_CHARACTER]
        <count>${s.cast.length}</count>
${cast}
    [END_VISIBLE_MAIN_CHARACTER]
    [EVENT_SEQUENCE]
${events}
    [END_EVENT_SEQUENCE]
    [AUDIO_CAPTION]
        ${s.audio_caption}
    [END_AUDIO_CAPTION]${s.subjects ? `\n    [SUBJECT]${JSON.stringify(s.subjects)}[END_SUBJECT]` : ''}
    [ATMOSPHERE]"${s.atmosphere}"[END_ATMOSPHERE]`;
}

function renderIdea() {
  const c = allCases.find(c => c.id === 'selected_icy_cave');
  if (!c) return;
  const panel = $('#idea-demo');
  const frame = node('figure', 'input-frame');
  frame.innerHTML = `<img src="${esc(c.frame || c.poster)}" loading="lazy" width="960" height="540" alt="Input frame: ${esc(c.title)}"><figcaption><span>Input frame</span><span>${c.screenplay.cast.length} visible characters</span></figcaption>`;
  frame.append(node('p', 'idea-scene', esc(c.screenplay.scene)));
  const script = node('div', 'script-sample', '<p class="eyebrow">Grounded screenplay</p>');
  c.screenplay.events.slice(0, 3).forEach((event, index) => {
    const speaker = c.screenplay.speakers[event.speaker];
    const line = node('div', 'script-line', `<span class="order">0${index + 1}</span><div><span class="sample-speaker"><i></i>${esc(event.speaker)} · ${esc(speaker?.desc)}</span><p class="line-words">“${esc(event.words)}”</p><p class="idea-event">${esc(event.action)}</p></div>`);
    line.style.setProperty('--actor', color(speaker?.color ?? index));
    script.append(line);
  });
  script.append(node('p', 'sample-note', 'Persistent identities. Ordered events. One shared scene.'));
  const details = node('details', 'idea-structured');
  details.append(node('summary', '', 'Read the structured description'));
  const pre = node('pre'); pre.textContent = structuredScreenplay(c); details.append(pre);
  panel.replaceChildren(frame, script, details);
}

function renderFilmIndex() {
  const root = $('#film-index'); root.replaceChildren();
  allCases.forEach((c) => {
    const button = node('button', 'film-option');
    button.innerHTML = `<span class="film-thumb"><img src="${esc(c.poster)}" alt="" loading="lazy" width="480" height="270"></span><span class="film-names"><span>${esc(shortTitles[c.id] || c.title)}</span><span class="selected-mark" aria-hidden="true">${selectedId === c.id ? 'Selected' : 'View scene'}</span></span>`;
    button.setAttribute('aria-pressed', String(selectedId === c.id));
    button.setAttribute('aria-controls', 'case-host');
    button.addEventListener('click', () => selectCase(c.id, { scroll: true, focus: true }));
    root.append(button);
  });
}

function media(c, id, label) {
  const metadata = c.media?.[id];
  const frame = node('div', 'video-frame');
  const video = node('video'); video.src = mediaURL(c, id); video.preload = id === 'ours' ? 'metadata' : 'none'; video.playsInline = true; video.muted = true;
  video.setAttribute('aria-label', `${label}: ${c.title}`); video.dataset.method = id;
  video.poster = id === 'ours' && c.frame ? c.frame : metadata?.poster || c.poster;
  if (metadata?.width && metadata?.height) frame.style.setProperty('--ratio', `${metadata.width}/${metadata.height}`);
  if (id === 'ours' && metadata?.height > metadata?.width) frame.classList.add('portrait');
  const expand = node('button', 'fullscreen-button', icon('expand')); expand.setAttribute('aria-label', `View ${label} full screen`);
  expand.addEventListener('click', () => {
    video.controls = true;
    if (video.requestFullscreen) video.requestFullscreen().catch(() => { video.controls = false; });
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });
  const message = node('div', 'media-message'); message.hidden = true; message.setAttribute('role', 'status');
  frame.append(video, expand, message);
  return { frame, video, message, metadata };
}

function renderScript(c) {
  const details = node('details', 'script-details');
  details.append(node('summary', '', 'Read the full screenplay & input'));
  const content = node('div', 'script-content');
  const first = node('div');
  const frameLabel = c.frame_label || (c.frame ? 'Input frame' : 'Generated preview');
  const figure = node('figure', 'input-frame', `<img src="${esc(c.frame || c.poster)}" loading="lazy" alt="${esc(frameLabel)} for ${esc(c.title)}"><figcaption>${esc(frameLabel)}</figcaption>`);
  first.append(figure, node('p', 'scene-text', esc(c.screenplay.scene)));
  c.screenplay.cast.forEach((member) => first.append(node('p', 'script-cast', `<b>${esc(member.speaker || 'Visible character')}</b>${esc(member.appearance)}`)));
  const events = node('div');
  c.screenplay.events.forEach((event, index) => {
    const speaker = c.screenplay.speakers?.[event.speaker];
    const row = node('div', 'script-event'); row.style.setProperty('--actor', color(speaker?.color));
    row.innerHTML = `<small>EVENT ${String(index + 1).padStart(2, '0')} · ${speaker ? esc(speaker.offscreen ? 'OFF-SCREEN' : event.speaker) : 'ACTION'}</small>${event.words ? `<blockquote>“${esc(event.words)}”</blockquote>` : ''}<p>${esc(event.action)}</p>${event.camera ? `<p class="camera">${esc(event.camera)}</p>` : ''}`;
    events.append(row);
  });
  events.append(node('p', 'audio-caption', `<b>AUDIO DIRECTION</b>${esc(c.screenplay.audio_caption)}${c.screenplay.atmosphere ? `<br>Atmosphere: ${esc(c.screenplay.atmosphere)}` : ''}`));
  content.append(first, events); details.append(content); return details;
}

function renderCase(c) {
  unobserve?.(); activeGroup?.destroy();
  const root = $('#case-host'); root.replaceChildren();
  const article = node('article', 'case fade-in'); article.id = `film-${c.id}`; article.tabIndex = -1; article.setAttribute('aria-labelledby', 'case-title');
  article.innerHTML = `<header class="case-header"><div><p class="eyebrow">${esc(axisLabels[c.axis])} / ${esc(c.benchmark)}</p><h3 id="case-title">${esc(shortTitles[c.id] || c.title)}</h3><p class="case-claim">${esc(c.claim)}</p></div></header>`;
  const methods = allMethods.filter((method) => method.id !== 'ours' && c.videos[method.id]);
  let compared = methods.find(method => method.id === 'ltx23')?.id || methods[0]?.id, expanded = false;
  const stage = node('div', 'cinema-stage' + (methods.length ? '' : ' is-solo'));
  stage.style.setProperty('--stage-ratio', `${c.media.ours.width}/${c.media.ours.height}`);
  const toolbar = node('div', 'cinema-toolbar');
  const pairSelect = node('select', 'pair-select'); pairSelect.id = 'comparison-method'; pairSelect.setAttribute('aria-label', 'Compare Proposed method with');
  if (methods.length) {
    const selector = node('label', 'comparison-selector', '<span>Compare with</span>');
    methods.forEach((method) => { const option = node('option', '', esc(method.label)); option.value = method.id; pairSelect.append(option); });
    pairSelect.value = compared;
    selector.append(pairSelect); toolbar.append(node('p', '', `Same first frame. Same screenplay.${Number.isInteger(c.seed) ? ` Proposed method: seed ${c.seed}.` : ''}`), selector);
  } else toolbar.append(node('p', '', c.featured ? ('Selected Proposed method output' + (Number.isInteger(c.seed) ? ' · seed ' + c.seed : '')) : 'Additional generation example'));
  const viewer = node('div', 'viewer' + (methods.length ? ' is-paired' : ''));
  const primary = node('div', 'primary-wrap');
  const main = media(c, 'ours', 'Proposed method');
  const primaryTitle = node('div', 'method-title', '<h4>Proposed method</h4>');
  const primaryAudio = node('button', 'listen-button'); primaryTitle.append(primaryAudio); primary.append(primaryTitle, main.frame);
  const pairSlot = node('div', 'pair-slot'); pairSlot.hidden = !methods.length;
  viewer.append(primary, pairSlot);
  const transport = node('div', 'transport');
  const play = node('button', 'play-button', icon('play')); play.setAttribute('aria-label', 'Play scene');
  const scrub = node('input', 'scrub'); scrub.type = 'range'; scrub.min = 0; scrub.max = 1000; scrub.step = 1; scrub.value = 0; scrub.setAttribute('aria-label', 'Scene playback position');
  const time = node('span', 'time', `0.0 / ${fmt(c.duration)}`);
  const sound = node('button', 'sound-button');
  transport.append(play, scrub, time, sound);
  const status = node('p', 'playback-status'); status.setAttribute('aria-live', 'polite');
  const cue = node('div', 'screenplay-cue'); cue.setAttribute('aria-label', 'Current screenplay event');
  const cueMeta = node('div', 'cue-meta'), cueText = node('div', 'cue-text'); cue.append(cueMeta, cueText);
  const steps = node('div', 'event-navigation'); steps.setAttribute('aria-label', 'Jump to an approximate event time');
  const cueFooter = node('div', 'cue-footer'); cueFooter.append(node('p', '', 'Approximate screenplay timing'), steps);
  stage.append(toolbar, viewer, transport, status, cue, cueFooter); article.append(stage);
  const additional = node('section', 'additional-methods'); additional.id = 'additional-methods'; additional.hidden = true; additional.setAttribute('aria-label', 'Additional baseline outputs');
  const grid = node('div', 'compare-grid'); additional.append(node('p', 'additional-heading', 'Additional baselines · choose one for a closer comparison'), grid);
  const allToggle = node('button', 'all-methods-toggle', `View all ${methods.length + 1} methods <span aria-hidden="true">+</span>`); allToggle.setAttribute('aria-expanded', 'false'); allToggle.setAttribute('aria-controls', additional.id);
  const entries = [], cells = new Map(), mediaById = new Map([['ours', main]]), audioButtons = new Map([['ours', primaryAudio]]);
  methods.forEach((method) => {
    const cell = node('div', 'method-cell'); cell.dataset.method = method.id;
    const title = node('div', 'method-title', `<h4>${esc(method.label)}</h4>`);
    const audio = node('button', 'listen-button'); title.append(audio);
    const item = media(c, method.id, method.label); item.video.preload = 'none';
    const footer = node('div', 'method-footer');
    const duration = node('span', 'method-state', `${fmt(item.metadata.duration)}s`);
    const compare = node('button', 'method-compare', 'Compare ↑'); compare.setAttribute('aria-label', `Compare ${method.label} beside Proposed method`);
    compare.addEventListener('click', () => { pairSelect.value = method.id; updateComparison(); stage.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start' }); });
    footer.append(duration, compare); cell.append(title, item.frame, footer); grid.append(cell);
    entries.push({ id: method.id, video: item.video }); cells.set(method.id, { cell, item, duration }); mediaById.set(method.id, item); audioButtons.set(method.id, audio);
  });
  if (methods.length) article.append(allToggle, additional);
  else article.append(node('p', 'sample-only', c.featured ? 'Generated from a first frame and grounded screenplay.' : 'Baseline comparisons are not available for this additional example.'));
  article.append(renderScript(c)); root.append(article);
  const group = createGroup(main.video, entries, { activeMethods: ['ours', ...(compared ? [compared] : [])] }); activeGroup = group;
  let eventIndex = -1;
  const stepButtons = c.screenplay.events.map((event, i) => {
    const button = node('button', 'event-step', String(i + 1).padStart(2, '0')); button.style.setProperty('--actor', color(c.screenplay.speakers?.[event.speaker]?.color));
    button.setAttribute('aria-label', `Seek to event ${i + 1}: ${event.words || event.action}`);
    button.addEventListener('click', () => group.seek(event.t[0] / (group.duration || c.duration))); steps.append(button); return button;
  });
  function paintEvent(i) {
    if (i === eventIndex) return; eventIndex = i;
    const event = c.screenplay.events[i], speaker = c.screenplay.speakers?.[event.speaker];
    cue.style.setProperty('--actor', color(speaker?.color));
    cueMeta.innerHTML = `<span>Screenplay · ${i + 1} / ${c.screenplay.events.length}</span><b>${speaker ? esc(speaker.offscreen ? 'Off-screen voice' : event.speaker) : 'Action'}</b>`;
    cueText.innerHTML = `<p>${event.words ? `“${esc(event.words)}”` : esc(event.action)}</p>${event.words ? `<span>${esc(event.action)}</span>` : ''}${event.camera && !/static|fixed|unchanged/i.test(event.camera) ? `<span>${esc(event.camera)}</span>` : ''}`;
    stepButtons.forEach((button, index) => button.setAttribute('aria-current', String(i === index)));
  }
  group.onTick = (t, duration) => {
    const d = duration || c.duration, fraction = d ? t / d : 0;
    scrub.value = String(Math.round(fraction * 1000)); scrub.style.setProperty('--progress', `${fraction * 100}%`); scrub.setAttribute('aria-valuetext', `${fmt(t)} of ${fmt(d)} seconds`); time.textContent = `${fmt(t)} / ${fmt(d)}`;
    let i = c.screenplay.events.findIndex((event) => t >= event.t[0] && t < event.t[1]);
    if (i < 0) i = Math.max(0, c.screenplay.events.filter((event) => event.t[0] <= t).length - 1);
    paintEvent(i);
    cells.forEach(({ duration: label, item }) => { const vd = item.video.duration; if (Number.isFinite(vd) && vd > 0) label.textContent = t >= vd - .035 ? `${fmt(vd)}s · ended` : `${fmt(vd)}s`; });
  };
  group.onState = ({ playing, ended, error, waiting }) => {
    play.innerHTML = icon(playing ? 'pause' : 'play'); play.setAttribute('aria-label', playing ? 'Pause scene' : ended ? 'Replay scene' : 'Play scene'); play.disabled = error;
    if (!error) { main.message.hidden = !waiting; main.message.textContent = waiting ? 'Loading the scene…' : ''; }
  };
  group.onAudio = (id) => {
    const label = allMethods.find((method) => method.id === id)?.label;
    sound.innerHTML = `${icon(id ? 'sound' : 'mute')}<span>${id ? 'Sound on' : 'Sound off'}</span>`;
    sound.setAttribute('aria-pressed', String(Boolean(id))); sound.setAttribute('aria-label', id ? 'Mute scene audio' : 'Enable Proposed method audio');
    status.textContent = id ? `Audio: ${label}` : 'Audio muted';
    audioButtons.forEach((button, methodId) => {
      const selected = id === methodId, name = allMethods.find((method) => method.id === methodId).label;
      button.innerHTML = `${icon(selected ? 'sound' : 'mute')}<span>${selected ? 'Audio on' : 'Audio'}</span>`;
      button.setAttribute('aria-pressed', String(selected)); button.setAttribute('aria-label', selected ? `Mute ${name} audio` : `Select ${name} audio`);
    });
  };
  group.onError = (id, text) => {
    const item = mediaById.get(id); item.message.hidden = false; item.message.replaceChildren(node('p', '', esc(text)));
    const retry = node('button', '', 'Reload video'); retry.addEventListener('click', () => group.retry(id)); item.message.append(retry); audioButtons.get(id).disabled = true;
  };
  mediaById.forEach((item, id) => item.video.addEventListener('loadeddata', () => { item.message.hidden = true; audioButtons.get(id).disabled = false; }));
  audioButtons.forEach((button, id) => button.addEventListener('click', () => group.setAudio(group.audioId === id ? null : id)));
  play.addEventListener('click', () => group.playing ? group.pause() : group.play());
  scrub.addEventListener('input', () => group.seek(Number(scrub.value) / 1000));
  sound.addEventListener('click', () => group.setAudio(group.audioId ? null : 'ours'));
  function updateComparison() {
    compared = pairSelect.value;
    methods.forEach((method) => { const { cell } = cells.get(method.id); if (method.id !== compared) grid.append(cell); });
    const chosen = cells.get(compared); if (chosen && chosen.cell.parentNode !== pairSlot) pairSlot.append(chosen.cell);
    additional.hidden = !expanded;
    allToggle.setAttribute('aria-expanded', String(expanded));
    allToggle.innerHTML = `${expanded ? 'Hide additional methods' : `View all ${methods.length + 1} methods`} <span aria-hidden="true">${expanded ? '−' : '+'}</span>`;
    group.setActiveMethods(expanded ? methods.map((method) => method.id) : compared ? [compared] : []);
  }
  allToggle.addEventListener('click', () => { expanded = !expanded; updateComparison(); });
  pairSelect.addEventListener('change', updateComparison);
  updateComparison(); group.onTick(0, c.duration); group.setAudio('ours');
  group.setVisible(false); unobserve = observeGroup(article, group);
  return article;
}

function selectCase(id, { scroll = false, focus = false, updateHash = true } = {}) {
  const c = allCases.find((item) => item.id === id); if (!c) return;
  selectedId = id; renderFilmIndex(); const article = renderCase(c);
  if (updateHash) history.replaceState(null, '', `#film-${id}`);
  if (scroll) article.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start' });
  if (focus) article.focus({ preventScroll: true });
}

function navigation() {
  document.addEventListener('fullscreenchange', () => { document.querySelectorAll('video[controls]').forEach((video) => { if (document.fullscreenElement !== video) video.controls = false; }); });
  const toggle = $('.menu-toggle'), menu = $('#mobile-nav');
  toggle.addEventListener('click', () => { const open = toggle.getAttribute('aria-expanded') !== 'true'; toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation'); menu.hidden = !open; });
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', 'Open navigation'); }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); } });
  $('#copy-citation').addEventListener('click', async () => {
    const button = $('#copy-citation');
    try { await navigator.clipboard.writeText($('#bib').textContent); button.textContent = 'Copied'; }
    catch { button.textContent = 'Select the citation to copy'; }
    setTimeout(() => { button.textContent = 'Copy BibTeX'; }, 2500);
  });
}

function main() {
  const data = window.__PAGE_DATA__;
  if (!data) throw new Error('Page data is missing');
  const { site, methods, cases, filmstrip, showreel } = data;
  allCases = cases.filter((c) => c.show_in_comparisons !== false).sort((a, b) => (order.indexOf(a.id)<0?999:order.indexOf(a.id)) - (order.indexOf(b.id)<0?999:order.indexOf(b.id))); allMethods = methods.sort((a, b) => a.order - b.order); filmstripRows = filmstrip.rows;
  const hash = decodeURIComponent(location.hash.slice(1)); const initial = allCases.find((c) => `film-${c.id}` === hash);
  renderIdentity(site); renderFilmstrip(); renderShowreel(showreel); renderIdea(); navigation();
  selectCase(initial?.id || allCases[0].id, { updateHash: false });
  $('#boot').remove();
  const initialTarget = document.getElementById(hash);
  if (initialTarget) requestAnimationFrame(() => initialTarget.scrollIntoView({ block: 'start' }));
  window.addEventListener('hashchange', () => { const id = decodeURIComponent(location.hash.slice(1)).replace(/^film-/, ''); if (allCases.some((c) => c.id === id) && selectedId !== id) { selectCase(id, { scroll: true, updateHash: false }); } });
}
try { main(); } catch (error) {
  const boot = $('#boot'); if (boot) { boot.textContent = 'The films could not be loaded. '; const retry = node('button', '', 'Reload page'); retry.addEventListener('click', () => location.reload()); boot.append(retry); }
  console.error(error);
}
