(function () {
  let cues = [];          // sorted array of {startMs, endMs, content}
  let captionsEnabled = true;
  const overlays = [];    // all injected overlay divs

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

  // ── 3. Inject caption overlay into the page ────────────────────────────────
  function injectOverlay() {
    if (document.querySelector('.echo360-caption-overlay')) return; // already injected

    const overlay = document.createElement('div');
    overlay.className = 'echo360-caption-overlay';
    Object.assign(overlay.style, {
      position:      'fixed',
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
      maxWidth:      '60%',
      textAlign:     'center',
      wordWrap:      'break-word',
      pointerEvents: 'none',
      zIndex:        '2147483647',
      display:       'none',
    });

    document.body.appendChild(overlay);
    overlays.push(overlay);
  }

  // ── 4. Inject CC toggle button into the player controls ────────────────────
  function injectCCButton() {
    if (document.getElementById('echo360-cc-btn')) return; // already injected

    const transcriptBtn = document.querySelector('[data-testid="transcript-button"]');
    if (!transcriptBtn) return; // controls not rendered yet

    const btn = document.createElement('button');
    btn.id            = 'echo360-cc-btn';
    btn.type          = 'button';
    btn.title         = 'Toggle Captions';
    btn.textContent   = 'CC';
    btn.setAttribute('aria-pressed', 'true');

    // Mirror the visual style of neighboring icon buttons
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

    btn.addEventListener('mouseenter', function () { btn.style.opacity = captionsEnabled ? '0.75' : '0.3'; });
    btn.addEventListener('mouseleave', function () { btn.style.opacity = captionsEnabled ? '1' : '0.4'; });

    btn.addEventListener('click', function () {
      captionsEnabled = !captionsEnabled;
      btn.setAttribute('aria-pressed', String(captionsEnabled));
      btn.style.opacity = captionsEnabled ? '1' : '0.4';
      if (!captionsEnabled) {
        overlays.forEach(function (o) { o.style.display = 'none'; });
      }
    });

    transcriptBtn.parentElement.insertBefore(btn, transcriptBtn);
  }

  // ── 5. MutationObserver to handle React async rendering ───────────────────
  // ── 5. MutationObserver to handle React async rendering ───────────────────
  const observer = new MutationObserver(function () {
    injectCCButton();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  injectOverlay();
  injectCCButton();

  // ── 6. requestAnimationFrame loop ─────────────────────────────────────────
  function startCaptionLoop() {
    const leaderVideo = document.querySelector('video[data-test="leader"]');
    if (!leaderVideo) {
      // Video not in DOM yet — wait and retry
      setTimeout(startCaptionLoop, 200);
      return;
    }

    let lastCueContent = null;

    function tick() {
      if (captionsEnabled && cues.length > 0) {
        const timeMs = leaderVideo.currentTime * 1000;
        const cue = findCue(timeMs);
        const text = cue ? cue.content : '';

        // Only update DOM when content changes — avoids unnecessary repaints
        if (text !== lastCueContent) {
          lastCueContent = text;
          overlays.forEach(function (overlay) {
            overlay.textContent = text;
            overlay.style.display = text ? 'block' : 'none';
          });
        }
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }
})();
