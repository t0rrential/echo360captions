(function () {
  const originalOpen = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function (method, url) {
    if (String(url).includes('/transcript')) {
      this.addEventListener('load', function () {
        try {
          const data = JSON.parse(this.responseText);
          const cues = data?.data?.contentJSON?.cues;
          if (Array.isArray(cues)) {
            window.postMessage({ type: 'ECHO360_TRANSCRIPT', cues: cues }, '*');
          }
        } catch (e) {}
      });
    }
    return originalOpen.apply(this, arguments);
  };
})();
