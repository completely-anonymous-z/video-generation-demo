/* Shared playback with native media audio, one audible method at a time. */
(function (global) {
// Keep sound on the media element's native output. An analyser would reroute
// audio through Web Audio and can silence local file:// media under CORS rules.
const groups = new Set();

const fmt = (value) => Number.isFinite(value) ? value.toFixed(1) : '0.0';

function createGroup(primary, followers = [], options = {}) {
  const entries = new Map([['ours', primary], ...followers.map(({ id, video }) => [id, video])]);
  const abort = new AbortController();
  const failed = new Set();
  const pauseOrigins = [];
  const pendingPlay = new Set();
  const syncSeeks = new Set();
  const lastCorrection = new Map();
  let active = new Set(options.activeMethods || entries.keys()); active.add('ours');
  let disposed = false, wanted = false, visible = true, frame = 0, lastSync = 0;
  let selectedAudio = options.audioId === undefined ? 'ours' : options.audioId;
  const g = {
    primary, entries, onTick: null, onState: null, onAudio: null, onError: null,
    get audioId() { return selectedAudio; },
    get playing() { return !primary.paused && !primary.ended; },
    get duration() { return Number.isFinite(primary.duration) ? primary.duration : 0; },
  };
  const listen = (video, event, fn) => video.addEventListener(event, fn, { signal: abort.signal });
  const notify = () => {
    if (!disposed) g.onState?.({ playing: g.playing, ended: primary.ended, error: failed.has('ours'), waiting: !primary.paused && primary.readyState < 3 });
  };
  function applyAudio() {
    entries.forEach((video, id) => { video.muted = id !== selectedAudio || !active.has(id); });
    g.onAudio?.(selectedAudio);
  }
  function claimPlayback() {
    groups.forEach((other) => { if (other !== g) other.pause(); });
  }
  const safelyPlay = (id, video) => {
    if (disposed || failed.has(id) || !active.has(id) || pendingPlay.has(id)) return;
    pendingPlay.add(id);
    video.play().catch((error) => {
      if (disposed || error.name === 'AbortError') return;
      if (error.name !== 'NotAllowedError') { failed.add(id); g.onError?.(id, 'This video could not be played.'); }
      if (id === 'ours') { g.pause(); notify(); }
    }).finally(() => pendingPlay.delete(id));
  };
  function align(force = false) {
    // The audible video is the clock: repeatedly seeking it interrupts sound.
    // Explicit seeks/start use the main timeline; ordinary drift correction
    // only adjusts muted videos, with small playback-rate changes first.
    const audible = selectedAudio ? entries.get(selectedAudio) : null;
    const clock = !force && audible && !failed.has(selectedAudio) && audible.readyState >= 2 && !audible.ended ? audible : primary;
    const t = clock.currentTime;
    const now = performance.now();
    for (const [id, video] of entries) {
      if (!active.has(id)) { video.pause(); video.playbackRate = 1; continue; }
      if (failed.has(id) || video.readyState < 1) continue;
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) continue;
      const target = Math.min(t, Math.max(0, duration - .035));
      const drift = target - video.currentTime;
      const canCorrect = video !== clock && !video.seeking;
      if (canCorrect && Math.abs(drift) > .04 && (force || (video.muted && Math.abs(drift) > .75 && now - (lastCorrection.get(video) ?? -Infinity) >= 1500))) {
        syncSeeks.add(video);
        lastCorrection.set(video, now);
        video.currentTime = target;
      }
      video.playbackRate = !force && video.muted && video !== clock && Math.abs(drift) > .08 && Math.abs(drift) <= .75
        ? (drift > 0 ? 1.03 : .97) : 1;
      if (id === 'ours') continue;
      const finished = t >= duration - .035;
      if (finished || primary.paused || !visible || !wanted) video.pause();
      else if (video.paused) safelyPlay(id, video);
    }
  }
  function paint() {
    g.onTick?.(primary.currentTime, g.duration);

  }
  function tick(now) {
    if (disposed) return;
    if (now - lastSync >= 80) { align(); lastSync = now; paint(); }
    frame = requestAnimationFrame(tick);
  }
  function startTick() { if (!frame) frame = requestAnimationFrame(tick); }
  function stopTick() {
    cancelAnimationFrame(frame); frame = 0;
  }
  g.play = () => {
    if (disposed) return;
    wanted = true;
    if (!visible) return;
    claimPlayback();
    if (primary.ended || g.duration && primary.currentTime >= g.duration - .035) g.seek(0);
    safelyPlay('ours', primary); align(true); startTick();
  };
  g.pause = () => {
    wanted = false;
    if (!primary.paused) pauseOrigins.push('controller');
    entries.forEach((video) => video.pause()); stopTick(); notify();
  };
  g.seek = (fraction) => {
    if (!g.duration || disposed) return;
    syncSeeks.delete(primary);
    primary.currentTime = Math.max(0, Math.min(g.duration - .035, fraction * g.duration));
    align(true); paint(); notify();
  };
  g.setAudio = (id) => {
    if (id && (!entries.has(id) || failed.has(id) || !active.has(id))) return;
    selectedAudio = id;
    entries.forEach(video => { video.playbackRate = 1; });
    if (g.playing) claimPlayback();
    applyAudio();
  };
  g.setActiveMethods = (ids) => {
    active = new Set(['ours', ...ids.filter((id) => entries.has(id))]);
    entries.forEach((video, id) => {
      if (!active.has(id)) video.pause();
      else if (video.preload === 'none') { video.preload = 'metadata'; video.load(); }
    });
    if (selectedAudio && !active.has(selectedAudio)) selectedAudio = 'ours';
    applyAudio(); align();
  };
  g.retry = (id = 'ours') => {
    const video = entries.get(id); if (!video) return;
    failed.delete(id); video.load(); notify();
    // Retry only reloads the file; playback always requires a play action.
  };
  g.setVisible = (on) => {
    visible = on && !document.hidden;
    if (!visible) g.pause();
    else if (wanted) g.play();
  };
  g.destroy = () => {
    disposed = true; abort.abort(); stopTick();
    entries.forEach((video) => {
      video.pause(); video.muted = true; video.playbackRate = 1;
      video.removeAttribute('src'); video.load();
    });
    groups.delete(g);
  };
  entries.forEach((video, id) => {
    video.loop = false; video.autoplay = false;
    listen(video, 'volumechange', () => {
      if (!video.controls) return;
      if (!video.muted && selectedAudio !== id) g.setAudio(id);
      else if (video.muted && selectedAudio === id) g.setAudio(null);
    });
    listen(video, 'error', () => { failed.add(id); g.onError?.(id, 'This video is unavailable. Try loading it again.'); if (id === 'ours') g.pause(); });
    listen(video, 'loadedmetadata', () => { align(); paint(); });
    if (id !== 'ours') listen(video, 'seeked', () => syncSeeks.delete(video));
  });
  listen(primary, 'playing', () => {
    if (primary.paused || disposed) return;
    wanted = true; claimPlayback(); align(); startTick(); notify();
  });
  listen(primary, 'pause', () => {
    const origin = pauseOrigins.shift();
    if (!origin && !primary.ended) wanted = false;
    if (primary.paused) { entries.forEach((v, id) => { if (id !== 'ours') v.pause(); }); stopTick(); }
    notify();
  });
  ['waiting', 'canplay'].forEach((event) => listen(primary, event, notify));
  listen(primary, 'seeked', () => {
    const correction = syncSeeks.delete(primary);
    align(!correction); paint();
  });
  listen(primary, 'timeupdate', paint);
  listen(primary, 'ended', () => {
    if (options.loop === true && wanted && visible) { g.seek(0); g.play(); }
    else { g.pause(); paint(); }
  });
  applyAudio(); groups.add(g);
  return g;
}

function observeGroup(element, group) {
  let intersecting = false;
  const update = () => group.setVisible(intersecting);
  const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update(); }, { threshold: 0 });
  observer.observe(element);
  document.addEventListener('visibilitychange', update);
  return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
}

/** Compositor-driven film motion; JavaScript only eases changes in speed. */
function filmstripMotion(hero, backdrop, button) {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let requested = !preference.matches, inView = false;
  let animations = [], speed = 0, target = 0, frame = 0;
  const setSpeed = (value) => {
    speed = value;
    // Changing playback rate preserves the current frame and the reverse row.
    animations.forEach((animation) => animation.updatePlaybackRate(value));
  };
  const changeSpeed = (next, immediate = false) => {
    if (!immediate && target === next && (frame || speed === next)) return;
    cancelAnimationFrame(frame);
    frame = 0;
    target = next;
    animations = backdrop.getAnimations({ subtree: true }).filter((animation) => animation.animationName === 'filmstrip-roll');
    if (immediate) {
      setSpeed(next);
      animations.forEach((animation) => next ? animation.play() : animation.pause());
      backdrop.dataset.running = String(next > 0);
      return;
    }
    const from = speed, start = performance.now();
    const duration = next === 0 ? 900 : 700;
    setSpeed(from);
    animations.forEach((animation) => animation.play());
    backdrop.dataset.running = 'true';
    const easeSpeed = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      setSpeed(from + (next - from) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(easeSpeed);
      } else {
        frame = 0;
        if (next === 0) animations.forEach((animation) => animation.pause());
        backdrop.dataset.running = String(next > 0);
      }
    };
    frame = requestAnimationFrame(easeSpeed);
  };
  const update = () => {
    const visible = inView && !document.hidden && !preference.matches;
    // Suspend immediately when unseen or reduced motion is requested.
    changeSpeed(requested && visible ? 1 : 0, !visible);
    button.hidden = preference.matches;
    button.setAttribute('aria-pressed', String(requested));
    button.setAttribute('aria-label', requested ? 'Pause background motion' : 'Play background motion');
    button.querySelector('span').textContent = requested ? 'Pause motion' : 'Play motion';
    button.querySelector('path').setAttribute('d', requested ? 'M5 4h2v10H5zm6 0h2v10h-2z' : 'm5 3 10 6-10 6Z');
  };
  const toggle = () => { requested = !requested; update(); };
  const preferenceChanged = () => { if (preference.matches) requested = false; update(); };
  const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
  observer.observe(hero);
  button.addEventListener('click', toggle);
  document.addEventListener('visibilitychange', update);
  preference.addEventListener('change', preferenceChanged);
  update();
  return { destroy() {
    changeSpeed(0, true);
    observer.disconnect();
    button.removeEventListener('click', toggle);
    document.removeEventListener('visibilitychange', update);
    preference.removeEventListener('change', preferenceChanged);
  } };
}

global.CastAV = { fmt, createGroup, observeGroup, filmstripMotion };
})(typeof window !== 'undefined' ? window : this);
