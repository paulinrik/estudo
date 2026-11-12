(() => {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Não foi possível ativar o modo offline:', error)));
  }
})();

