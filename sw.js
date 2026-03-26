self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('message', e => {
  if (e.data?.type === 'NOTIF') {
    const { nombres, count, turno } = e.data;
    const hora = turno === 'manana' ? '9:00 AM' : turno === 'urgentes' ? '10:00 AM' : '2:30 PM';
    const body = count === 1
      ? `Escríbele a ${nombres[0]}`
      : `${nombres.slice(0,2).join(', ')}${count > 2 ? ` y ${count-2} más` : ''}`;
    e.waitUntil(
      self.registration.showNotification(`Eunoia Shop 📦 — ${count} pendiente${count!==1?'s':''}`, {
        body: body + ` (${hora})`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'seg-' + turno,
        renotify: true,
        vibrate: [200, 100, 200],
        requireInteraction: false
      })
    );
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'GO_SEGUIMIENTO' });
          return;
        }
      }
      clients.openWindow('/');
    })
  );
});
