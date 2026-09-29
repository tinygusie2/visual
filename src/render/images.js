// Decoded images for image paints, shared by the canvas, export and the panels. Assets never change (their id is
// their content's hash), so a decoded image can be kept for as long as the app runs.
const cache = new Map(); // asset id → { img, ready: Promise<img | null> }

export const assetUrl = asset => `data:${asset.mime};base64,${asset.data}`;

export function loadImage(id, asset) {
  let entry = cache.get(id);
  if (!entry && asset) {
    const img = new Image();
    const ready = new Promise(resolve => { img.onload = () => resolve(img); img.onerror = () => resolve(null); });
    img.src = assetUrl(asset);
    entry = { img, ready };
    cache.set(id, entry);
  }
  return entry || null;
}

// The image when it is decoded, else null (and onReady is called once it is).
export function readyImage(id, asset, onReady) {
  const entry = loadImage(id, asset);
  if (!entry) return null;
  if (entry.img.complete && entry.img.naturalWidth) return entry.img;
  if (onReady) entry.ready.then(img => { if (img) onReady(); });
  return null;
}

// ---------- adding images ----------
// Bytes → an asset { id, mime, data (base64), w, h, name }. The id is a hash of the bytes, so the same picture placed
// twice is stored once.
export async function makeAsset(bytes, mime, name = 'Image') {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const id = 'img_' + [...hash.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join('');
  const blob = new Blob([bytes], { type: mime });
  const bitmap = await createImageBitmap(blob);
  const size = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { id, mime, data, ...size, name };
}

export const imageMime = name => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' })[String(name).split('.').pop().toLowerCase()] || null;
