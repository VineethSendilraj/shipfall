import * as THREE from 'three';
import { ENGINE_Y } from './booster.js';

// Stacked, the ship's skirt (-32.9 m below its catch point) sits on the booster's top ring (+12 m).
export const SHIP_OFFSET = 44.9;
const BOOSTER_TOP = 12;
const SHIP_TIP = 15.5;

/** Engine plane to tip, in meters: about 128 m with the ship, 80 m for the booster alone. */
export function stackHeight(withShip) {
  return (withShip ? SHIP_OFFSET + SHIP_TIP : BOOSTER_TOP) - ENGINE_Y;
}

/**
 * The full stack for free flight: the booster (with its plume attached), and the ship on top when there is
 * one. The group's origin is the booster's catch point, as for the booster alone.
 */
export function assembleStack(booster, ship = null) {
  const root = new THREE.Group();
  root.add(booster.root);
  if (ship) {
    ship.root.position.y = SHIP_OFFSET;
    root.add(ship.root);
  }
  return root;
}
