import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceSensorStatus, DeviceSkyVector, DeviceSkyView } from '../types';

interface PermissionAwareDeviceOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

interface CompassDeviceOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

function detectMobileDevice() {
  return navigator.maxTouchPoints > 0
    && window.matchMedia('(hover: none) and (pointer: coarse) and (max-width: 1024px)').matches;
}

function detectPermissionPrompt() {
  if (!('DeviceOrientationEvent' in window)) return false;
  const orientationEvent = DeviceOrientationEvent as unknown as PermissionAwareDeviceOrientationEvent;
  return typeof orientationEvent.requestPermission === 'function';
}

function normalizeVector(vector: DeviceSkyVector): DeviceSkyVector {
  const length = Math.hypot(vector.east, vector.north, vector.up);
  if (length < .0001) return { east: 0, north: 0, up: 0 };
  return { east: vector.east / length, north: vector.north / length, up: vector.up / length };
}

function mixVector(previous: DeviceSkyVector, next: DeviceSkyVector, weight: number) {
  return normalizeVector({
    east: previous.east + (next.east - previous.east) * weight,
    north: previous.north + (next.north - previous.north) * weight,
    up: previous.up + (next.up - previous.up) * weight,
  });
}

function dot(left: DeviceSkyVector, right: DeviceSkyVector) {
  return left.east * right.east + left.north * right.north + left.up * right.up;
}

function cross(left: DeviceSkyVector, right: DeviceSkyVector): DeviceSkyVector {
  return normalizeVector({
    east: left.north * right.up - left.up * right.north,
    north: left.up * right.east - left.east * right.up,
    up: left.east * right.north - left.north * right.east,
  });
}

function viewFromAxes(forward: DeviceSkyVector, right: DeviceSkyVector, accuracy?: number): DeviceSkyView {
  const normalizedForward = normalizeVector(forward);
  const rightWithoutForward = {
    east: right.east - normalizedForward.east * dot(right, normalizedForward),
    north: right.north - normalizedForward.north * dot(right, normalizedForward),
    up: right.up - normalizedForward.up * dot(right, normalizedForward),
  };
  const normalizedRight = normalizeVector(rightWithoutForward);
  return {
    heading: ((Math.atan2(normalizedForward.east, normalizedForward.north) * 180 / Math.PI) % 360 + 360) % 360,
    altitude: Math.asin(Math.max(-1, Math.min(1, normalizedForward.up))) * 180 / Math.PI,
    forward: normalizedForward,
    right: normalizedRight,
    up: cross(normalizedRight, normalizedForward),
    accuracy,
  };
}

function orientationToView(event: CompassDeviceOrientationEvent): DeviceSkyView | null {
  if (event.beta === null || event.gamma === null) return null;

  const compassHeading = event.webkitCompassHeading;
  const alpha = Number.isFinite(compassHeading) ? 360 - (compassHeading as number) : event.alpha;
  if (alpha === null) return null;

  const alphaRad = alpha * Math.PI / 180;
  const betaRad = event.beta * Math.PI / 180;
  const gammaRad = event.gamma * Math.PI / 180;
  const sinAlpha = Math.sin(alphaRad);
  const cosAlpha = Math.cos(alphaRad);
  const sinBeta = Math.sin(betaRad);
  const cosBeta = Math.cos(betaRad);
  const sinGamma = Math.sin(gammaRad);
  const cosGamma = Math.cos(gammaRad);

  const deviceX = {
    east: cosAlpha * cosGamma - sinAlpha * sinBeta * sinGamma,
    north: sinAlpha * cosGamma + cosAlpha * sinBeta * sinGamma,
    up: -cosBeta * sinGamma,
  };
  const deviceY = {
    east: -sinAlpha * cosBeta,
    north: cosAlpha * cosBeta,
    up: sinBeta,
  };
  const forward = {
    east: -(cosAlpha * sinGamma + sinAlpha * sinBeta * cosGamma),
    north: -(sinAlpha * sinGamma - cosAlpha * sinBeta * cosGamma),
    up: -cosBeta * cosGamma,
  };

  const screenAngle = (screen.orientation?.angle ?? 0) * Math.PI / 180;
  const right = {
    east: deviceX.east * Math.cos(screenAngle) - deviceY.east * Math.sin(screenAngle),
    north: deviceX.north * Math.cos(screenAngle) - deviceY.north * Math.sin(screenAngle),
    up: deviceX.up * Math.cos(screenAngle) - deviceY.up * Math.sin(screenAngle),
  };
  const accuracy = Number.isFinite(event.webkitCompassAccuracy) ? event.webkitCompassAccuracy : undefined;
  return viewFromAxes(forward, right, accuracy);
}

export function useDeviceSkyView(active: boolean) {
  const [isMobile] = useState(detectMobileDevice);
  const [requiresPermissionPrompt] = useState(detectPermissionPrompt);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [status, setStatus] = useState<DeviceSensorStatus>('idle');
  const [view, setView] = useState<DeviceSkyView | null>(null);
  const smoothedRef = useRef<DeviceSkyView | null>(null);
  const pendingRef = useRef<DeviceSkyView | null>(null);
  const frameRef = useRef(0);

  const prepare = useCallback(async () => {
    if (!isMobile || !('DeviceOrientationEvent' in window)) {
      setStatus('unsupported');
      return false;
    }
    if (permissionGranted) return true;

    setStatus('requesting');
    try {
      const orientationEvent = DeviceOrientationEvent as unknown as PermissionAwareDeviceOrientationEvent;
      if (orientationEvent.requestPermission) {
        const permission = await orientationEvent.requestPermission();
        if (permission !== 'granted') {
          setStatus('denied');
          return false;
        }
      }
      setPermissionGranted(true);
      return true;
    } catch {
      setStatus('error');
      return false;
    }
  }, [isMobile, permissionGranted]);

  useEffect(() => {
    if (!active || !isMobile || !permissionGranted) {
      setView(null);
      smoothedRef.current = null;
      if (!active) setStatus((current) => current === 'active' ? 'idle' : current);
      return;
    }

    let absoluteEventAt = 0;
    const commit = (next: DeviceSkyView) => {
      const previous = smoothedRef.current;
      const smoothed = previous
        ? viewFromAxes(
          mixVector(previous.forward, next.forward, .2),
          mixVector(previous.right, next.right, .2),
          next.accuracy,
        )
        : next;
      smoothedRef.current = smoothed;
      pendingRef.current = smoothed;
      if (!frameRef.current) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0;
          if (pendingRef.current) setView(pendingRef.current);
        });
      }
      setStatus('active');
    };
    const handleAbsolute = (rawEvent: Event) => {
      absoluteEventAt = performance.now();
      const next = orientationToView(rawEvent as CompassDeviceOrientationEvent);
      if (next) commit(next);
    };
    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (performance.now() - absoluteEventAt < 1_000) return;
      const next = orientationToView(event as CompassDeviceOrientationEvent);
      if (next) commit(next);
    };

    setStatus('requesting');
    window.addEventListener('deviceorientationabsolute', handleAbsolute, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => {
      window.removeEventListener('deviceorientationabsolute', handleAbsolute, true);
      window.removeEventListener('deviceorientation', handleOrientation, true);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [active, isMobile, permissionGranted]);

  return {
    isMobile,
    requiresPermissionPrompt,
    permissionGranted,
    prepare,
    status,
    view,
  };
}
