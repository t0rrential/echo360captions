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
      .filter(c => c.startMs != null && c.endMs != null && c.content)
      .sort(function (a, b) { return a.startMs - b.startMs; });

    startCaptionLoop();
  });

  // ── 2. Binary search cue array ─────────────────────────────────────────────
  function findCue(timeMs) {
    let lo = 0;
    let hi = cues.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cue = cues[mid];
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

  // ── 3. Inject caption overlay into a VideoWrapper ──────────────────────────
  function injectOverlay(wrapper) {
    if (wrapper.querySelector('.echo360-caption-overlay')) return;

    if (getComputedStyle(wrapper).position === 'static') {
      wrapper.style.position = 'relative';
    }

    const overlay = document.createElement('div');
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

    wrapper.appendChild(overlay);
    overlays.push(overlay);
  }

  // ── 4. CC button ───────────────────────────────────────────────────────────
  function updateCCButton(btn) {
    const isOff = activeOverlayIndex === -1;
    btn.setAttribute('aria-pressed', String(!isOff));
    btn.style.opacity = isOff ? '0.4' : '1';
    btn.textContent = (!isOff && overlays.length > 1)
      ? 'CC ' + (activeOverlayIndex + 1)
      : 'CC';
  }

  function injectCCButton() {
    if (document.getElementById('echo360-cc-btn')) return;

    const transcriptBtn = document.querySelector('[data-testid="transcript-button"]');
    if (!transcriptBtn) return;

    const btn = document.createElement('button');
    btn.id   = 'echo360-cc-btn';
    btn.type = 'button';
    btn.title = 'Toggle Captions';
    btn.setAttribute('aria-pressed', 'true');

    const ref = getComputedStyle(transcriptBtn);
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
      const total = overlays.length;
      if (total === 0) return;

      // Clear current active overlay
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

  // ── 5. MutationObserver to handle React async rendering ───────────────────
  const observer = new MutationObserver(function () {
    document.querySelectorAll('[data-test-component="VideoWrapper"]').forEach(injectOverlay);
    injectCCButton();
    const btn = document.getElementById('echo360-cc-btn');
    if (btn) updateCCButton(btn);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.querySelectorAll('[data-test-component="VideoWrapper"]').forEach(injectOverlay);
  injectCCButton();

  // ── 6. requestAnimationFrame loop ─────────────────────────────────────────
  function startCaptionLoop() {
    const leaderVideo = document.querySelector('video[data-test="leader"]');
    if (!leaderVideo) {
      setTimeout(startCaptionLoop, 200);
      return;
    }

    let lastCueContent = null;
    let lastActiveIndex = activeOverlayIndex;

    function tick() {
      // If active feed changed, clear the old overlay
      if (lastActiveIndex !== activeOverlayIndex) {
        if (lastActiveIndex >= 0 && overlays[lastActiveIndex]) {
          overlays[lastActiveIndex].style.display = 'none';
          overlays[lastActiveIndex].textContent = '';
        }
        lastCueContent = null;
        lastActiveIndex = activeOverlayIndex;
      }

      if (activeOverlayIndex >= 0 && cues.length > 0) {
        const timeMs = leaderVideo.currentTime * 1000;
        const cue = findCue(timeMs);
        const text = cue ? cue.content : '';

        if (text !== lastCueContent) {
          lastCueContent = text;
          const overlay = overlays[activeOverlayIndex];
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
