'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const players = new Set();
let toastTimer;
let reviewData;
let currentView;
const evidenceCache = new Map();
const reviewerMemory = new Map();

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 2200);
}

async function copyLink(anchor) {
  const url = new URL(location.href);
  url.hash = anchor;
  try {
    await navigator.clipboard.writeText(url.href);
    toast('Link copied');
  } catch (_) {
    const input = document.createElement('textarea');
    input.value = url.href;
    input.style.cssText = 'position:fixed;left:-9999px';
    document.body.append(input);
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    toast(ok ? 'Link copied' : 'Copy this page’s address after opening the item link.');
    if (!ok) location.hash = anchor;
  }
}

document.addEventListener('click', event => {
  const copy = event.target.closest('[data-anchor]');
  if (copy) copyLink(copy.dataset.anchor);
});

function formatTime(value) {
  const seconds = Math.max(0, value || 0);
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function renderAnnotationComparison(panels) {
  if (!panels) return '';
  const highlighted = (text, phrase) => {
    const index = phrase ? text.indexOf(phrase) : -1;
    if (index < 0) return escapeHTML(text);
    return escapeHTML(text.slice(0, index)) + `<mark>${escapeHTML(phrase)}</mark>` + escapeHTML(text.slice(index + phrase.length));
  };
  return `<section class="annotation-comparison" aria-label="Gemini annotation comparison">${panels.map(panel => `
    <section class="annotation-panel ${panel.status === 'incorrect' ? 'annotation-incorrect' : 'annotation-correct'}">
      <h4>${escapeHTML(panel.label)}</h4>
      <div class="annotation-turns">${panel.turns.map(turn => `
        <div class="annotation-turn${turn.highlight ? ' has-target' : ''}">
          <p class="annotation-speaker">${escapeHTML(turn.speaker)}</p>
          <p class="annotation-words">${highlighted(turn.text, turn.highlight)}</p>
        </div>`).join('')}</div>
    </section>`).join('')}</section>`;
}

class ComparisonPlayer {
  constructor(group, host) {
    this.group = group;
    this.playing = false;
    this.starting = false;
    this.destroyed = false;
    this.duration = Math.min(...group.videos.map(video => video.duration));
    this.playLabel = group.videos.length === 1 ? 'Play video' : 'Play together';
    this.pauseLabel = group.videos.length === 1 ? 'Pause video' : 'Pause together';
    this.audioIndex = 0;
    this.rate = 1;
    this.ignoreSeekUntil = 0;
    this.root = document.createElement('article');
    this.root.className = group.annotationComparison ? 'video-group annotation-group' : 'video-group';
    if (group.observation) this.root.classList.add('outcome-group');
    this.root.id = group.id;
    this.root.innerHTML = `
      <div class="video-group-heading">
        <div class="item-heading"><div><span class="item-code">${escapeHTML(group.code)}</span><h3>${escapeHTML(group.title || `${group.people}-person conversation`)}</h3></div><button class="copy-link" data-anchor="${escapeHTML(group.anchor)}" aria-label="Copy link to ${group.code}">Copy link ↗</button></div>
        ${group.expectedActions ? `<section class="expected-actions" aria-label="Expected action sequence">
          <h4>Expected action sequence</h4>
          <ol>${group.expectedActions.steps.map(step => `<li>${escapeHTML(step)}</li>`).join('')}</ol>
          ${group.expectedActions.throughout ? `<p class="expected-constraint"><strong>Throughout:</strong> ${escapeHTML(group.expectedActions.throughout)}</p>` : ''}
        </section>` : group.description ? `<p class="video-description">${escapeHTML(group.description)}</p>` : ''}
        ${group.observation ? `<p class="observed-outcome${group.outcome === 'failure' ? ' observed-failure' : ''}"><strong>${group.outcome === 'failure' ? 'Observed failure' : 'Observed target actions'}:</strong> ${escapeHTML(group.observation)}</p>` : ''}
      </div>
      <div class="video-grid" style="--cols:${group.videos.length}">${group.videos.map((video, i) => `
        <div class="video-cell">
          <div class="video-label"><span>${escapeHTML(video.label)}</span><a href="${video.src}" target="_blank" rel="noopener" aria-label="Open ${escapeHTML(video.label)} video for ${group.code}">Open ↗</a></div>
          <video controls playsinline muted preload="none" src="${video.src}" poster="${video.poster}" aria-label="${escapeHTML(group.code + ' — ' + video.label)}">Your browser does not support embedded video. <a href="${video.src}">Open video</a>.</video>
          ${video.prompt ? `<details class="clip-prompt"><summary>Input prompt</summary><pre tabindex="0" aria-label="${escapeHTML(video.label)} input prompt">${escapeHTML(video.prompt)}</pre></details>` : ''}
        </div>`).join('')}</div>
      <div class="player-controls">
        <button class="play-button" aria-label="${this.playLabel}: ${escapeHTML(group.code)}">▶ ${this.playLabel}</button>
        <button class="restart-button" aria-label="Restart all videos in ${group.code}" title="Restart">↺</button>
        <input class="scrub" type="range" min="0" max="${this.duration}" step="0.01" value="0" aria-label="Seek all videos in ${group.code}">
        <output class="time-display">0:00 / ${formatTime(this.duration)}</output>
        <label class="control-select">Audio<select class="audio-select" aria-label="Audio source for ${group.code}">${group.videos.map((video, i) => `<option value="${i}">${escapeHTML(video.label)}</option>`).join('')}<option value="-1">Muted</option></select></label>
        <label class="control-select">Speed<select class="speed-select" aria-label="Playback speed for ${group.code}"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option></select></label>
      </div>
      <p class="player-status" role="status"></p>
      ${renderAnnotationComparison(group.annotationComparison)}`;
    host.append(this.root);
    this.videos = $$('video', this.root);
    this.playButton = $('.play-button', this.root);
    this.scrub = $('.scrub', this.root);
    this.clock = $('.time-display', this.root);
    this.status = $('.player-status', this.root);
    this.playButton.addEventListener('click', () => this.playing || this.starting ? this.pause() : this.start());
    $('.restart-button', this.root).addEventListener('click', () => this.seek(0));
    this.scrub.addEventListener('input', () => this.seek(Number(this.scrub.value)));
    $('.audio-select', this.root).addEventListener('change', event => this.setAudio(Number(event.target.value)));
    $('.speed-select', this.root).addEventListener('change', event => {
      this.rate = Number(event.target.value);
      this.videos.forEach(video => { video.playbackRate = this.rate; });
    });
    this.videos.forEach((video, i) => {
      video.addEventListener('loadedmetadata', () => {
        const durations = this.videos.map(v => v.duration);
        if (durations.every(d => Number.isFinite(d) && d > 0)) {
          this.duration = Math.min(...durations);
          this.scrub.max = String(this.duration);
          this.updateClock(video.currentTime);
        }
      });
      video.addEventListener('play', () => {
        if (!this.isVisible()) { video.pause(); return; }
        if (!this.starting && !this.playing) this.start(video);
      });
      video.addEventListener('pause', () => { if (this.playing && !this.starting && !this.seeking) this.pause(); });
      video.addEventListener('ended', () => this.pause());
      video.addEventListener('seeked', () => {
        if (Date.now() > this.ignoreSeekUntil && Math.abs(video.currentTime - Number(this.scrub.value)) > .12) this.seek(video.currentTime);
      });
      video.addEventListener('volumechange', () => { if (!video.muted && this.audioIndex !== i) this.setAudio(i); });
      video.addEventListener('error', () => { this.status.textContent = 'This video could not be loaded. Use its Open link to view it directly.'; });
    });
    this.setAudio(0);
    players.add(this);
  }

  setAudio(index) {
    this.audioIndex = index;
    $('.audio-select', this.root).value = String(index);
    this.videos.forEach((video, i) => { video.muted = i !== index; });
  }

  isVisible() {
    return this.root.isConnected && this.root.closest('#evidence-host') !== null && !this.root.closest('details:not([open])');
  }

  async start(origin = null) {
    if (this.starting || this.destroyed || !this.isVisible()) return;
    for (const player of players) if (player !== this) player.pause();
    this.starting = true;
    this.status.textContent = 'Loading the comparison…';
    let startTime = origin ? origin.currentTime : Number(this.scrub.value);
    if (startTime >= this.duration - .12) startTime = 0;
    this.seek(startTime);
    this.setAudio(this.audioIndex);
    this.videos.forEach(video => { video.playbackRate = this.rate; });
    const attempts = await Promise.allSettled(this.videos.map(video => video.play()));
    if (this.destroyed || !this.starting || !this.isVisible()) {
      this.videos.forEach(video => video.pause());
      return;
    }
    this.starting = false;
    if (attempts.some(result => result.status === 'rejected')) {
      this.pause();
      this.status.textContent = 'Playback could not start for every video. Try Play together again, or use the individual Open links.';
      return;
    }
    this.playing = true;
    this.status.textContent = '';
    this.playButton.textContent = `Ⅱ ${this.pauseLabel}`;
    this.playButton.setAttribute('aria-label', `${this.pauseLabel}: ${this.group.code}`);
    this.tick();
  }

  pause() {
    if (this.starting) this.status.textContent = '';
    this.playing = false;
    this.starting = false;
    this.videos.forEach(video => video.pause());
    cancelAnimationFrame(this.animation);
    this.playButton.textContent = `▶ ${this.playLabel}`;
    this.playButton.setAttribute('aria-label', `${this.playLabel}: ${this.group.code}`);
  }

  seek(time) {
    const position = Math.min(this.duration, Math.max(0, time));
    this.ignoreSeekUntil = Date.now() + 700;
    this.seeking = true;
    this.videos.forEach(video => {
      if (video.preload === 'none') video.preload = 'metadata';
      try { video.currentTime = position; } catch (_) { /* Browser applies pending seek after metadata. */ }
    });
    this.scrub.value = position;
    this.updateClock(position);
    this.seeking = false;
  }

  updateClock(time) {
    this.clock.textContent = `${formatTime(time)} / ${formatTime(this.duration)}`;
  }

  tick() {
    if (!this.playing || this.destroyed) return;
    const time = this.videos[0].currentTime;
    this.scrub.value = time;
    this.updateClock(time);
    this.videos.slice(1).forEach(video => {
      if (video.readyState >= 2 && Math.abs(video.currentTime - time) > .2) {
        this.ignoreSeekUntil = Date.now() + 700;
        video.currentTime = time;
      }
    });
    if (time >= this.duration - .05) { this.pause(); return; }
    this.animation = requestAnimationFrame(() => this.tick());
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    this.videos.forEach(video => { video.removeAttribute('src'); video.load(); });
    players.delete(this);
    this.root.remove();
  }
}

function getEvidence(id, questionAnchor) {
  if (evidenceCache.has(id)) {
    const entry = evidenceCache.get(id);
    entry.node.querySelectorAll('[data-anchor]').forEach(button => {
      button.dataset.anchor = questionAnchor + button.dataset.anchor.slice(button.dataset.anchor.indexOf('/'));
    });
    return entry;
  }
  const evidence = reviewData.evidence[id];
  if (!evidence) throw new Error(`Unknown evidence: ${id}`);
  const node = document.createElement('div');
  node.className = 'evidence-items';
  if (evidence.kind === 'table') {
    node.innerHTML = `<article class="table-block evidence-block" id="${id}">
      <div class="item-heading"><div><span class="item-code">Table ${escapeHTML(evidence.code)}</span><h3>${escapeHTML(evidence.label)}</h3></div><a download href="${escapeHTML(evidence.csv)}">CSV ↓</a></div>
      <p class="evidence-context">${escapeHTML(evidence.context || '')}</p>
      <div class="table-scroll" role="region" aria-label="${escapeHTML(evidence.label)}" tabindex="0">${evidence.html}</div>
    </article>`;
  } else {
    evidence.groups.forEach(group => {
      let host = node;
      if (group.folded) {
        host = document.createElement('details');
        host.className = 'alternate-take';
        const summary = document.createElement('summary');
        summary.textContent = group.folded;
        host.append(summary);
        node.append(host);
      }
      const anchor = `${questionAnchor}/${id}${group.folded || evidence.groups.length > 1 ? '/' + group.id : ''}`;
      const player = new ComparisonPlayer({...group, anchor}, host);
      if (group.conditions.length) {
        const conditions = document.createElement('div');
        conditions.className = 'video-conditions';
        conditions.innerHTML = group.conditions.map(c => `<span>${escapeHTML(c)}</span>`).join('');
        $('.video-group-heading', player.root).append(conditions);
      }
      if (group.folded) host.addEventListener('toggle', () => { if (!host.open) player.pause(); });
    });
  }
  const entry = {node};
  evidenceCache.set(id, entry);
  return entry;
}

function getQuestion(anchor) {
  for (const reviewer of reviewData.reviewers) {
    const question = reviewer.questions.find(item => item.anchor.toLowerCase() === anchor.toLowerCase());
    if (question) return {reviewer, question};
  }
  return null;
}

function resolveRoute() {
  let hash;
  try { hash = decodeURIComponent(location.hash.slice(1)); } catch (_) { hash = ''; }
  const [questionAnchor, requestedId, group] = hash.split('/');
  const requested = reviewData.evidenceAliases?.[requestedId] || requestedId;
  const match = getQuestion(questionAnchor) || getQuestion(reviewData.defaultQuestion);
  const evidence = match.question.evidence.includes(requested) ? requested : match.question.evidence[0];
  const canonical = group && Object.hasOwn(reviewData.legacyGroups, group) ? reviewData.legacyGroups[group] : group;
  if (evidence === requested && (requested !== requestedId || (group && canonical !== group))) {
    const url = new URL(location.href);
    url.hash = `${match.question.anchor}/${evidence}${canonical ? "/" + canonical : ""}`;
    history.replaceState(null, '', url);
  }
  return {...match, evidence, requested: evidence === requested ? canonical : null};
}

function navigate(questionAnchor, evidence = '') {
  const hash = questionAnchor + (evidence ? `/${evidence}` : '');
  if (location.hash.slice(1) === hash) showView();
  else location.hash = hash;
}

function renderReviewerTabs() {
  $('#reviewer-tabs').innerHTML = reviewData.reviewers.map(reviewer => `
    <button id="reviewer-tab-${reviewer.id}" class="reviewer-tab" role="tab" aria-controls="reviewer-panel" aria-selected="false" tabindex="-1" data-reviewer="${reviewer.id}">
      <span class="reviewer-name">${reviewer.id}</span><span class="reviewer-tab-description">${reviewer.questions.length} comments</span>
    </button>`).join('');
  $('#reviewer-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-reviewer]');
    if (!button) return;
    const reviewer = reviewData.reviewers.find(item => item.id === button.dataset.reviewer);
    navigate(reviewerMemory.get(reviewer.id) || reviewer.questions[0].anchor);
  });
}

function renderQuestionNav(reviewer) {
  $('#nav-reviewer').textContent = `Reviewer ${reviewer.id}`;
  $('#question-nav').innerHTML = [['W','Weaknesses'],['Q','Questions']].map(([prefix, name]) => {
    const questions = reviewer.questions.filter(question => question.key.startsWith(prefix));
    if (!questions.length) return '';
    return `<div class="question-nav-group"><p>${name}</p>${questions.map(question => `
      <a href="#${question.anchor}" data-question="${question.anchor}"><b>${question.key}</b><span>${escapeHTML(question.title)}</span></a>`).join('')}</div>`;
  }).join('');
}

function renderEvidenceTabs(question) {
  $('#evidence-tabs').innerHTML = question.evidence.map(id => {
    const {label, code} = reviewData.evidence[id];
    return `<button id="evidence-tab-${id}" role="tab" aria-controls="evidence-panel" aria-selected="false" tabindex="-1" data-evidence-tab="${id}"><b>${escapeHTML(code)}</b><span>${escapeHTML(label)}</span></button>`;
  }).join('');
}

function showView() {
  const view = resolveRoute();
  const reviewerChanged = !currentView || currentView.reviewer.id !== view.reviewer.id;
  const questionChanged = !currentView || currentView.question.anchor !== view.question.anchor;
  const evidenceChanged = !currentView || currentView.evidence !== view.evidence || currentView.requested !== view.requested;
  if (questionChanged || evidenceChanged) for (const player of players) player.pause();
  if (reviewerChanged) {
    renderQuestionNav(view.reviewer);
  }
  $$('#reviewer-tabs [role="tab"]').forEach(button => {
    const selected = button.dataset.reviewer === view.reviewer.id;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  $('#reviewer-panel').setAttribute('aria-labelledby', `reviewer-tab-${view.reviewer.id}`);
  $$('#question-nav a').forEach(link => {
    const selected = link.dataset.question === view.question.anchor;
    link.classList.toggle('selected', selected);
    if (selected) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  });
  if (questionChanged) {
    $('#question-category').textContent = `Reviewer ${view.reviewer.id} · ${view.question.key}`;
    $('#question-title').textContent = view.question.title;
    $('#review-comment').textContent = view.question.comment;
    $('#review-comment-details').open = false;
    $('#question-intro').textContent = view.question.intro;
    $('#copy-question').dataset.anchor = view.question.anchor;
    const supporting = $('.evidence-section');
    supporting.hidden = view.question.evidence.length === 0;
    $('#evidence-count').textContent = view.question.evidence.length === 0 ? '' : view.question.evidence.length === 1 ? '1 result' : `${view.question.evidence.length} results`;
    renderEvidenceTabs(view.question);
    const index = view.reviewer.questions.indexOf(view.question);
    $('#previous-question').disabled = index === 0;
    $('#next-question').disabled = index === view.reviewer.questions.length - 1;
    $('#previous-question').textContent = index ? `← ${view.reviewer.questions[index-1].key}` : '← Previous';
    $('#next-question').textContent = index < view.reviewer.questions.length-1 ? `${view.reviewer.questions[index+1].key} →` : 'Next →';
    $('#question-position').textContent = `${index+1} of ${view.reviewer.questions.length} comments`;
  }
  $$('#evidence-tabs [role="tab"]').forEach(button => {
    const selected = button.dataset.evidenceTab === view.evidence;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  const host = $('#evidence-host');
  if (view.evidence) {
    $('#evidence-panel').setAttribute('aria-labelledby', `evidence-tab-${view.evidence}`);
    const entry = getEvidence(view.evidence, view.question.anchor);
    if (host.firstElementChild !== entry.node) {
      if (host.firstElementChild) $('#evidence-store').append(host.firstElementChild);
      host.append(entry.node);
    }
  } else {
    $('#evidence-panel').removeAttribute('aria-labelledby');
    if (host.firstElementChild) $('#evidence-store').append(host.firstElementChild);
  }
  $('#question-panel').hidden = false;
  reviewerMemory.set(view.reviewer.id, view.question.anchor);
  currentView = view;
  document.title = `Supplementary results · ${view.reviewer.id} ${view.question.key}`;
  if (questionChanged) window.scrollTo({top:0, behavior:'instant'});
  if (view.requested) {
    const group = document.getElementById(view.requested);
    if (group && host.contains(group)) {
      const details = group.closest('details');
      if (details) details.open = true;
      requestAnimationFrame(() => group.scrollIntoView({block:'start'}));
    }
  }
}

function bindKeyboardTabs(selector) {
  $(selector).addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const tabs = $$('[role="tab"]', $(selector));
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (index + (event.key==='ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  });
}

async function initialize() {
  try {
    const response = await fetch('data/results.json?v=20261113-results');
    if (!response.ok) throw new Error('Supplement data unavailable');
    reviewData = await response.json();
    $('.skip-link').addEventListener('click', event => {
      event.preventDefault();
      $('#main').focus();
    });
    $('#evidence-tabs').addEventListener('click', event => {
      const button = event.target.closest('[data-evidence-tab]');
      if (button) navigate(currentView.question.anchor, button.dataset.evidenceTab);
    });
    for (const [selector, offset] of [['#previous-question',-1],['#next-question',1]]) {
      $(selector).addEventListener('click', () => {
        const index = currentView.reviewer.questions.indexOf(currentView.question) + offset;
        const next = currentView.reviewer.questions[index];
        if (next) navigate(next.anchor);
      });
    }
    renderReviewerTabs();
    bindKeyboardTabs('#reviewer-tabs');
    bindKeyboardTabs('#evidence-tabs');
    $('#load-status').textContent = '';
    showView();
    window.addEventListener('hashchange', showView);
    document.addEventListener('visibilitychange', () => { if (document.hidden) for (const player of players) player.pause(); });
  } catch (error) {
    $('#load-status').textContent = 'Review comments or results could not be loaded. Please reload the page.';
    console.error(error);
  }
}

initialize();

