import { api } from './api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function pushSupportato() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function statoPermesso() {
  if (!pushSupportato()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function attivaPush() {
  if (!pushSupportato()) throw new Error('Le notifiche push non sono supportate su questo dispositivo/browser.');

  const permesso = await Notification.requestPermission();
  if (permesso !== 'granted') throw new Error('Permesso per le notifiche non concesso.');

  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.get('/push/public-key');
  if (!publicKey) throw new Error('Chiave del server non disponibile.');

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON();
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return true;
}

export async function disattivaPush() {
  if (!pushSupportato()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
}
