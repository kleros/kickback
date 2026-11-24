"use client";

import { Component, type ReactNode } from "react";

/** Keeps one broken part (a row with odd on-chain data) from taking the whole page down. */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
