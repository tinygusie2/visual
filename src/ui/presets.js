// Frame sizes offered by the frame tool and the "Size preset" menu, and the templates on the start screen.
export const framePresets = [
  { group: 'Phone', items: [{ name: 'iPhone 15', w: 393, h: 852 }, { name: 'Phone', w: 390, h: 844 }, { name: 'Android', w: 412, h: 915 }] },
  { group: 'Tablet', items: [{ name: 'Tablet', w: 768, h: 1024 }, { name: 'iPad Pro 11"', w: 834, h: 1194 }] },
  { group: 'Desktop', items: [{ name: 'Desktop', w: 1280, h: 720 }, { name: 'MacBook', w: 1440, h: 900 }, { name: 'Full HD', w: 1920, h: 1080 }] },
  { group: 'Social post', items: [{ name: 'Square', w: 1080, h: 1080 }, { name: 'Portrait', w: 1080, h: 1350 }, { name: 'Story', w: 1080, h: 1920 }] }
];

// kind is used for the picture on the template card.
export const templates = [
  { id: 'blank', name: 'Blank', note: 'Infinite canvas' },
  { id: 'desktop', name: 'Desktop', w: 1440, h: 900 },
  { id: 'phone', name: 'Phone', w: 390, h: 844 },
  { id: 'tablet', name: 'Tablet', w: 768, h: 1024 },
  { id: 'presentation', name: 'Presentation', w: 1920, h: 1080 },
  { id: 'poster', name: 'Poster', w: 1414, h: 2000 },
  { id: 'social', name: 'Social post', w: 1080, h: 1080 },
  { id: 'story', name: 'Story', w: 1080, h: 1920 },
  { id: 'thumbnail', name: 'YouTube thumbnail', w: 1280, h: 720 },
  { id: 'custom', name: 'Custom size' }
];
