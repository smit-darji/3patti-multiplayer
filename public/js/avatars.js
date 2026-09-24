/**
 * High-Quality Human Casino Avatars for Teen Patti Royale
 * Generates clean Base64 SVG data URIs to avoid any HTML quote corruption.
 */
const HumanAvatars = {
  list: [
    { id: 'human-1', name: 'Raj Malhotra', title: 'Tuxedo VIP', gender: 'M', skin: '#f5d0b0', hair: '#1c1917', clothes: '#0f172a', accent: '#d4af37', glasses: false },
    { id: 'human-2', name: 'Priya Sharma', title: 'Royale Queen', gender: 'F', skin: '#e5b88f', hair: '#451a03', clothes: '#b91c1c', accent: '#fbbf24', jewelry: 'ruby' },
    { id: 'human-3', name: 'Kabir Khan', title: 'Poker Shark', gender: 'M', skin: '#d4a373', hair: '#171717', clothes: '#18181b', accent: '#06b6d4', glasses: true },
    { id: 'human-4', name: 'Ananya Roy', title: 'Diamond Lady', gender: 'F', skin: '#faedcd', hair: '#262626', clothes: '#047857', accent: '#34d399', jewelry: 'emerald' },
    { id: 'human-5', name: 'Vikram Singhania', title: 'High Roller Tycoon', gender: 'M', skin: '#e8c49e', hair: '#94a3b8', clothes: '#1e3a8a', accent: '#ffd700', beard: true },
    { id: 'human-6', name: 'Riya Sen', title: 'Ace Empress', gender: 'F', skin: '#fed0bb', hair: '#78350f', clothes: '#701a75', accent: '#f472b6', jewelry: 'sapphire' },
    { id: 'human-7', name: 'Arjun Mehta', title: 'Vegas Pro', gender: 'M', skin: '#d49b6a', hair: '#18181b', clothes: '#831843', accent: '#f43f5e', glasses: false },
    { id: 'human-8', name: 'Sunita Patel', title: 'Golden Flash', gender: 'F', skin: '#e2b186', hair: '#171717', clothes: '#ca8a04', accent: '#fef08a', jewelry: 'gold' },
    { id: 'human-9', name: 'Dev Anand', title: 'Monte Carlo Maestro', gender: 'M', skin: '#efc197', hair: '#292524', clothes: '#0f766e', accent: '#2dd4bf', beard: true },
    { id: 'human-10', name: 'Neha Kapoor', title: 'High Stakes Diva', gender: 'F', skin: '#fcd5ce', hair: '#312e81', clothes: '#4338ca', accent: '#818cf8', jewelry: 'diamond' }
  ],

  getSvg(avatarId) {
    const cleanId = String(avatarId || '').replace('avatar-', 'human-');
    const av = this.list.find(a => a.id === avatarId || a.id === cleanId) || this.list[0];
    const isMale = av.gender === 'M';

    // Build SVG character
    let hairSvg = '';
    if (isMale) {
      hairSvg = `<path d="M26 38 C24 20, 76 20, 74 38 C70 24, 30 24, 26 38 Z" fill="${av.hair}"/>`;
      if (av.beard) {
        hairSvg += `<path d="M38 64 C44 72, 56 72, 62 64 C60 67, 40 67, 38 64 Z" fill="${av.hair}" opacity="0.8"/>`;
      }
    } else {
      hairSvg = `
        <path d="M22 46 C20 18, 80 18, 78 46 C76 60, 78 68, 74 72 C70 54, 72 32, 66 26 C50 20, 36 26, 26 34 C24 44, 24 60, 22 72 C20 66, 20 54, 22 46 Z" fill="${av.hair}"/>
      `;
    }

    let accessoriesSvg = '';
    if (av.glasses) {
      accessoriesSvg += `
        <!-- Cool aviator glasses -->
        <rect x="33" y="42" width="14" height="10" rx="3" fill="#0f172a" stroke="#d4af37" stroke-width="1.5"/>
        <rect x="53" y="42" width="14" height="10" rx="3" fill="#0f172a" stroke="#d4af37" stroke-width="1.5"/>
        <line x1="47" y1="46" x2="53" y2="46" stroke="#d4af37" stroke-width="1.5"/>
      `;
    } else {
      // Eyes
      accessoriesSvg += `
        <ellipse cx="40" cy="46" rx="3" ry="2.5" fill="#1c1917"/>
        <ellipse cx="60" cy="46" rx="3" ry="2.5" fill="#1c1917"/>
        <circle cx="41" cy="45" r="0.8" fill="#ffffff"/>
        <circle cx="61" cy="45" r="0.8" fill="#ffffff"/>
      `;
    }

    // Lips & smile
    const smileSvg = `<path d="M44 58 Q50 63 56 58" stroke="#be123c" stroke-width="2" fill="none" stroke-linecap="round"/>`;

    // Clothes / Collar
    const clothesSvg = `
      <path d="M20 100 C20 74, 38 70, 50 72 C62 70, 80 74, 80 100 Z" fill="${av.clothes}"/>
      <path d="M44 72 L50 84 L56 72 Z" fill="${av.accent}"/>
      <path d="M50 84 L46 100 L54 100 Z" fill="#ffffff"/>
    `;

    const svgString = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <!-- Background circle with VIP border -->
        <defs>
          <linearGradient id="bgGrad_${av.id}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
          <linearGradient id="goldBorder" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffd700"/>
            <stop offset="50%" stop-color="#b8860b"/>
            <stop offset="100%" stop-color="#ffd700"/>
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#bgGrad_${av.id})" stroke="url(#goldBorder)" stroke-width="3"/>
        
        <!-- Clothes / Shoulders -->
        ${clothesSvg}

        <!-- Neck -->
        <rect x="44" y="58" width="12" height="16" rx="4" fill="${av.skin}"/>

        <!-- Head / Face -->
        <ellipse cx="50" cy="48" rx="19" ry="22" fill="${av.skin}"/>

        <!-- Hair -->
        ${hairSvg}

        <!-- Eyes / Glasses -->
        ${accessoriesSvg}

        <!-- Eyebrows -->
        <path d="M36 40 Q40 38 44 40" stroke="${av.hair}" stroke-width="1.8" fill="none"/>
        <path d="M56 40 Q60 38 64 40" stroke="${av.hair}" stroke-width="1.8" fill="none"/>

        <!-- Nose -->
        <path d="M50 48 L48 53 L51 53" stroke="#d97706" stroke-width="1.2" fill="none" stroke-linecap="round"/>

        <!-- Smile -->
        ${smileSvg}
      </svg>
    `.trim();

    // Return safely as Base64 data URI (100% immune to HTML quote escaping issues!)
    const base64 = btoa(unescape(encodeURIComponent(svgString)));
    return `data:image/svg+xml;base64,${base64}`;
  }
};

window.HumanAvatars = HumanAvatars;
