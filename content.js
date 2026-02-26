(function () {
  let cues = [];
  let activeOverlayIndex = 0;  // -1 = off, 0/1/... = which feed has captions
  const overlays = [];

  // ── 0. Warn if no transcript arrives within 10 seconds ────────────────────
  const transcriptTimeout = setTimeout(function () {
    if (cues.length === 0) {
      console.log('[Echo360 Captions] No transcript received — lecture may not have one.');
    }
  }, 10000);

  // ── 1. Receive transcript cues ─────────────────────────────────────────────
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'ECHO360_TRANSCRIPT') return;

    clearTimeout(transcriptTimeout);

    cues = event.data.cues
      .filter(function (c) { return c.startMs != null && c.endMs != null && c.content; })
      .sort(function (a, b) { return a.startMs - b.startMs; });

    startCaptionLoop();
  });

  // ── 2. Binary search cue array ─────────────────────────────────────────────
  function findCue(timeMs) {
    var lo = 0;
    var hi = cues.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var cue = cues[mid];
      if (timeMs < cue.startMs) {
        hi = mid - 1;
      } else if (timeMs > cue.endMs) {
        lo = mid + 1;
      } else {
        return cue;
      }
    }
    return null;
  }

  // ── 3. Detect current layout mode ──────────────────────────────────────────
  // Reads the active layout from the layout menu's aria-selected state.
  // The first VideoWrapper in the DOM is always the primary (spotlight) video
  // in every layout, so layout detection informs context but does not change
  // which overlay is index 0.
  function getActiveLayout() {
    var el = document.querySelector('[id^="layout-control-menu-"][aria-selected="true"]');
    if (!el) return 'unknown';
    var id = el.id;
    if (id.indexOf('Featured Speaker') !== -1) return 'featured-speaker';
    if (id.indexOf('Featured') !== -1)         return 'featured';
    if (id.indexOf('Picture In Picture') !== -1) return 'pip';
    if (id.indexOf('Split - Horizontal') !== -1) return 'split-horizontal';
    if (id.indexOf('Split - Vertical') !== -1)   return 'split-vertical';
    if (id.indexOf('Grid') !== -1)               return 'grid';
    return 'unknown';
  }

  // ── 4. Inject caption container + overlay into a VideoWrapper ───────────────
  // Creates a positioned container that sits over the video inside VideoWrapper,
  // then floats the caption overlay absolutely inside that container.
  function injectOverlay(wrapper) {
    if (wrapper.querySelector('.echo360-caption-container')) return;

    if (getComputedStyle(wrapper).position === 'static') {
      wrapper.style.position = 'relative';
    }

    // Container covers the full VideoWrapper without affecting layout.
    // All existing children (video, source controls, playback controls) remain
    // untouched; the container sits on top, pointer-events disabled so clicks
    // pass through to the player.
    var container = document.createElement('div');
    container.className = 'echo360-caption-container';
    Object.assign(container.style, {
      position:      'absolute',
      top:           '0',
      right:         '0',
      bottom:        '0',
      left:          '0',
      pointerEvents: 'none',
      zIndex:        '9',
    });
    wrapper.appendChild(container);

    // Caption overlay floats at the bottom-centre of the container.
    var overlay = document.createElement('div');
    overlay.className = 'echo360-caption-overlay';
    Object.assign(overlay.style, {
      position:      'absolute',
      bottom:        '8%',
      left:          '50%',
      transform:     'translateX(-50%)',
      background:    'rgba(0,0,0,0.75)',
      color:         '#ffffff',
      fontFamily:    "'Proxima Nova', sans-serif",
      fontSize:      '1rem',
      lineHeight:    '1.4',
      padding:       '4px 10px',
      borderRadius:  '4px',
      maxWidth:      '80%',
      textAlign:     'center',
      wordWrap:      'break-word',
      pointerEvents: 'none',
      zIndex:        '10',
      display:       'none',
    });
    container.appendChild(overlay);

    overlays.push(overlay);
  }

  // ── 5. CC button ───────────────────────────────────────────────────────────
  function updateCCButton(btn) {
    var isOff = activeOverlayIndex === -1;
    btn.setAttribute('aria-pressed', String(!isOff));
    btn.style.opacity = isOff ? '0.4' : '1';
    btn.textContent = 'CC';
  }

  function injectCCButton() {
    if (document.getElementById('echo360-cc-btn')) return;

    var transcriptBtn = document.querySelector('[data-testid="transcript-button"]');
    if (!transcriptBtn) return;

    var btn = document.createElement('button');
    btn.id   = 'echo360-cc-btn';
    btn.type = 'button';
    btn.title = 'Toggle Captions';
    btn.setAttribute('aria-pressed', 'true');

    var ref = getComputedStyle(transcriptBtn);
    Object.assign(btn.style, {
      background:     'transparent',
      border:         'none',
      color:          ref.color,
      cursor:         'pointer',
      fontSize:       '0.8rem',
      fontWeight:     '700',
      fontFamily:     ref.fontFamily,
      height:         ref.height,
      padding:        ref.padding,
      display:        'inline-flex',
      alignItems:     'center',
      justifyContent: 'center',
      borderRadius:   ref.borderRadius,
      opacity:        '1',
    });

    btn.addEventListener('mouseenter', function () {
      btn.style.opacity = activeOverlayIndex === -1 ? '0.3' : '0.75';
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.opacity = activeOverlayIndex === -1 ? '0.4' : '1';
    });

    btn.addEventListener('click', function () {
      var total = overlays.length;
      if (total === 0) return;

      // Clear current active overlay's text
      if (activeOverlayIndex >= 0 && overlays[activeOverlayIndex]) {
        overlays[activeOverlayIndex].style.display = 'none';
        overlays[activeOverlayIndex].textContent = '';
      }

      // Cycle: 0 → 1 → ... → (total-1) → -1 (off) → 0
      if (activeOverlayIndex === -1) {
        activeOverlayIndex = 0;
      } else if (activeOverlayIndex < total - 1) {
        activeOverlayIndex++;
      } else {
        activeOverlayIndex = -1;
      }

      updateCCButton(btn);
    });

    updateCCButton(btn);
    transcriptBtn.parentElement.insertBefore(btn, transcriptBtn);
  }

  // ── 6. MutationObserver ────────────────────────────────────────────────────
  var observer = new MutationObserver(function (mutations) {
    // Ignore mutations that originate from our own injected elements.
    // This prevents the rAF caption-text writes and our own DOM insertions
    // from causing unnecessary observer work.
    var hasExternalChange = mutations.some(function (m) {
      var t = m.target;
      if (!t.classList) return true;  // text node — may be from page
      return (
        !t.classList.contains('echo360-caption-overlay') &&
        !t.classList.contains('echo360-caption-container') &&
        t.id !== 'echo360-cc-btn'
      );
    });
    if (!hasExternalChange) return;

    // If any overlay is no longer in the DOM, the layout was swapped (React
    // replaced the VideoWrapper tree). Reset and re-inject for the new layout.
    if (overlays.length > 0 && overlays.some(function (o) { return !o.isConnected; })) {
      overlays.length = 0;
      activeOverlayIndex = 0;
    }

    var prevCount = overlays.length;
    document.querySelectorAll('[data-test-component="VideoWrapper"]').forEach(injectOverlay);
    injectCCButton();

    if (overlays.length !== prevCount) {
      var btn = document.getElementById('echo360-cc-btn');
      if (btn) updateCCButton(btn);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial pass for elements already in the DOM.
  document.querySelectorAll('[data-test-component="VideoWrapper"]').forEach(injectOverlay);
  injectCCButton();

  // ── 7. requestAnimationFrame caption loop ──────────────────────────────────
  function startCaptionLoop() {
    var leaderVideo = document.querySelector('video[data-test="leader"]');
    if (!leaderVideo) {
      setTimeout(startCaptionLoop, 200);
      return;
    }

    var lastCueContent = null;
    var lastActiveIndex = activeOverlayIndex;

    function tick() {
      // If the leader video has left the DOM (layout switch), re-acquire it.
      // A detached element's currentTime is frozen, causing captions to freeze
      // and new overlays to never receive text.
      if (!leaderVideo.isConnected) {
        var newLeader = document.querySelector('video[data-test="leader"]');
        if (!newLeader) {
          // New video element not yet rendered — poll and resume shortly.
          setTimeout(function () { requestAnimationFrame(tick); }, 200);
          return;
        }
        leaderVideo = newLeader;
        lastCueContent = null;  // force overlay refresh with live time
      }

      // If the active overlay changed (CC button click), clear the old overlay.
      if (lastActiveIndex !== activeOverlayIndex) {
        if (lastActiveIndex >= 0 && overlays[lastActiveIndex]) {
          overlays[lastActiveIndex].style.display = 'none';
          overlays[lastActiveIndex].textContent = '';
        }
        lastCueContent = null;
        lastActiveIndex = activeOverlayIndex;
      }

      if (activeOverlayIndex >= 0 && cues.length > 0) {
        var timeMs = leaderVideo.currentTime * 1000;
        var cue = findCue(timeMs);
        var text = cue ? cue.content : '';

        if (text !== lastCueContent) {
          lastCueContent = text;
          var overlay = overlays[activeOverlayIndex];
          if (overlay) {
            overlay.textContent = text;
            overlay.style.display = text ? 'block' : 'none';
          }
        }
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }
})();
