import * as THREE from 'three';
import { createBooster } from './booster.js';
import { createShip } from './ship.js';

// Same numbers as blender/build_models.py: the hot-stage ring's top flange (BODY_TOP + 4) and the ship's aft
// end (SHIP_SKIRT), both relative to that vehicle's catch pins.
const RING_TOP = 12;
const SHIP_SKIRT = -32.9;

/** Height of the ship's catch pins above the booster's. */
export const SHIP_Y = RING_TOP - SHIP_SKIRT;
/** The booster's heat shield (SHIELD_Y in blender/build_models.py), the plane it stands on. */
export const SHIELD_Y = -64.6;

/**
 * The ship stacked on the booster at the hot-stage ring, built from the same models the game flies.
 * The origin is the booster's catch-pin underside, as for createBooster. models: loadModels()'s result.
 */
export function createStack(boosterMats, shipMats, models = null) {
  const booster = createBooster(boosterMats, models?.booster);
  const ship = createShip(shipMats, models?.ship);
  ship.root.position.y = SHIP_Y;
  const root = new THREE.Group();
  root.add(booster.root, ship.root);
  return { root, booster, ship };
}
