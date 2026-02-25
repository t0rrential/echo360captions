(function () {
  const originalFetch = window.fetch;

  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);

    if (url.includes('/transcript')) {
      promise.then(function (response) {
        response.clone().json().then(function (data) {
          const cues = data?.data?.contentJSON?.cues;
          if (Array.isArray(cues)) {
            window.postMessage({ type: 'ECHO360_TRANSCRIPT', cues: cues }, '*');
          }
        }).catch(function () {});
      }).catch(function () {});
    }

    return promise;
  };
})();
