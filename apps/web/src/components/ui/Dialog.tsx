"use client";

import type { ReactNode } from "react";

import { Button, Dialog as AriaDialog, Heading, Modal, ModalOverlay } from "react-aria-components";

export interface DialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  /** While busy the dialog cannot be dismissed: no close button, Escape or outside click. */
  isBusy?: boolean;
}

export function Dialog({ isOpen, onOpenChange, title, children, isBusy = false }: DialogProps) {
  const change = (open: boolean) => {
    if (!open && isBusy) return;
    onOpenChange(open);
  };

  return (
    <ModalOverlay
      className="kb-overlay"
      isOpen={isOpen}
      onOpenChange={change}
      isDismissable={!isBusy}
      isKeyboardDismissDisabled={isBusy}
    >
      <Modal className="kb-modal">
        <AriaDialog className="kb-dialog">
          <div className="kb-dialog-head">
            <Heading slot="title" className="kb-dialog-title">
              {title}
            </Heading>
            <Button className="kb-icon-btn" aria-label="Close" isDisabled={isBusy} onPress={() => change(false)}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden stroke="currentColor" strokeWidth="1.75">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </Button>
          </div>
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
