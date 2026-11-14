"use client";

import { type HTMLMotionProps, motion } from "motion/react";
import {
  forwardRef,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends Omit<
  HTMLMotionProps<"button">,
  "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

export interface ButtonLinkProps extends Omit<
  HTMLMotionProps<"a">,
  "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "border border-brand bg-brand text-white hover:border-brand-hover hover:bg-brand-hover active:border-brand-active active:bg-brand-active",
  secondary: "border border-line-strong bg-surface text-ink hover:border-brand-border hover:bg-brand-tint",
  ghost: "border border-transparent text-muted hover:bg-surface-hover hover:text-ink",
  outline:
    "border border-line-strong bg-transparent text-ink hover:bg-surface-hover",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 gap-2 rounded-(--radius-button) px-3 text-[13px]",
  md: "h-[38px] gap-2 rounded-(--radius-button) px-3.5 text-[14px]",
  lg: "h-[38px] gap-2 rounded-(--radius-button) px-4 text-[14px]",
  icon: "h-8 w-8 rounded-(--radius-button)",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      className,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <motion.button
        ref={ref}
        type="button"
        whileHover={undefined}
        className={cn(
          "inline-flex items-center justify-center font-semibold select-none",
          "transition-[background-color,border-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          "disabled:pointer-events-none disabled:opacity-50",
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          className,
        )}
        {...rest}
      >
        {children}
      </motion.button>
    );
  },
);

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink(
    {
      variant = "primary",
      size = "md",
      className,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <motion.a
        ref={ref}
        whileHover={undefined}
        className={cn(
          "inline-flex items-center justify-center font-semibold select-none",
          "transition-[background-color,border-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          className,
        )}
        {...rest}
      >
        {children}
      </motion.a>
    );
  },
);
