// Loads the Kenney CC0 model packs in assets/ once at startup, then hands out scaled clones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LIST = {
  train: ['train-carriage-flatbed', 'train-locomotive-a', 'train-carriage-container-blue', 'train-carriage-container-red', 'train-carriage-container-green', 'train-carriage-box', 'train-carriage-tank', 'train-carriage-lumber', 'train-carriage-coal', 'track-detailed', 'train-electric-city-a', 'train-electric-city-b', 'train-electric-city-c'],
  roads: ['sign-highway-wide', 'electricity-pole', 'construction-barrier', 'construction-cone', 'construction-fence', 'construction-light', 'light-square', 'dumpster', 'road-sign-warning', 'traffic-light'],
  industrial: ['solar-panel-landscape-group', 'chimney-basic', 'detail-tank-large', 'shipping-container-a', 'shipping-container-b', 'shipping-container-c', 'water-tower', 'detail-tank', 'chimney-small', 'building-a', 'building-c', 'building-e', 'building-g', 'building-k'],
  commercial: ['detail-parasol-a', 'detail-awning-wide', 'building-b', 'building-d', 'building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e', 'building-a', 'building-c', 'building-e', 'low-detail-building-a', 'low-detail-building-c'],
  furniture: ['loungeSofa', 'loungeSofaOttoman', 'tableCoffee', 'tableCoffeeSquare', 'table', 'bookcaseOpenLow', 'bookcaseClosedWide', 'cabinetTelevision', 'televisionModern', 'lampRoundFloor', 'rugRound', 'speaker', 'plantSmall1', 'books', 'chair', 'tableRound', 'toaster', 'kitchenBlender', 'kitchenCoffeeMachine', 'kitchenMicrowave', 'bench', 'trashcan', 'pottedPlant'],
  food: ['cooking-spatula', 'bacon', 'egg-cooked', 'pancakes', 'sausage', 'bread', 'cake-birthday', 'pizza', 'burger', 'watermelon', 'donut-sprinkles', 'plate-dinner', 'glass-wine', 'cupcake', 'sundae', 'bottle-ketchup', 'bottle-musterd', 'soda', 'pie', 'sandwich', 'croissant', 'rollingPin', 'knife-block', 'mug', 'bowl', 'apple', 'orange', 'banana', 'cutting-board', 'frying-pan', 'pot', 'carton', 'cheese', 'loaf', 'shaker-salt', 'pepper-mill', 'egg-cup', 'plate', 'barrel', 'pumpkin', 'whisk', 'cup-coffee'],
  castle: ['flag-banner-long', 'siege-ram', 'siege-trebuchet', 'tower-hexagon-base', 'tower-hexagon-mid', 'tower-hexagon-roof', 'tower-square-base', 'tower-square-mid-windows', 'tower-square-top', 'tree-large', 'wall', 'wall-corner'],
  coaster: ['bench', 'coaster-train', 'coaster-train-front', 'flowers', 'grass', 'park-entrance', 'stall-drinks', 'stall-food', 'stall-information', 'stall-toilets', 'trash', 'tree-large'],
  graveyard: ['altar-stone', 'candle-multiple', 'character-ghost', 'coffin-old', 'crypt-large', 'crypt-small', 'debris', 'fire-basket', 'grave', 'gravestone-bevel', 'gravestone-broken', 'gravestone-cross', 'gravestone-cross-large', 'gravestone-decorative', 'gravestone-roof', 'gravestone-round', 'gravestone-wide', 'iron-fence', 'iron-fence-damaged', 'lightpost-double', 'pillar-obelisk', 'pine', 'pine-crooked', 'pine-fall-crooked', 'pumpkin-carved', 'pumpkin-tall-carved', 'rocks', 'shovel-dirt', 'stone-wall', 'stone-wall-damaged'],
  holiday: ['bench', 'cabin-doorway', 'cabin-roof-snow-point', 'cabin-wall', 'cabin-wall-wreath', 'cabin-window-a', 'cabin-window-b', 'lantern', 'present-a-cube', 'present-a-rectangle', 'present-a-round', 'present-b-cube', 'present-b-rectangle', 'reindeer', 'rocks-large', 'sled-long', 'snow-flat', 'snow-pile', 'snowman-hat', 'train-locomotive', 'train-tender', 'train-wagon', 'train-wagon-logs', 'tree-decorated-snow', 'tree-snow-a', 'tree-snow-b', 'tree-snow-c'],
  pirate: ['barrel', 'boat-row-large', 'boat-row-small', 'cannon', 'chest', 'crate', 'crate-bottles', 'palm-bend', 'palm-detailed-bend', 'palm-straight', 'rocks-a', 'rocks-b', 'rocks-c', 'ship-pirate-large', 'ship-pirate-medium', 'ship-wreck', 'structure-platform', 'tower-complete-large'],
  platformer: ['block-grass-large', 'block-grass-large-tall', 'block-moving-large', 'coin-gold', 'conveyor-belt', 'flag', 'flowers-tall', 'rocks', 'saw', 'spring', 'trap-spikes-large', 'tree', 'tree-pine'],
  space: ['meteor', 'meteor_detailed', 'monorail_trackStraight', 'monorail_trainCargo', 'monorail_trainFront', 'monorail_trainPassenger', 'platform_large', 'rock_largeA', 'rocket_baseA', 'rocket_fuelA', 'rocket_topA', 'satelliteDish_large'],
  station: ['computer-system', 'computer-wide', 'container', 'container-flat', 'container-tall', 'container-wide', 'floor', 'floor-detail', 'floor-panel', 'structure', 'table-display-planet', 'wall-detail', 'wall-pillar', 'wall-window'],
};
const cache = {};

export async function loadModels(onProgress = () => {}) {
  const loader = new GLTFLoader(), all = Object.entries(LIST).flatMap(([kit, names]) => names.map(n => `${kit}/${n}`));
  let done = 0;
  await Promise.all(all.map(async key => {
    try {
      const { scene } = await loader.loadAsync(`assets/${key}.glb`);
      scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.userData.shared = true; if (o.material.metalness > 0.5) o.material.metalness = 0.2; } });   // no env map: fully metallic parts would render black
      cache[key] = scene;
    } catch (e) { console.warn('model failed', key, e); }
    onProgress(++done / all.length);
  }));
}

// A clone of `key` scaled so its size along `axis` equals `size`, with its origin at the bottom centre.
// group.userData.size holds the final bounding size (for colliders). Missing models return an empty group.
const box = new THREE.Box3(), v = new THREE.Vector3();
export function model(key, size = 1, axis = 'y') {
  const g = new THREE.Group(), src = cache[key];
  g.userData.size = new THREE.Vector3(size, size, size);
  if (!src) return g;
  const m = src.clone(true);
  box.setFromObject(m); box.getSize(v);
  m.scale.setScalar(axis === 'scale' ? size : size / Math.max(v[axis], 1e-6));
  box.setFromObject(m); box.getCenter(v);
  m.position.set(-v.x, -box.min.y, -v.z);
  g.add(m); g.userData.size = box.getSize(new THREE.Vector3());
  return g;
}
