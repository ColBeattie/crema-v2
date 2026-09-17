"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Spinner Component
export interface SpinnerProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  color?: "primary" | "white" | "gray" | "success" | "error" | "warning";
  className?: string;
}

const spinnerSizes = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
  xl: "h-12 w-12",
};

const spinnerColors = {
  primary: "text-primary",
  white: "text-white",
  gray: "text-muted-foreground",
  success: "text-green-500",
  error: "text-destructive",
  warning: "text-yellow-500",
};

export function Spinner({
  size = "md",
  color = "primary",
  className,
}: SpinnerProps) {
  return (
    <Loader2
      className={cn(
        "animate-spin",
        spinnerSizes[size],
        spinnerColors[color],
        className
      )}
    />
  );
}

// Loading Dots Component
export interface LoadingDotsProps {
  size?: "sm" | "md" | "lg";
  color?: "primary" | "white" | "gray";
  className?: string;
}

const dotSizes = {
  sm: "w-1.5 h-1.5",
  md: "w-2 h-2",
  lg: "w-3 h-3",
};

const dotColors = {
  primary: "bg-primary",
  white: "bg-white",
  gray: "bg-muted-foreground",
};

export function LoadingDots({
  size = "md",
  color = "primary",
  className,
}: LoadingDotsProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className={cn(
            "rounded-full animate-bounce",
            dotSizes[size],
            dotColors[color]
          )}
          style={{
            animationDelay: `${index * 0.15}s`,
            animationDuration: "0.6s",
          }}
        />
      ))}
    </div>
  );
}

// Loading Overlay Component
export interface LoadingOverlayProps {
  visible?: boolean;
  message?: string;
  fullScreen?: boolean;
  blur?: boolean;
}

export function LoadingOverlay({
  visible = true,
  message,
  fullScreen = false,
  blur = true,
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className={cn(
        fullScreen
          ? "fixed inset-0 z-50"
          : "absolute inset-0 rounded-lg overflow-hidden"
      )}
    >
      {blur && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
      )}
      <div className="relative h-full flex flex-col items-center justify-center">
        <Spinner size="lg" />
        {message && (
          <p className="mt-4 text-sm font-medium text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

// Page Loading Component
export interface PageLoadingProps {
  title?: string;
  message?: string;
}

export function PageLoading({
  title = "Loading",
  message = "Please wait while we load your content...",
}: PageLoadingProps) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
          <Spinner size="lg" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {message}
        </p>
        <div className="mt-8 flex justify-center">
          <LoadingDots size="md" />
        </div>
      </div>
    </div>
  );
}
