"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, ArrowRight } from "lucide-react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function ProfileSetup() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Set Up Your Profile";

    const checkUser = async () => {
      try {
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        if (!authUser) {
          router.push("/auth/login");
          return;
        }

        // If already completed onboarding, redirect home
        if (authUser.user_metadata?.onboarding_completed === true) {
          router.push("/");
          return;
        }

        setUser(authUser);

        // If they already have an avatar (e.g. from OAuth), show it
        if (authUser.user_metadata?.avatar_url) {
          setProfileImage(authUser.user_metadata.avatar_url);
        }
      } catch {
        setError("Failed to load your profile. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    checkUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploadingImage(true);
    setError(null);

    try {
      // Allowlist extensions — prevents path traversal via crafted file names
      // (e.g. "x.png/../../evil") since fileExt is interpolated into the
      // storage key that Supabase resolves internally.
      const allowedExtensions = ["jpg", "jpeg", "png", "gif", "webp"];
      const fileExt = file.name.split(".").pop()?.toLowerCase();
      if (!fileExt || !allowedExtensions.includes(fileExt)) {
        throw new Error(
          "Invalid file type. Only JPG, PNG, GIF and WebP are allowed."
        );
      }
      const timestamp = Date.now();
      const fileName = `avatar-${timestamp}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      // Defense-in-depth: reject path-traversal sequences before the Supabase
      // SDK resolves the key internally.
      if (filePath.includes("..") || filePath.includes("\\")) {
        throw new Error("Invalid file path");
      }

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("profiles")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from("profiles").getPublicUrl(filePath);

      // Add cache-busting parameter
      const cacheBustedUrl = `${publicUrl}?t=${timestamp}`;

      // Update user metadata with avatar URL
      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: cacheBustedUrl },
      });

      if (updateError) throw updateError;

      // Refresh user data
      const {
        data: { user: updatedUser },
      } = await supabase.auth.getUser();
      if (updatedUser) {
        setUser(updatedUser);
        setProfileImage(
          updatedUser.user_metadata?.avatar_url || cacheBustedUrl
        );
      } else {
        setProfileImage(cacheBustedUrl);
      }
    } catch (err: any) {
      setError(err.message || "Failed to upload image. Please try again.");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleContinue = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        data: { onboarding_completed: true },
      });

      if (updateError) throw updateError;

      // Hard navigation. updateUser just rotated user_metadata — soft
      // router.push reuses cached middleware state from before the flip and
      // bounces us back here, where the useEffect re-pushes "/" and the loop
      // keeps the Skip spinner up forever. A full reload guarantees the next
      // request carries the new cookies. Same pattern as mfa-setup verify.
      window.location.assign("/");
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        <Card className="p-6 md:p-8 gap-0">
          {/* Header */}
          <div className="text-center mb-6">
            <h1 className="text-xl font-semibold text-foreground">
              Add a Profile Photo
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Help your team recognize you by adding a profile picture
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-600 rounded-md">
              <p className="text-sm text-white">{error}</p>
            </div>
          )}

          {/* Upload Area */}
          <div className="flex flex-col items-center mb-6">
            <label
              htmlFor="profile-setup-upload"
              className={`relative cursor-pointer group ${
                uploadingImage ? "pointer-events-none" : ""
              }`}
            >
              <div className="relative w-32 h-32 rounded-full bg-muted border-2 border-dashed border-border overflow-hidden flex items-center justify-center group-hover:border-primary transition-colors">
                {profileImage ? (
                  <Image
                    src={profileImage}
                    alt="Profile"
                    fill
                    unoptimized
                    className="object-cover"
                  />
                ) : uploadingImage ? (
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex flex-col items-center">
                    <Camera className="w-8 h-8 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="text-xs text-muted-foreground mt-1 group-hover:text-primary transition-colors">
                      Upload
                    </span>
                  </div>
                )}
              </div>
              {profileImage && !uploadingImage && (
                <div className="absolute bottom-0 right-0 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full p-2 transition-colors">
                  <Camera className="w-4 h-4" />
                </div>
              )}
              <input
                id="profile-setup-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageChange}
                disabled={uploadingImage}
              />
            </label>
            <p className="text-xs text-muted-foreground mt-3">
              JPG, PNG or GIF. Recommended 400x400px.
            </p>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <Button
              onClick={handleContinue}
              disabled={submitting}
              className="w-full"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={handleContinue}
              disabled={submitting}
              className="w-full text-sm"
            >
              Skip for now
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
