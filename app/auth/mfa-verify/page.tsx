"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { MfaChallenge } from "@/components/auth/MfaChallenge";
import { Card } from "@/components/ui/card";

function MfaVerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const next = sanitizeNextPath(searchParams.get("next") || "/");

  const [userId, setUserId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    document.title = "Two-Factor Authentication";

    const check = async () => {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace(`/auth/login?redirectTo=${encodeURIComponent(next)}`);
        return;
      }

      // If session is already at the required AAL, no challenge needed.
      const { data: aal } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.currentLevel === aal.nextLevel) {
        router.replace(next);
        return;
      }

      setUserId(user.id);
      setChecking(false);
    };

    check();
  }, [next, router]);

  const handleSuccess = () => {
    router.replace(next);
    router.refresh();
  };

  const handleCancel = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        <Card className="p-8">
          {checking || !userId ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <MfaChallenge
              userId={userId}
              onSuccess={handleSuccess}
              onCancel={handleCancel}
              cancelLabel="Sign out and try again"
            />
          )}
        </Card>
      </div>
    </div>
  );
}

export default function MfaVerify() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <MfaVerifyForm />
    </Suspense>
  );
}
