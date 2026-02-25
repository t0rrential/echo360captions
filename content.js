(function () {
  let cues = [];          // sorted array of {startMs, endMs, content}
  let captionsEnabled = true;
  const overlays = [];    // all injected overlay divs

  // ── 1. Receive transcript cues ─────────────────────────────────────────────
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'ECHO360_TRANSCRIPT') return;

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

  // (DOM injection and rAF loop come in Tasks 4 and 5)

  function startCaptionLoop() {
    // placeholder — implemented in Task 5
    console.log('[Echo360 Captions] cues loaded:', cues.length);
  }
})();
