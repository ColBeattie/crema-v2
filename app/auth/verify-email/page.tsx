"use client";

import { useEffect } from "react";
import { Mail } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function VerifyEmail() {
  useEffect(() => {
    document.title = "Check your email";
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center">
        <Card className="p-8">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-2">
            Check your email
          </h1>

          <p className="text-muted-foreground mb-6">
            We&apos;ve sent you a verification email. Please click the link in
            the email to verify your account.
          </p>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Didn&apos;t receive the email? Check your spam folder or request a
              new verification email.
            </p>

            <Button variant="secondary" className="w-full" asChild>
              <Link href="/auth/login">Back to Login</Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
