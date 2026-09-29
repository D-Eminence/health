"use client";
// beui.dev/components/motion/button

import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react";
import {
  forwardRef,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { EASE_OUT } from "@/lib/ease";
import { Button, type ButtonProps } from "./base";

export type ButtonState = "idle" | "loading" | "success" | "error";

export interface StatefulButtonProps extends Omit<ButtonProps, "children"> {
  state?: ButtonState;
  children: ReactNode;
  loadingText?: ReactNode;
  successText?: ReactNode;
  errorText?: ReactNode;
  icon?: ReactNode;
}

const CASCADE_STAGGER = 0.025;
const SWAP_TRANSITION = { duration: 0.15, ease: EASE_OUT };

const CASCADE_LETTER_VARIANTS: Variants = {
  initial: { opacity: 0, y: "105%" },
  animate: (delay: number = 0) => ({
    opacity: 1,
    y: "0%",
    transition: { ...SWAP_TRANSITION, delay },
  }),
  exit: (delay: number = 0) => ({
    opacity: 0,
    y: "-105%",
    transition: { duration: 0.16, ease: EASE_OUT, delay: delay * 0.5 },
  }),
};

const ICON_VARIANTS: Variants = {
  // Width collapses too, so the icon adds/removes its own space smoothly
  // instead of popping the row width in a single frame.
  initial: { opacity: 0, width: 0, scale: 0.7 },
  animate: {
    opacity: 1,
    width: "1.5rem",
    scale: 1,
    transition: SWAP_TRANSITION,
  },
  exit: {
    opacity: 0,
    width: 0,
    scale: 0.7,
    transition: { duration: 0.16, ease: EASE_OUT },
  },
};

function IconSlot({ keyId, children }: { keyId: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={keyId}
      variants={ICON_VARIANTS}
      initial={reduce ? { opacity: 0 } : "initial"}
      animate={reduce ? { opacity: 1 } : "animate"}
      exit={reduce ? { opacity: 0 } : "exit"}
      transition={reduce ? { duration: 0.15 } : undefined}
      className="inline-grid shrink-0 place-items-center overflow-hidden"
    >
      {children}
    </motion.span>
  );
}

function TextSlot({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  const label = typeof children === "string" ? children : null;
  const cascade = label !== null && !reduce;

  // Measure strings with the same per-letter layout as the cascade. Measuring
  // the whole string preserves kerning, which can make it narrower than the
  // inline-block letters and clip the final glyph during the width animation.
  useLayoutEffect(() => {
    const nextWidth = measureRef.current?.offsetWidth;
    if (!nextWidth) return;
    setWidth((current) => (current === nextWidth ? current : nextWidth));
  });

  return (
    <motion.span
      initial={false}
      animate={{ width }}
      transition={reduce ? { duration: 0 } : SWAP_TRANSITION}
      className="relative inline-block overflow-hidden whitespace-nowrap align-bottom"
    >
      <span
        ref={measureRef}
        aria-hidden
        className="invisible inline-block whitespace-nowrap"
      >
        {cascade
          ? label.split("").map((char, index) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: position is the slot identity.
                key={index}
                className="inline-block whitespace-pre"
              >
                {char}
              </span>
            ))
          : children}
      </span>

      {cascade ? (
        <>
          <span className="sr-only">{label}</span>
          <AnimatePresence initial={false}>
            <motion.span
              key={`cascade-${value}`}
              aria-hidden
              initial="initial"
              animate="animate"
              exit="exit"
              className="absolute left-0 top-0 inline-block whitespace-pre"
            >
              {label.split("").map((char, index) => (
                <motion.span
                  // biome-ignore lint/suspicious/noArrayIndexKey: position is the slot identity.
                  key={index}
                  custom={index * CASCADE_STAGGER}
                  variants={CASCADE_LETTER_VARIANTS}
                  className="inline-block whitespace-pre will-change-[opacity,transform]"
                >
                  {char}
                </motion.span>
              ))}
            </motion.span>
          </AnimatePresence>
        </>
      ) : (
        <AnimatePresence initial={false}>
          <motion.span
            key={`text-${value}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={reduce ? { duration: 0.15 } : SWAP_TRANSITION}
            className="absolute left-0 top-0 inline-block will-change-[opacity,transform]"
          >
            {children}
          </motion.span>
        </AnimatePresence>
      )}
    </motion.span>
  );
}

export const StatefulButton = forwardRef<HTMLButtonElement, StatefulButtonProps>(function StatefulButton(
  {
    state = "idle",
    children,
    loadingText = "Loading",
    successText = "Done",
    errorText = "Try again",
    icon,
    disabled,
    ...rest
  },
  ref,
) {
  const isBusy = state === "loading";
  const stateText =
    state === "loading"
      ? loadingText
      : state === "success"
        ? successText
        : state === "error"
        ? errorText
        : children;
  const textKey =
    typeof stateText === "string" ? `${state}-${stateText}` : state;

  return (
    <Button ref={ref} disabled={disabled || isBusy} aria-busy={isBusy} whileHover={undefined} {...rest}>
      <span
        aria-live="polite"
        className="relative inline-flex items-center justify-center overflow-hidden"
      >
        <AnimatePresence initial={false}>
          {state === "loading" ? (
            <IconSlot keyId="loading-icon">
              <HugeiconsIcon icon={Loading03Icon} size={16} strokeWidth={1.5} aria-hidden className="animate-spin" />
            </IconSlot>
          ) : null}
          {state === "success" ? (
            <IconSlot keyId="success-icon">
              <HugeiconsIcon icon={CheckIcon} size={16} strokeWidth={1.5} aria-hidden />
            </IconSlot>
          ) : null}
          {state === "error" ? (
            <IconSlot keyId="error-icon">
              <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.5} aria-hidden />
            </IconSlot>
          ) : null}
        </AnimatePresence>

        <TextSlot value={textKey}>{stateText}</TextSlot>

        <AnimatePresence initial={false}>
          {state === "idle" && icon ? (
            <IconSlot keyId="idle-icon">{icon}</IconSlot>
          ) : null}
        </AnimatePresence>
      </span>
    </Button>
  );
});
