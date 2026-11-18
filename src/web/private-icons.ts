// Ouahad private-area icons: one 24-unit grid, rounded 1.65-unit strokes.
const paths={
  add:'<path d="M12 5v14M5 12h14"/>',
  save:'<path d="M6 4h12v17l-6-4-6 4Z"/>',
  calendar:'<rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M7.5 3v5M16.5 3v5M3.5 10.5h17M8 15h3M14 15h2"/>',
  conflict:'<path d="m12 3 10 17H2Z"/><path d="M12 8v5M12 16v.5"/>',
  arrow:'<path d="M4 12h15M13 6l6 6-6 6"/>',
  check:'<path d="m5 12 4.5 4.5L19 7"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  exit:'<path d="M9 4H4v16h5M9 12h12M16 7l5 5-5 5"/>',
} as const;
export function icon(name:keyof typeof paths){return `<svg class="ui-icon${name==='arrow'?' directional':''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;}
