/** After a gesture ends, moves within this time (inertia, the zoom animation) are still the user's. */
const AFTER_GESTURE_MILLIS = 1500;

/**
 * Tells the moves the user makes on the map from the ones the code makes (selecting a plot,
 * following Google Earth Web): the maps report both the same way. A move counts as the user's
 * while a pointer is down on the map, or shortly after a gesture or a zoom button; any move by
 * the code cancels that, so clicking a plot (a gesture, then a fly to the plot) is not one.
 */
export class UserIntent {
  private pointerDown = false;
  private until = 0;
  private container: HTMLElement | null = null;

  attach(container: HTMLElement): void {
    this.container = container;
    container.addEventListener("pointerdown", this.onPointerDown, true);
    container.addEventListener("wheel", this.onGesture, { capture: true, passive: true });
    container.addEventListener("keydown", this.onGesture, true);
    window.addEventListener("pointerup", this.onPointerUp, true);
    window.addEventListener("pointercancel", this.onPointerUp, true);
  }

  detach(): void {
    const container = this.container;
    if (container) {
      container.removeEventListener("pointerdown", this.onPointerDown, true);
      container.removeEventListener("wheel", this.onGesture, true);
      container.removeEventListener("keydown", this.onGesture, true);
    }
    window.removeEventListener("pointerup", this.onPointerUp, true);
    window.removeEventListener("pointercancel", this.onPointerUp, true);
    this.container = null;
  }

  /** A zoom button of the React UI. */
  gesture(): void { this.until = Date.now() + AFTER_GESTURE_MILLIS; }

  /** The code moves the map: what follows is not the user's. */
  programmatic(): void { this.until = 0; }

  /** Whether the move that just ended is the user's. */
  isUsers(): boolean { return this.pointerDown || Date.now() < this.until; }

  private onPointerDown = (): void => { this.pointerDown = true; this.gesture(); };
  private onPointerUp = (): void => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    this.gesture();
  };
  private onGesture = (): void => this.gesture();
}
