"use client";

import { CameraViewer } from "@/components/camera-viewer";
import { useCameras } from "@/hooks/use-cameras";
import type { CameraTakeoverRow } from "@/lib/camera-takeover";

/**
 * The camera `show_camera` put on this screen (#335), in the camera viewer's
 * own full-screen view — the one a tap on a camera opens — with no tile
 * behind it. It goes when the time is up, because the parent stops rendering
 * it, or when somebody closes it here, which only closes it on this screen.
 */
export function CameraTakeover({
  takeover,
  onClose,
}: {
  takeover: CameraTakeoverRow;
  onClose: () => void;
}) {
  const { cameras } = useCameras();
  const camera = cameras.find((c) => c.id === takeover.camera_id);
  // Removed or disabled since the call: nothing to show, and nothing to hold.
  if (!camera) return null;
  // Keyed by camera, not by start: a second ring for the same camera only
  // moves the end, so the picture must not drop and reconnect.
  return <CameraViewer key={camera.id} camera={camera} fullscreenOnly onClose={onClose} />;
}
