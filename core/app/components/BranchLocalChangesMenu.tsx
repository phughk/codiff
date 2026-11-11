import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/CaretDown';
import { CheckIcon as Check } from '@phosphor-icons/react/Check';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { BranchLocalChangesMode } from '../../types.ts';

export const branchLocalChangesOptions: ReadonlyArray<{
  description: string;
  label: string;
  value: BranchLocalChangesMode;
}> = [
  {
    description: 'Branch diff, then staged and unstaged changes',
    label: 'Separate',
    value: 'separate',
  },
  {
    description: 'One diff from the merge-base to your working tree',
    label: 'Combined',
    value: 'combined',
  },
  { description: 'Committed branch changes only', label: 'Branch Only', value: 'branch' },
  { description: 'Uncommitted changes only', label: 'Local Only', value: 'local' },
];

export function BranchLocalChangesMenu({
  label,
  mode,
  onChange,
}: {
  label: string;
  mode: BranchLocalChangesMode;
  onChange: (mode: BranchLocalChangesMode) => void;
}) {
  // Portaled like OpenReviewSourceMenu: the top bar's backdrop-filter creates a
  // stacking context that later rows would otherwise paint over.
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const open = menuPosition != null;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentLabel =
    branchLocalChangesOptions.find((option) => option.value === mode)?.label ?? 'Separate';

  const openMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    setMenuPosition({ left: rect?.left ?? 0, top: (rect?.bottom ?? 0) + 6 });
  }, []);

  const close = useCallback(() => {
    setMenuPosition(null);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const selectedIndex = branchLocalChangesOptions.findIndex((option) => option.value === mode);
    itemRefs.current[Math.max(0, selectedIndex)]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        // oxlint-disable-next-line @nkzw/no-instanceof
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        close();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', close);
    };
  }, [close, mode, open]);

  const closeWithFocus = useCallback(() => {
    close();
    triggerRef.current?.focus();
  }, [close]);

  const handleMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Tab' || event.key === 'Escape') {
        if (event.key === 'Escape') {
          event.preventDefault();
        }
        closeWithFocus();
        return;
      }

      const items = itemRefs.current.filter((item) => item != null);
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex =
        event.key === 'ArrowDown'
          ? (currentIndex + 1) % items.length
          : event.key === 'ArrowUp'
            ? (currentIndex - 1 + items.length) % items.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : null;
      if (nextIndex != null) {
        event.preventDefault();
        items[nextIndex]?.focus();
      }
    },
    [closeWithFocus],
  );

  return (
    <span className="review-top-bar-source branch-local-changes-menu">
      <button
        aria-controls={open ? 'branch-local-changes-menu' : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        className="branch-local-changes-trigger"
        id="branch-local-changes-trigger"
        onClick={open ? close : openMenu}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openMenu();
          }
        }}
        ref={triggerRef}
        title={`Local changes: ${currentLabel}`}
        type="button"
      >
        <span className="review-top-bar-source-label">{label}</span>
        <span className="branch-local-changes-mode">{currentLabel}</span>
        <CaretDown aria-hidden size={11} weight="bold" />
      </button>
      {menuPosition
        ? createPortal(
            <div
              aria-labelledby="branch-local-changes-trigger"
              className="open-review-source-menu-list"
              id="branch-local-changes-menu"
              onKeyDown={handleMenuKeyDown}
              ref={menuRef}
              role="menu"
              style={{ left: menuPosition.left, top: menuPosition.top }}
            >
              {branchLocalChangesOptions.map((option, index) => (
                <button
                  aria-checked={option.value === mode}
                  className="open-review-source-menu-item branch-local-changes-menu-item"
                  key={option.value}
                  onClick={() => {
                    closeWithFocus();
                    if (option.value !== mode) {
                      onChange(option.value);
                    }
                  }}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  role="menuitemradio"
                  tabIndex={-1}
                  title={option.description}
                  type="button"
                >
                  <Check
                    aria-hidden
                    size={14}
                    style={{ visibility: option.value === mode ? 'visible' : 'hidden' }}
                    weight="bold"
                  />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
