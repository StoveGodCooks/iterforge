// src/pipeline/assetTypes.js — new file
export const ASSET_TYPES = {
  // Weapons
  sword:     { category: 'weapon',    ipaWeight: 0.75, loraHint: null },
  axe:       { category: 'weapon',    ipaWeight: 0.75, loraHint: null },
  dagger:    { category: 'weapon',    ipaWeight: 0.75, loraHint: null },
  staff:     { category: 'weapon',    ipaWeight: 0.75, loraHint: null },
  
  // Characters
  hero:      { category: 'character', ipaWeight: 0.80, loraHint: 'faceid' },
  character: { category: 'character', ipaWeight: 0.80, loraHint: 'faceid' },
  
  // Creatures
  creature:  { category: 'creature',  ipaWeight: 0.78, loraHint: 'faceid' },
  beast:     { category: 'creature',  ipaWeight: 0.78, loraHint: 'faceid' },
  animal:    { category: 'creature',  ipaWeight: 0.75, loraHint: null },
  
  // Stylized
  pixel:     { category: 'stylized',  ipaWeight: 0.62, loraHint: 'pixel' },
  lowpoly:   { category: 'stylized',  ipaWeight: 0.65, loraHint: null },
  
  // Props/Environment
  prop:      { category: 'prop',      ipaWeight: 0.70, loraHint: null },
  building:  { category: 'prop',      ipaWeight: 0.65, loraHint: null },
};
