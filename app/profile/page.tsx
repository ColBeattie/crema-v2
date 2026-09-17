"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Camera,
  Save,
  Loader2,
  ShieldCheck,
  ShieldOff,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Fingerprint,
  KeyRound,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import {
  isWebAuthnSupported,
  registerPasskey,
  isStepUpRequiredError,
  PasskeyOperationError,
} from "@/lib/webauthn";
import { COMPANY_NAME } from "@/lib/company";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function Profile() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    mfaCode: "",
  });
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // MFA states
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaVerificationCode, setMfaVerificationCode] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  // Passkey states. Passkeys are first-factor sign-in credentials, not MFA
  // factors — they live in their own API namespace (see lib/webauthn.ts).
  const [passkeys, setPasskeys] = useState<
    { id: string; friendly_name?: string; created_at?: string }[]
  >([]);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // GoTrue refuses to add or remove a passkey on an AAL1 session *once the
  // account has a verified MFA factor*. Accounts without MFA are never asked to
  // step up — that path must stay open, or "add a passkey" is impossible for
  // anyone who hasn't enabled 2FA first.
  const [passkeyToRemove, setPasskeyToRemove] = useState<{
    id: string;
    friendly_name?: string;
  } | null>(null);
  const [showPasskeyStepUp, setShowPasskeyStepUp] = useState(false);
  const [stepUpCode, setStepUpCode] = useState("");
  const [passkeyListLocked, setPasskeyListLocked] = useState(false);
  const [pendingPasskeyAction, setPendingPasskeyAction] = useState<
    | { type: "add" }
    | { type: "remove"; passkeyId: string }
    | { type: "list" }
    | null
  >(null);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setToastVisible(true);
    if (type === "success") {
      setTimeout(() => setToastVisible(false), 4000);
    }
  }, []);

  const dismissToast = useCallback(() => {
    setToastVisible(false);
  }, []);

  /**
   * First-factor passkeys are not MFA factors, so they are read through the
   * passkey API rather than `mfa.listFactors()`.
   */
  const loadPasskeys = useCallback(async () => {
    const { data, error } = await supabase.auth.passkey.list();
    // GoTrue gates passkey management behind AAL2 while the account has a
    // verified MFA factor, and that may cover reads too. Flag it rather than
    // rendering an empty list that looks like "you have no passkeys".
    setPasskeyListLocked(Boolean(error));
    setPasskeys(error || !data ? [] : data);
  }, [supabase]);

  /**
   * Returns the verified TOTP factor id when the session must step up to AAL2
   * before it is allowed to manage passkeys, or null when it can proceed as-is.
   *
   * Returning null is the common case: an account with no MFA enrolled has
   * `nextLevel === "aal1"`, so nothing is required and the passkey action runs
   * straight away. Only an AAL1 session on an MFA-enrolled account (i.e. signed
   * in with a passkey or magic link) needs the TOTP step-up.
   */
  const getStepUpFactorId = useCallback(async (): Promise<string | null> => {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (!aal || aal.nextLevel !== "aal2" || aal.currentLevel === "aal2") {
      return null;
    }

    const { data: factors } = await supabase.auth.mfa.listFactors();
    return factors?.totp?.find((f) => f.status === "verified")?.id ?? null;
  }, [supabase]);

  useEffect(() => {
    document.title = "My Profile";

    const loadUserProfile = async () => {
      try {
        const {
          data: { user: authUser },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !authUser) {
          router.push("/auth/login");
          return;
        }

        setUser(authUser);
        setFormData((prev) => ({
          ...prev,
          email: authUser.email || "",
          firstName: authUser.user_metadata?.first_name || "",
          lastName: authUser.user_metadata?.last_name || "",
        }));

        // Load user's profile image
        if (authUser.user_metadata?.avatar_url) {
          setProfileImage(authUser.user_metadata.avatar_url);
        } else {
          setProfileImage(null);
        }

        setLoading(false);
      } catch {
        setLoading(false);
      }
    };

    const checkMfaStatus = async () => {
      try {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totpFactor = factors?.totp?.[0];
        setMfaEnabled(totpFactor?.status === "verified");

        // Registered passkeys (separate API from MFA factors)
        await loadPasskeys();

        // Gate on WebAuthn support, not on a platform authenticator: a USB
        // security key can be registered from a machine with no Face ID /
        // Touch ID / Windows Hello.
        setPasskeySupported(isWebAuthnSupported());
      } catch {}
    };

    loadUserProfile();
    checkMfaStatus();
  }, [supabase, router, loadPasskeys]);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploadingImage(true);

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

      // Add cache-busting parameter to the URL
      const cacheBustedUrl = `${publicUrl}?t=${timestamp}`;

      // Update user metadata with avatar URL
      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: cacheBustedUrl },
      });

      if (updateError) throw updateError;

      // Refresh user data to get the updated avatar URL
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

      showToast("success", "Profile picture updated successfully!");
    } catch (error: any) {
      showToast("error", error.message || "Failed to upload image");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);

    try {
      // Update user's metadata
      const { error: updateError } = await supabase.auth.updateUser({
        email: formData.email,
        data: { first_name: formData.firstName, last_name: formData.lastName },
      });

      if (updateError) throw updateError;

      showToast("success", "Profile updated successfully!");
    } catch (error: any) {
      showToast("error", error.message || "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleEnrollMfa = async () => {
    setMfaLoading(true);

    try {
      // First check if there's an existing unverified factor and unenroll it
      // Note: factors.all contains both verified and unverified, while factors.totp only has verified
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const unverifiedFactor = factors?.all?.find(
        (f) => f.factor_type === "totp" && f.status === "unverified"
      );

      if (unverifiedFactor) {
        // Remove the unverified factor first
        await supabase.auth.mfa.unenroll({ factorId: unverifiedFactor.id });
      }

      // Now enroll a new factor
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: COMPANY_NAME,
        issuer: COMPANY_NAME,
      });

      if (error) throw error;

      if (data) {
        setMfaQrCode(data.totp.qr_code);
        setMfaSecret(data.totp.secret);
        setMfaFactorId(data.id);
        setShowMfaSetup(true);
      }
    } catch (error: any) {
      showToast("error", error.message || "Failed to enroll MFA");
    } finally {
      setMfaLoading(false);
    }
  };

  const handleVerifyMfa = async () => {
    if (mfaVerificationCode.length !== 6) {
      showToast("error", "Please enter a 6-digit code");
      return;
    }

    if (!mfaFactorId) {
      showToast("error", "MFA setup error. Please try again.");
      return;
    }

    setMfaLoading(true);

    try {
      // First, create a challenge for the factor
      const { data: challengeData, error: challengeError } =
        await supabase.auth.mfa.challenge({
          factorId: mfaFactorId,
        });

      if (challengeError) throw challengeError;

      if (!challengeData) {
        throw new Error("Failed to create MFA challenge");
      }

      // Then verify the code against the challenge
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challengeData.id,
        code: mfaVerificationCode,
      });

      if (verifyError) throw verifyError;

      setMfaEnabled(true);
      setShowMfaSetup(false);
      setMfaVerificationCode("");
      setMfaQrCode(null);
      setMfaSecret(null);
      setMfaFactorId(null);
      showToast("success", "Two-factor authentication enabled successfully!");
    } catch (error: any) {
      showToast("error", error.message || "Invalid verification code");
    } finally {
      setMfaLoading(false);
    }
  };

  const handleDisableMfa = async () => {
    setShowDisableConfirm(true);
  };

  const confirmDisableMfa = async () => {
    setShowDisableConfirm(false);
    setMfaLoading(true);

    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totpFactor = factors?.totp?.[0];

      if (!totpFactor) {
        throw new Error("No TOTP factor found");
      }

      const { error } = await supabase.auth.mfa.unenroll({
        factorId: totpFactor.id,
      });

      if (error) throw error;

      setMfaEnabled(false);
      showToast("success", "Two-factor authentication disabled");
    } catch (error: any) {
      showToast("error", error.message || "Failed to disable MFA");
    } finally {
      setMfaLoading(false);
    }
  };

  const addPasskey = async () => {
    setPasskeyLoading(true);

    try {
      await registerPasskey();
      await loadPasskeys();
      showToast("success", "Passkey added successfully!");
    } catch (err) {
      // Belt and braces: if GoTrue asks for a higher assurance level even
      // though the pre-check said otherwise, offer the step-up instead of
      // dead-ending on a raw error — but only when there is a TOTP factor to
      // step up with. Without one there is nothing the user could enter.
      if (isStepUpRequiredError(err)) {
        const factorId = await getStepUpFactorId();
        if (factorId) {
          setPendingPasskeyAction({ type: "add" });
          setShowPasskeyStepUp(true);
          return;
        }
      }
      if (err instanceof PasskeyOperationError && err.aborted) return;
      showToast(
        "error",
        err instanceof Error ? err.message : "Failed to add passkey"
      );
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleAddPasskey = async () => {
    // No MFA enrolled → getStepUpFactorId() is null → register immediately.
    if (await getStepUpFactorId()) {
      setPendingPasskeyAction({ type: "add" });
      setShowPasskeyStepUp(true);
      return;
    }

    await addPasskey();
  };

  const removePasskey = async (passkeyId: string) => {
    setPasskeyLoading(true);

    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId });
      if (error) throw error;

      setPasskeys((prev) => prev.filter((p) => p.id !== passkeyId));
      showToast("success", "Passkey removed");
    } catch (error: any) {
      showToast("error", error.message || "Failed to remove passkey");
    } finally {
      setPasskeyLoading(false);
    }
  };

  /** Removing a passkey can lock the user out of this device, so confirm first. */
  const handleRemovePasskey = (passkey: {
    id: string;
    friendly_name?: string;
  }) => {
    setPasskeyToRemove(passkey);
  };

  const confirmRemovePasskey = async () => {
    const passkey = passkeyToRemove;
    if (!passkey) return;

    setPasskeyToRemove(null);

    if (await getStepUpFactorId()) {
      setPendingPasskeyAction({ type: "remove", passkeyId: passkey.id });
      setShowPasskeyStepUp(true);
      return;
    }

    await removePasskey(passkey.id);
  };

  const closePasskeyStepUp = () => {
    setShowPasskeyStepUp(false);
    setStepUpCode("");
    setPendingPasskeyAction(null);
  };

  const handlePasskeyStepUp = async () => {
    if (stepUpCode.length !== 6) {
      showToast("error", "Please enter a 6-digit code");
      return;
    }

    const action = pendingPasskeyAction;
    const factorId = await getStepUpFactorId();

    if (!action || !factorId) {
      closePasskeyStepUp();
      return;
    }

    setPasskeyLoading(true);

    try {
      const { data: challengeData, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId });

      if (challengeError) throw challengeError;
      if (!challengeData) throw new Error("Failed to create MFA challenge");

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: stepUpCode,
      });

      if (verifyError) throw verifyError;

      closePasskeyStepUp();
    } catch (error: any) {
      showToast("error", error.message || "Invalid verification code");
      return;
    } finally {
      setPasskeyLoading(false);
    }

    // The session is AAL2 now, so the action GoTrue refused can go ahead.
    if (action.type === "add") {
      await addPasskey();
    } else if (action.type === "remove") {
      await removePasskey(action.passkeyId);
    } else {
      await loadPasskeys();
    }
  };

  const copyToClipboard = () => {
    if (mfaSecret) {
      navigator.clipboard.writeText(mfaSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Collapse the password form and drop whatever was typed, so a half-entered
  // password isn't left sitting in component state after the user backs out.
  const closePasswordForm = () => {
    setShowPasswordForm(false);
    setFormData((prev) => ({
      ...prev,
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
      mfaCode: "",
    }));
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.currentPassword) {
      showToast("error", "Enter your current password to continue");
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      showToast("error", "New passwords do not match");
      return;
    }

    if (formData.newPassword.length < 8) {
      showToast("error", "Password must be at least 8 characters long");
      return;
    }

    if (formData.currentPassword === formData.newPassword) {
      showToast(
        "error",
        "New password must be different from current password"
      );
      return;
    }

    if (!user?.email) {
      showToast("error", "Unable to verify account. Please sign in again.");
      return;
    }

    if (mfaEnabled && formData.mfaCode.length !== 6) {
      showToast("error", "Enter the 6-digit code from your authenticator app");
      return;
    }

    setSavingPassword(true);

    try {
      // Step 1: prove the current password by re-authenticating. This
      // satisfies Supabase's "Require current password when updating" check.
      // Side effect: the new session starts at AAL1, so if MFA is enrolled
      // we must re-elevate to AAL2 below before updateUser will succeed.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: formData.currentPassword,
      });

      if (signInError) {
        showToast("error", "Current password is incorrect");
        setSavingPassword(false);
        return;
      }

      // Step 2: if MFA is enrolled, lift the freshly-minted session back to
      // AAL2 by challenging the TOTP factor. Without this, Supabase returns
      // "AAL2 session is required to update email or password when MFA is
      // enabled".
      if (mfaEnabled) {
        const { data: factors, error: factorsError } =
          await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        const totp = factors?.totp?.find((f) => f.status === "verified");
        if (!totp) {
          showToast(
            "error",
            "Couldn't find your authenticator setup. Please sign out and back in, then try again."
          );
          setSavingPassword(false);
          return;
        }

        const { data: challenge, error: challengeError } =
          await supabase.auth.mfa.challenge({ factorId: totp.id });
        if (challengeError || !challenge) {
          showToast(
            "error",
            "Couldn't start MFA verification. Please try again."
          );
          setSavingPassword(false);
          return;
        }

        const { error: verifyError } = await supabase.auth.mfa.verify({
          factorId: totp.id,
          challengeId: challenge.id,
          code: formData.mfaCode,
        });

        if (verifyError) {
          const vmsg = verifyError.message?.toLowerCase() ?? "";
          if (vmsg.includes("expired") || vmsg.includes("challenge")) {
            showToast(
              "error",
              "Verification window expired. Try again with the latest code from your authenticator app."
            );
          } else {
            showToast(
              "error",
              "That code didn't match. Open your authenticator app and enter the latest 6-digit code (it refreshes every 30 seconds)."
            );
          }
          setSavingPassword(false);
          return;
        }
      }

      // Step 3: update the password.
      const { error } = await supabase.auth.updateUser({
        password: formData.newPassword,
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("same_password") || msg.includes("different from")) {
          showToast(
            "error",
            "Please choose a different password than your current one."
          );
        } else if (msg.includes("reauthentication") || msg.includes("nonce")) {
          // Supabase asked for an emailed nonce instead of accepting the
          // fresh signInWithPassword — surface a clear message rather than
          // the raw error.
          showToast(
            "error",
            "For security, please sign out and use the password reset flow."
          );
        } else {
          showToast("error", error.message || "Failed to update password");
        }
        setSavingPassword(false);
        return;
      }

      showToast("success", "Password updated successfully!");
      closePasswordForm();
    } catch (error: any) {
      showToast("error", error.message || "Failed to update password");
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderAvatar = () => (
    <div className="relative">
      <div className="relative w-24 h-24 rounded-full bg-muted overflow-hidden">
        {profileImage ? (
          <Image
            src={profileImage}
            alt="Profile"
            fill
            unoptimized
            loading="eager"
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
      </div>
      <label
        htmlFor="profile-upload"
        className={`absolute bottom-0 right-0 bg-primary hover:bg-primary/90 text-white rounded-full p-2 cursor-pointer transition-colors ${
          uploadingImage ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {uploadingImage ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Camera className="w-4 h-4" />
        )}
        <input
          id="profile-upload"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageChange}
          disabled={uploadingImage}
        />
      </label>
    </div>
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your personal information and account settings
        </p>
      </div>

      <div className="grid gap-5">
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit}>
              <div className="flex flex-col sm:flex-row gap-5">
                <div className="flex-shrink-0 flex flex-col items-center">
                  {renderAvatar()}
                </div>
                <div className="grid gap-4 flex-1 min-w-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="mb-2">First Name</Label>
                      <Input
                        type="text"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleInputChange}
                        placeholder="First name"
                      />
                    </div>
                    <div>
                      <Label className="mb-2">Last Name</Label>
                      <Input
                        type="text"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleInputChange}
                        placeholder="Last name"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2">Email</Label>
                    <Input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      placeholder="Email address"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={savingProfile} size="sm">
                      {savingProfile ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      {savingProfile ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {!showPasswordForm ? (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <KeyRound className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Password
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Change the password you use to sign in.
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowPasswordForm(true)}
                  >
                    Change Password
                  </Button>
                </div>
              ) : (
                <form onSubmit={handlePasswordChange}>
                  <div className="space-y-4">
                    <div>
                      <Label className="mb-2">Current Password</Label>
                      <Input
                        type="password"
                        name="currentPassword"
                        autoComplete="current-password"
                        value={formData.currentPassword}
                        onChange={handleInputChange}
                        placeholder="Current password"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-2">New Password</Label>
                        <Input
                          type="password"
                          name="newPassword"
                          autoComplete="new-password"
                          value={formData.newPassword}
                          onChange={handleInputChange}
                          placeholder="New password"
                        />
                      </div>
                      <div>
                        <Label className="mb-2">Confirm Password</Label>
                        <Input
                          type="password"
                          name="confirmPassword"
                          autoComplete="new-password"
                          value={formData.confirmPassword}
                          onChange={handleInputChange}
                          placeholder="Confirm password"
                        />
                      </div>
                    </div>
                    {formData.newPassword && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {[
                          {
                            label: "8+ characters",
                            met: formData.newPassword.length >= 8,
                          },
                          {
                            label: "Uppercase",
                            met: /[A-Z]/.test(formData.newPassword),
                          },
                          {
                            label: "Lowercase",
                            met: /[a-z]/.test(formData.newPassword),
                          },
                          {
                            label: "Number",
                            met: /\d/.test(formData.newPassword),
                          },
                        ].map((req) => (
                          <div
                            key={req.label}
                            className="flex items-center gap-1.5"
                          >
                            {req.met ? (
                              <Check className="w-3 h-3 text-green-500" />
                            ) : (
                              <X className="w-3 h-3 text-muted-foreground" />
                            )}
                            <span
                              className={`text-xs ${req.met ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                            >
                              {req.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {mfaEnabled && (
                      <div>
                        <Label className="mb-2">Authenticator code</Label>
                        <Input
                          type="text"
                          name="mfaCode"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={formData.mfaCode}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              mfaCode: e.target.value
                                .replace(/\D/g, "")
                                .slice(0, 6),
                            }))
                          }
                          placeholder="000000"
                          maxLength={6}
                          className="w-32 text-center font-mono tracking-widest"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Enter the latest 6-digit code from your authenticator
                          app to confirm this change.
                        </p>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        onClick={closePasswordForm}
                        disabled={savingPassword}
                        size="sm"
                        variant="ghost"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={savingPassword}
                        size="sm"
                        variant="outline"
                      >
                        {savingPassword ? "Updating..." : "Update Password"}
                      </Button>
                    </div>
                  </div>
                </form>
              )}

              <div className="border-t border-border" />

              {!showMfaSetup ? (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    {mfaEnabled ? (
                      <ShieldCheck className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                    ) : (
                      <ShieldOff className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {mfaEnabled
                          ? "Two-factor authentication is enabled"
                          : "Two-factor authentication is off"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {mfaEnabled
                          ? "Your account is protected with an authenticator app."
                          : "Add an extra layer of security with an authenticator app."}
                      </p>
                    </div>
                  </div>
                  {mfaEnabled ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDisableMfa}
                      disabled={mfaLoading}
                    >
                      {mfaLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Disable"
                      )}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleEnrollMfa}
                      disabled={mfaLoading}
                    >
                      {mfaLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Enable"
                      )}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm font-medium text-foreground">
                    Set up your authenticator app
                  </p>
                  <ol className="space-y-4 text-sm text-muted-foreground">
                    <li className="flex items-start">
                      <span className="flex-shrink-0 w-5 h-5 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-medium mr-2.5">
                        1
                      </span>
                      <p>
                        Install an authenticator app like Google Authenticator
                        or Authy
                      </p>
                    </li>
                    <li className="flex items-start">
                      <span className="flex-shrink-0 w-5 h-5 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-medium mr-2.5">
                        2
                      </span>
                      <div className="flex-1">
                        <p className="mb-3">
                          Scan this QR code with your authenticator app
                        </p>
                        {mfaQrCode && (
                          <div className="bg-white p-3 rounded-lg inline-block border border-border">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={mfaQrCode}
                              alt="MFA QR Code"
                              className="w-40 h-40"
                            />
                          </div>
                        )}
                        {mfaSecret && (
                          <div className="mt-2">
                            <p className="text-xs text-muted-foreground mb-1">
                              Or enter manually:
                            </p>
                            <div className="flex items-center gap-2">
                              <code className="bg-muted px-2 py-1 rounded text-xs font-mono">
                                {mfaSecret}
                              </code>
                              <button
                                onClick={copyToClipboard}
                                className="p-1 text-muted-foreground hover:text-foreground"
                              >
                                {copied ? (
                                  <Check className="w-3.5 h-3.5 text-green-500" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </li>
                    <li className="flex items-start">
                      <span className="flex-shrink-0 w-5 h-5 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-medium mr-2.5">
                        3
                      </span>
                      <div className="flex-1">
                        <p className="mb-2">
                          Enter the 6-digit code from your app
                        </p>
                        <div className="flex items-center gap-2">
                          <Input
                            type="text"
                            value={mfaVerificationCode}
                            onChange={(e) =>
                              setMfaVerificationCode(
                                e.target.value.replace(/\D/g, "").slice(0, 6)
                              )
                            }
                            placeholder="000000"
                            className="w-28 text-center font-mono"
                            maxLength={6}
                          />
                          <Button
                            size="sm"
                            onClick={handleVerifyMfa}
                            disabled={
                              mfaLoading || mfaVerificationCode.length !== 6
                            }
                          >
                            {mfaLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "Verify & Enable"
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowMfaSetup(false);
                              setMfaVerificationCode("");
                              setMfaQrCode(null);
                              setMfaSecret(null);
                              setMfaFactorId(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </li>
                  </ol>
                </div>
              )}

              {/* Passkeys — passwordless first-factor sign-in. Not a second
                  factor: a passkey does not satisfy the MFA requirement. */}
              {passkeySupported && (
                <>
                  <div className="border-t border-border" />

                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <Fingerprint className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Passkeys
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Sign in with Face ID, Touch ID, Windows Hello or a
                            security key instead of your password.
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleAddPasskey}
                        disabled={passkeyLoading}
                      >
                        {passkeyLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Add Passkey"
                        )}
                      </Button>
                    </div>

                    {passkeyListLocked && (
                      <div className="rounded-md border border-border bg-muted/50 p-3">
                        <p className="text-xs text-muted-foreground">
                          Verify this session to view and manage your passkeys.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            setPendingPasskeyAction({ type: "list" });
                            setShowPasskeyStepUp(true);
                          }}
                        >
                          Verify session
                        </Button>
                      </div>
                    )}

                    {!passkeyListLocked && passkeys.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No passkeys registered yet.
                      </p>
                    )}

                    {passkeys.length > 0 && (
                      <ul className="space-y-2">
                        {passkeys.map((pk) => (
                          <li
                            key={pk.id}
                            className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm text-foreground truncate">
                                {pk.friendly_name || "Passkey"}
                              </p>
                              {pk.created_at && (
                                <p className="text-xs text-muted-foreground">
                                  Added {formatDate(pk.created_at)}
                                </p>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remove ${pk.friendly_name || "passkey"}`}
                              onClick={() => handleRemovePasskey(pk)}
                              disabled={passkeyLoading}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                              Remove
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* MFA Disable Confirmation Modal */}
      <Dialog open={showDisableConfirm} onOpenChange={setShowDisableConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication?</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground mb-4">
                This will remove the extra layer of security from your account.
                You&apos;ll only need your password to sign in.
              </p>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  <strong>Warning:</strong> Your account will be less secure
                  without two-factor authentication. We recommend keeping it
                  enabled.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDisableConfirm(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDisableMfa}>
              Disable MFA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove-passkey confirmation. Deleting is irreversible — the credential
          on the device becomes useless and has to be registered again. */}
      <Dialog
        open={!!passkeyToRemove}
        onOpenChange={(open) => {
          if (!open) setPasskeyToRemove(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this passkey?</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground mb-4">
                <strong className="text-foreground">
                  {passkeyToRemove?.friendly_name || "This passkey"}
                </strong>{" "}
                will no longer sign you in. You can add it again from this page
                at any time.
              </p>
              {passkeys.length === 1 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    This is your last passkey. After removing it you&apos;ll
                    need your email and password to sign in.
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasskeyToRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmRemovePasskey}
              disabled={passkeyLoading}
            >
              {passkeyLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Remove passkey"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step-up verification — only reachable when the account HAS a verified
          authenticator app and the session is still AAL1 (e.g. signed in with a
          passkey or magic link). Accounts without 2FA never see this. */}
      <Dialog
        open={showPasskeyStepUp}
        onOpenChange={(open) => {
          if (!open) closePasskeyStepUp();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Verify it&apos;s you</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pendingPasskeyAction?.type === "remove"
              ? "Removing a passkey needs a verified session."
              : pendingPasskeyAction?.type === "list"
                ? "Viewing your passkeys needs a verified session."
                : "Adding a passkey needs a verified session."}{" "}
            Enter the current 6-digit code from your authenticator app.
          </p>
          <div className="space-y-2">
            <Label htmlFor="passkey-step-up-code">Authenticator code</Label>
            <Input
              id="passkey-step-up-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={stepUpCode}
              onChange={(e) =>
                setStepUpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && stepUpCode.length === 6) {
                  handlePasskeyStepUp();
                }
              }}
              placeholder="000000"
              className="w-32 text-center font-mono"
              maxLength={6}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePasskeyStepUp}>
              Cancel
            </Button>
            <Button
              onClick={handlePasskeyStepUp}
              disabled={passkeyLoading || stepUpCode.length !== 6}
            >
              {passkeyLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Verify"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast Notification */}
      <div
        className={`fixed bottom-6 right-6 z-50 transition-all duration-300 ease-out ${
          toastVisible && message
            ? "translate-y-0 opacity-100"
            : "translate-y-4 opacity-0 pointer-events-none"
        }`}
      >
        {message && (
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg min-w-[300px] max-w-[420px] ${
              message.type === "success"
                ? "bg-background border-green-200 dark:border-green-800"
                : "bg-red-600 border-red-600 dark:bg-red-600 dark:border-red-600"
            }`}
          >
            {message.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-white flex-shrink-0" />
            )}
            <p
              className={`text-sm flex-1 ${
                message.type === "success"
                  ? "text-green-700 dark:text-green-300"
                  : "text-white"
              }`}
            >
              {message.text}
            </p>
            <button
              onClick={dismissToast}
              className={`transition-colors flex-shrink-0 ${
                message.type === "success"
                  ? "text-muted-foreground hover:text-foreground"
                  : "text-white/70 hover:text-white"
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
