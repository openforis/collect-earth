import { Component, type ReactNode } from "react";

/** Shows `fallback` in place of its children once one of them throws while rendering, so one part cannot blank the page. */
export default class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
