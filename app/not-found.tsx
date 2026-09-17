"use client";

import Link from "next/link";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex justify-center px-4 pt-[30vh]">
      <div className="max-w-md w-full text-center">
        {/* Compact 404 */}
        <div className="mb-6">
          <div className="text-6xl md:text-7xl font-bold text-foreground select-none">
            404
          </div>
        </div>

        {/* Error Message */}
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
          Page Not Found
        </h1>
        <p className="text-muted-foreground mb-6">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>

        {/* Back to Home Button */}
        <Button asChild>
          <Link href="/">
            <Home className="h-4 w-4" />
            Back to Home
          </Link>
        </Button>
      </div>
    </div>
  );
}
