(function () {
  let cues = [];
  let activeOverlayIndex = 0;  // -1 = off, 0/1/... = which feed has captions
  let userChose = false;        // true when user explicitly picked a feed from the menu
  const overlays = [];
  let ccMenu = null;
  let isMovable = false;          // true = captions can be dragged
  const captionMoved = [];        // captionMoved[i] = true if overlay i was dragged from default

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

  // ── 3. Layout detection ────────────────────────────────────────────────────
  function getActiveLayout() {
    var el = document.querySelector('[id^="layout-control-menu-"][aria-selected="true"]');
    if (!el) return 'unknown';
    var id = el.id;
    if (id.indexOf('Featured Speaker') !== -1) return 'featured-speaker';
    if (id.indexOf('Featured') !== -1)          return 'featured';
    if (id.indexOf('Picture In Picture') !== -1) return 'pip';
    if (id.indexOf('Split - Horizontal') !== -1) return 'split-horizontal';
    if (id.indexOf('Split - Vertical') !== -1)   return 'split-vertical';
    if (id.indexOf('Grid') !== -1)               return 'grid';
    return 'unknown';
  }

  // ── 4. Spotlight detection ─────────────────────────────────────────────────
  // In Featured, Featured Speaker, and PiP layouts, one VideoWrapper is in a
  // dedicated spotlight container. Returns the index in `overlays` that belongs
  // to the spotlight, or 0 as a safe fallback.
  function getSpotlightOverlayIndex() {
    var spotlightSelectors = [
      '[data-test-id="FeaturedSpotlightContainer"]',  // Featured
      '[data-test-id="Spotlight-container"]',          // Featured Speaker (PIP)
      '[data-test-id="SpotlightContainer"]',           // Picture-in-Picture
    ];
    for (var s = 0; s < spotlightSelectors.length; s++) {
      var spotlight = document.querySelector(spotlightSelectors[s]);
      if (!spotlight) continue;
      var cap = spotlight.querySelector('.echo360-caption-container');
      if (!cap) continue;
      var ov = cap.querySelector('.echo360-caption-overlay');
      if (!ov) continue;
      var idx = overlays.indexOf(ov);
      if (idx !== -1) return idx;
    }
    return 0;
  }

  // ── 5. Feed label for a given overlay index ────────────────────────────────
  // Tries to read the source-selector button text from the VideoWrapper so the
  // menu label matches what the player itself calls each feed.
  function getOverlayLabel(index) {
    var wrappers = document.querySelectorAll('[data-test-component="VideoWrapper"]');
    if (index < wrappers.length) {
      var span = wrappers[index].querySelector('[id$="-source-selector-menubutton"] span');
      if (span && span.textContent.trim()) {
        return span.textContent.trim();
      }
    }
    // Context-aware fallback based on layout
    var layout = getActiveLayout();
    if (layout === 'featured' || layout === 'featured-speaker' || layout === 'pip') {
      return index === getSpotlightOverlayIndex() ? 'Featured' : 'Secondary';
    }
    return 'Video ' + (index + 1);
  }

  // ── 6. Set the active overlay (single authoritative setter) ────────────────
  function setActiveOverlay(index) {
    // Clear previously active overlay
    if (activeOverlayIndex >= 0 && overlays[activeOverlayIndex]) {
      overlays[activeOverlayIndex].style.display = 'none';
      overlays[activeOverlayIndex].textContent = '';
    }
    activeOverlayIndex = index;
    var btn = document.getElementById('echo360-cc-btn');
    if (btn) updateCCButton(btn);
  }

  // ── 6b. Movable helpers ─────────────────────────────────────────────────────
  function enableMovable(overlay) {
    if (!overlay) return;
    overlay.style.pointerEvents = 'auto';
    overlay.style.cursor = 'grab';
    if (!overlay._dragHandler) {
      overlay._dragHandler = function (e) { startDrag(overlay, e); };
    }
    overlay.addEventListener('mousedown', overlay._dragHandler);
  }

  function disableMovable(overlay) {
    if (!overlay) return;
    overlay.style.pointerEvents = 'none';
    overlay.style.cursor = '';
    if (overlay._dragHandler) {
      overlay.removeEventListener('mousedown', overlay._dragHandler);
    }
  }

  function startDrag(overlay, e) {
    if (e.button !== 0) return;   // left-click only
    e.preventDefault();
    e.stopPropagation();

    var container = overlay.parentElement;  // .echo360-caption-container
    var containerRect = container.getBoundingClientRect();
    var overlayRect   = overlay.getBoundingClientRect();

    // Current top-left of overlay relative to container
    var startX = overlayRect.left - containerRect.left;
    var startY = overlayRect.top  - containerRect.top;

    // Switch from bottom/%/transform to explicit top/left px
    overlay.style.bottom    = '';
    overlay.style.transform = '';
    overlay.style.left      = startX + 'px';
    overlay.style.top       = startY + 'px';
    overlay.style.cursor    = 'grabbing';

    var startMouseX = e.clientX;
    var startMouseY = e.clientY;
    var overlayW    = overlayRect.width;
    var overlayH    = overlayRect.height;

    function onMove(ev) {
      var dx = ev.clientX - startMouseX;
      var dy = ev.clientY - startMouseY;
      var newX = startX + dx;
      var newY = startY + dy;

      // Clamp inside container
      var maxX = containerRect.width  - overlayW;
      var maxY = containerRect.height - overlayH;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      overlay.style.left = newX + 'px';
      overlay.style.top  = newY + 'px';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      overlay.style.cursor = 'grab';

      var idx = overlays.indexOf(overlay);
      if (idx !== -1) {
        captionMoved[idx] = true;
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  function resetCaptionPosition(overlayIndex) {
    var overlay = overlays[overlayIndex];
    if (!overlay) return;
    overlay.style.bottom    = '8%';
    overlay.style.left      = '50%';
    overlay.style.top       = '';
    overlay.style.transform = 'translateX(-50%)';
    captionMoved[overlayIndex] = false;
  }

  // ── 7. Inject caption container + overlay into a VideoWrapper ───────────────
  function injectOverlay(wrapper) {
    var existingContainer = wrapper.querySelector('.echo360-caption-container');
    if (existingContainer) {
      // Container already in DOM — sync its overlay back into the tracking array
      // if it was lost (e.g. overlays[] cleared during a partial layout reset).
      var existingOverlay = existingContainer.querySelector('.echo360-caption-overlay');
      if (existingOverlay && overlays.indexOf(existingOverlay) === -1) {
        overlays.push(existingOverlay);
      }
      return;
    }

    if (getComputedStyle(wrapper).position === 'static') {
      wrapper.style.position = 'relative';
    }

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

  // ── 8. CC button ───────────────────────────────────────────────────────────
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
    btn.title = 'Caption options';
    btn.setAttribute('aria-haspopup', 'true');
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

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (ccMenu) {
        hideCCMenu();
      } else {
        showCCMenu(btn);
      }
    });

    updateCCButton(btn);
    transcriptBtn.parentElement.insertBefore(btn, transcriptBtn);
  }

  // ── 9. CC dropdown menu ────────────────────────────────────────────────────
  // Reads the computed style of Echo360's own menu element so the popup looks
  // native. Falls back to a matching dark theme if the menu isn't accessible.
  function getMenuTheme() {
    // Echo360's menus share the class sc-hSdWYo (styled-components base)
    var ref = document.querySelector('ul[role="menu"]');
    if (ref) {
      var s = getComputedStyle(ref);
      var bg = s.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        return {
          background:   bg,
          color:        s.color || '#ffffff',
          borderRadius: s.borderRadius || '6px',
          border:       s.border || 'none',
          boxShadow:    s.boxShadow || '0 4px 20px rgba(0,0,0,0.5)',
        };
      }
    }
    return {
      background:   '#1c1c1c',
      color:        '#ffffff',
      borderRadius: '6px',
      border:       '1px solid rgba(255,255,255,0.12)',
      boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
    };
  }

  function buildMenuItem(label, isActive, theme, onClick) {
    var li = document.createElement('li');
    li.setAttribute('role', 'none');

    var btn = document.createElement('button');
    btn.setAttribute('role', 'menuitem');
    btn.type = 'button';
    Object.assign(btn.style, {
      display:        'flex',
      alignItems:     'center',
      gap:            '8px',
      width:          '100%',
      padding:        '8px 14px',
      background:     isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
      color:          theme.color,
      border:         'none',
      borderLeft:     isActive ? '2px solid #5eb3e4' : '2px solid transparent',
      fontFamily:     'inherit',
      fontSize:       '0.85rem',
      cursor:         'pointer',
      textAlign:      'left',
      whiteSpace:     'nowrap',
    });

    // Checkmark for selected state
    var check = document.createElement('span');
    check.textContent = isActive ? '✓' : ' ';
    check.setAttribute('aria-hidden', 'true');
    Object.assign(check.style, {
      width:    '1em',
      flexShrink: '0',
      color:    '#5eb3e4',
    });

    var text = document.createElement('span');
    text.textContent = label;

    btn.appendChild(check);
    btn.appendChild(text);

    btn.addEventListener('mouseenter', function () {
      if (!isActive) btn.style.background = 'rgba(255,255,255,0.06)';
    });
    btn.addEventListener('mouseleave', function () {
      if (!isActive) btn.style.background = 'transparent';
    });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      onClick();
      hideCCMenu();
    });

    li.appendChild(btn);
    return li;
  }

  function showCCMenu(triggerBtn) {
    // Re-scan so the menu always reflects all currently rendered VideoWrappers,
    // even if some were added after the initial injection pass.
    document.querySelectorAll('[data-test-component="VideoWrapper"]').forEach(injectOverlay);

    var theme = getMenuTheme();
    var rect  = triggerBtn.getBoundingClientRect();

    ccMenu = document.createElement('div');
    ccMenu.id = 'echo360-cc-menu';
    Object.assign(ccMenu.style, {
      position:     'fixed',
      bottom:       (window.innerHeight - rect.top + 6) + 'px',
      left:         rect.left + 'px',
      background:   theme.background,
      color:        theme.color,
      border:       theme.border,
      borderRadius: theme.borderRadius,
      boxShadow:    theme.boxShadow,
      fontFamily:   getComputedStyle(triggerBtn).fontFamily,
      zIndex:       '10000',
      overflow:     'hidden',
      minWidth:     '150px',
    });

    var ul = document.createElement('ul');
    ul.setAttribute('role', 'menu');
    ul.setAttribute('aria-label', 'Caption feed');
    Object.assign(ul.style, {
      listStyle: 'none',
      margin:    '0',
      padding:   '4px 0',
    });

    // One option per video feed
    for (var i = 0; i < overlays.length; i++) {
      ul.appendChild(buildMenuItem(
        getOverlayLabel(i),
        activeOverlayIndex === i,
        theme,
        (function (idx) {
          return function () { userChose = true; setActiveOverlay(idx); };
        }(i))
      ));
    }

    // Separator
    var sep = document.createElement('li');
    sep.setAttribute('role', 'separator');
    Object.assign(sep.style, {
      height:     '1px',
      background: 'rgba(255,255,255,0.1)',
      margin:     '3px 0',
    });
    ul.appendChild(sep);

    // Off option
    ul.appendChild(buildMenuItem(
      'Off',
      activeOverlayIndex === -1,
      theme,
      function () { userChose = false; setActiveOverlay(-1); }
    ));

    ccMenu.appendChild(ul);
    document.body.appendChild(ccMenu);

    // Prevent menu from going off-screen to the right
    var menuRect = ccMenu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      ccMenu.style.left  = 'auto';
      ccMenu.style.right = '8px';
    }

    triggerBtn.setAttribute('aria-expanded', 'true');

    // Keyboard: close on Escape
    ccMenu._keyHandler = function (e) {
      if (e.key === 'Escape') hideCCMenu();
    };
    document.addEventListener('keydown', ccMenu._keyHandler);

    // Click outside to close (deferred so this click doesn't immediately close)
    ccMenu._outsideClick = function (e) {
      if (ccMenu && !ccMenu.contains(e.target) && e.target !== triggerBtn) {
        hideCCMenu();
      }
    };
    setTimeout(function () {
      document.addEventListener('click', ccMenu._outsideClick);
    }, 0);
  }

  function hideCCMenu() {
    if (!ccMenu) return;
    if (ccMenu._keyHandler)    document.removeEventListener('keydown', ccMenu._keyHandler);
    if (ccMenu._outsideClick)  document.removeEventListener('click',   ccMenu._outsideClick);
    ccMenu.remove();
    ccMenu = null;

    var btn = document.getElementById('echo360-cc-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  // ── 10. Auto-switch captions to the spotlight in featured layouts ───────────
  // Called after every overlay injection pass. In Featured / Featured-Speaker /
  // PiP layouts the first VideoWrapper in DOM order is always the spotlight, so
  // `overlays[0]` tracks it automatically after a reset. This function also
  // catches the case where React *moves* (rather than remounts) VideoWrapper
  // nodes between containers, keeping overlays connected but changing which one
  // is in the spotlight without triggering a count change.
  function syncSpotlightActive() {
    var layout = getActiveLayout();
    if (layout !== 'featured' && layout !== 'featured-speaker' && layout !== 'pip') return;

    // Don't override a deliberate "Off" choice.
    if (activeOverlayIndex === -1) return;

    // Don't override an explicit user choice (resets on layout switch).
    if (userChose) return;

    var spotlightIdx = getSpotlightOverlayIndex();
    if (spotlightIdx === activeOverlayIndex) return;  // already correct

    setActiveOverlay(spotlightIdx);
  }

  // ── 11. MutationObserver ───────────────────────────────────────────────────
  var observer = new MutationObserver(function (mutations) {
    // Skip mutations that originate from our own injected elements so that
    // the rAF caption-text writes (60 fps) don't trigger unnecessary work.
    var hasExternalChange = mutations.some(function (m) {
      var t = m.target;
      if (!t.classList) return true;
      if (t.classList.contains('echo360-caption-overlay'))   return false;
      if (t.classList.contains('echo360-caption-container')) return false;
      if (t.id === 'echo360-cc-btn')  return false;
      if (t.id === 'echo360-cc-menu') return false;
      if (t.closest && t.closest('#echo360-cc-menu')) return false;
      return true;
    });
    if (!hasExternalChange) return;

    // Disconnected overlays mean the VideoWrapper tree was replaced (layout switch).
    if (overlays.length > 0 && overlays.some(function (o) { return !o.isConnected; })) {
      overlays.length = 0;
      activeOverlayIndex = 0;
      userChose = false;  // layout changed — let spotlight auto-select again
      hideCCMenu();
    }

    var prevCount = overlays.length;
    document.querySelectorAll('[data-test-component="VideoWrapper"]').forEach(injectOverlay);
    injectCCButton();

    // Auto-switch to spotlight whenever overlays change (layout switch / React
    // remount) AND on every external mutation when in a spotlight layout (handles
    // React moving VideoWrapper nodes without unmounting them).
    syncSpotlightActive();

    if (overlays.length !== prevCount) {
      var btn = document.getElementById('echo360-cc-btn');
      if (btn) updateCCButton(btn);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial pass for elements already in the DOM.
  document.querySelectorAll('[data-test-component="VideoWrapper"]').forEach(injectOverlay);
  injectCCButton();
  syncSpotlightActive();

  // ── 12. requestAnimationFrame caption loop ─────────────────────────────────
  function startCaptionLoop() {
    var leaderVideo = document.querySelector('video[data-test="leader"]');
    if (!leaderVideo) {
      setTimeout(startCaptionLoop, 200);
      return;
    }

    var lastCueContent = null;
    var lastActiveIndex = activeOverlayIndex;

    function tick() {
      // Re-acquire leader video reference if it has left the DOM (layout switch).
      // A detached element's currentTime is frozen, which causes captions to
      // freeze and new overlays to never receive text.
      if (!leaderVideo.isConnected) {
        var newLeader = document.querySelector('video[data-test="leader"]');
        if (!newLeader) {
          // New video not yet rendered — poll and resume.
          setTimeout(function () { requestAnimationFrame(tick); }, 200);
          return;
        }
        leaderVideo = newLeader;
        lastCueContent = null;  // force overlay refresh with live time
      }

      // If the active overlay changed (menu selection or auto-switch), clear old.
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
