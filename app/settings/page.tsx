"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Settings as SettingsIcon,
  Mail,
  Shield,
  Search,
  UserPlus,
  Edit2,
  UserX,
  UserCheck,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  User as UserIcon,
  X,
  FileText,
  Clock,
  ShieldCheck,
  ShieldOff,
  AlertTriangle,
  Fingerprint,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  getUsers,
  createUser,
  inviteUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  deleteUser,
  sendPasswordResetEmail,
  resetUserMfa,
  resetUserPasskeys,
  checkIsAdmin,
  getCurrentUserId,
} from "@/app/admin/users/actions";
import { getAuditLogs, type AuditLog } from "@/app/admin/audit/actions";
import {
  getMfaRequirement,
  updateMfaRequirement,
  type MfaRequirement,
} from "@/app/admin/settings/actions";
import Tooltip from "@/app/components/Tooltip";
import { formatDate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  created_at: string;
  last_sign_in_at?: string;
  mfa_enabled?: boolean;
  /** Number of registered passkeys. Passkeys are not MFA factors — see
   *  /documentation/passkeys.md. */
  passkey_count?: number;
  is_active: boolean;
}

const validTabs = ["general", "user-management", "audit-log"];

const getTabFromHash = (): string => {
  if (typeof window === "undefined") return "general";
  const hash = window.location.hash.replace("#", "");
  return validTabs.includes(hash) ? hash : "general";
};

export default function Settings() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState(getTabFromHash);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // User Management State
  const [users, setUsers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMfaResetModal, setShowMfaResetModal] = useState(false);
  const [showPasskeyResetModal, setShowPasskeyResetModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    role: "user",
  });
  const [sendInvite, setSendInvite] = useState(true);
  const [formError, setFormError] = useState("");
  const [formErrorDetail, setFormErrorDetail] = useState("");
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  const [formLoading, setFormLoading] = useState(false);

  // Toast notification state
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "warning";
  } | null>(null);

  // Audit Log State
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [auditCurrentPage, setAuditCurrentPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);

  // General Settings State
  const [mfaRequirement, setMfaRequirement] =
    useState<MfaRequirement>("all_users");
  const [mfaRequirementLoading, setMfaRequirementLoading] = useState(false);
  const [mfaRequirementSaving, setMfaRequirementSaving] = useState(false);

  // Sync URL hash with active tab
  useEffect(() => {
    window.history.replaceState(null, "", `#${activeTab}`);
  }, [activeTab]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const onHashChange = () => {
      const tab = getTabFromHash();
      setActiveTab(tab);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    document.title = "Settings";
    // Check if user is admin using secure server-side validation
    const checkIfAdminSecure = async () => {
      try {
        // Use server-side admin validation instead of client-side JWT inspection
        const isUserAdmin = await checkIsAdmin();
        setIsAdmin(isUserAdmin);

        // Redirect non-admin users to home page
        if (!isUserAdmin) {
          router.push("/");
          return;
        }

        // Track the current user's id so we can hide self-targeting actions.
        setCurrentUserId(await getCurrentUserId());
      } catch {
        setIsAdmin(false);
        router.push("/");
      }
    };
    checkIfAdminSecure();
  }, [router]);

  // Load users when user-management tab is active
  useEffect(() => {
    if (activeTab === "user-management" && isAdmin && allUsers.length === 0) {
      loadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAdmin]);

  const loadAuditLogs = useCallback(async () => {
    setAuditLogsLoading(true);
    try {
      const data = await getAuditLogs(auditCurrentPage, 20);
      setAuditLogs(data.logs);
      setAuditTotalPages(data.totalPages);
    } catch {
      setToast({ message: "Failed to load audit logs", type: "error" });
    } finally {
      setAuditLogsLoading(false);
    }
  }, [auditCurrentPage]);

  // Load audit logs when audit-log tab is active
  useEffect(() => {
    if (activeTab === "audit-log" && isAdmin) {
      loadAuditLogs();
    }
  }, [activeTab, isAdmin, loadAuditLogs]);

  // Load general settings when general tab is active
  useEffect(() => {
    if (activeTab === "general" && isAdmin) {
      loadMfaRequirement();
    }
  }, [activeTab, isAdmin]);

  // Client-side filtering effect for user management
  useEffect(() => {
    if (activeTab === "user-management") {
      // Show either active or deactivated users depending on the toggle.
      let filteredUsers = allUsers.filter((user) =>
        showDeactivated ? !user.is_active : user.is_active
      );

      if (searchTerm) {
        filteredUsers = filteredUsers.filter(
          (user) =>
            user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (user.first_name || "")
              .toLowerCase()
              .includes(searchTerm.toLowerCase()) ||
            (user.last_name || "")
              .toLowerCase()
              .includes(searchTerm.toLowerCase())
        );
      }

      const perPage = 10;
      const totalFilteredPages = Math.ceil(filteredUsers.length / perPage);
      const startIndex = (currentPage - 1) * perPage;
      const endIndex = startIndex + perPage;
      const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

      setUsers(paginatedUsers);
      setTotalPages(totalFilteredPages);

      if (currentPage > totalFilteredPages && totalFilteredPages > 0) {
        setCurrentPage(1);
      }
    }
  }, [searchTerm, showDeactivated, allUsers, currentPage, activeTab]);

  // Auto-hide toast after 4 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const data = await getUsers();
      setAllUsers(data.users);
    } catch {
    } finally {
      setUsersLoading(false);
    }
  };

  const loadMfaRequirement = async () => {
    setMfaRequirementLoading(true);
    try {
      const value = await getMfaRequirement();
      setMfaRequirement(value);
    } catch {
      setToast({
        message: "Failed to load MFA requirement setting",
        type: "error",
      });
    } finally {
      setMfaRequirementLoading(false);
    }
  };

  const handleSaveMfaRequirement = async () => {
    setMfaRequirementSaving(true);
    try {
      const result = await updateMfaRequirement(mfaRequirement);
      if (result.success) {
        setToast({
          message: "MFA requirement updated successfully",
          type: "success",
        });
      } else {
        setToast({
          message: result.error || "Failed to update MFA requirement",
          type: "error",
        });
      }
    } catch {
      setToast({ message: "Failed to update MFA requirement", type: "error" });
    } finally {
      setMfaRequirementSaving(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    setFormError("");
    setFormErrorDetail("");
    setShowErrorDetail(false);
    setFormLoading(true);

    try {
      let result;

      if (sendInvite) {
        result = await inviteUser(
          formData.email,
          formData.firstName,
          formData.lastName,
          formData.role
        );
      } else {
        result = await createUser(
          formData.email,
          formData.password,
          formData.firstName,
          formData.lastName,
          formData.role
        );
      }

      if (result.success) {
        setShowCreateModal(false);
        setFormData({
          email: "",
          password: "",
          firstName: "",
          lastName: "",
          role: "user",
        });
        setSendInvite(true);
        await loadUsers();
        setToast({
          message: sendInvite
            ? "Invite email sent successfully"
            : "User created successfully",
          type: "success",
        });
      } else {
        setFormError(
          "error" in result && result.error
            ? result.error
            : "Failed to create user"
        );
        if ("errorDetail" in result && result.errorDetail) {
          setFormErrorDetail(result.errorDetail as string);
        }
      }
    } catch {
      setFormError("An error occurred while creating the user");
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setFormError("");
    setFormLoading(true);

    try {
      const result = await updateUser(selectedUser.id, {
        firstName: formData.firstName,
        lastName: formData.lastName,
        role: formData.role,
      });

      if (result.success) {
        setShowEditModal(false);
        setSelectedUser(null);
        await loadUsers();

        // Show appropriate toast message
        if (result.roleChanged) {
          setToast({
            message:
              result.message || "Role updated. User has been logged out.",
            type: "success",
          });
        } else {
          setToast({
            message: "User updated successfully",
            type: "success",
          });
        }
      } else {
        setFormError(
          "error" in result && result.error
            ? result.error
            : "Failed to update user"
        );
      }
    } catch {
      setFormError("An error occurred while updating the user");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeactivateUser = async () => {
    if (!selectedUser) return;

    setFormLoading(true);
    try {
      const result = await deactivateUser(selectedUser.id);

      if (result.success) {
        setShowDeactivateModal(false);
        setSelectedUser(null);
        await loadUsers();
        setToast({
          message: "User deactivated successfully",
          type: "success",
        });
      } else {
        setFormError(
          "error" in result && result.error
            ? result.error
            : "Failed to deactivate user"
        );
      }
    } catch {
      setFormError("An error occurred while deactivating the user");
    } finally {
      setFormLoading(false);
    }
  };

  const handleReactivateUser = async () => {
    if (!selectedUser) return;

    setFormLoading(true);
    try {
      const result = await reactivateUser(selectedUser.id);

      if (result.success) {
        setShowReactivateModal(false);
        setSelectedUser(null);
        await loadUsers();
        setToast({
          message: "User reactivated successfully",
          type: "success",
        });
      } else {
        setFormError(
          "error" in result && result.error
            ? result.error
            : "Failed to reactivate user"
        );
      }
    } catch {
      setFormError("An error occurred while reactivating the user");
    } finally {
      setFormLoading(false);
    }
  };

  const handleSendResetEmail = async (email: string) => {
    try {
      const result = await sendPasswordResetEmail(email);
      if (result.success) {
        setToast({
          message: "Password reset email successfully sent",
          type: "success",
        });
      } else {
        setToast({
          message:
            "error" in result && result.error
              ? result.error
              : "Failed to send reset email",
          type: "error",
        });
      }
    } catch {
      setToast({
        message: "An error occurred while sending the reset email",
        type: "error",
      });
    }
  };

  // Entry point for the reset-password action. If the user has 2FA enabled, ask
  // first whether their 2FA should be reset too — otherwise they still need
  // their authenticator code to sign in after changing their password.
  const openResetPasswordFlow = (user: User) => {
    if (user.mfa_enabled) {
      setSelectedUser(user);
      setShowResetPasswordModal(true);
    } else {
      handleSendResetEmail(user.email);
    }
  };

  const confirmResetPasswordOnly = async () => {
    if (!selectedUser) return;
    setShowResetPasswordModal(false);
    await handleSendResetEmail(selectedUser.email);
    setSelectedUser(null);
  };

  const confirmResetPasswordAndMfa = async () => {
    if (!selectedUser) return;
    const target = selectedUser;
    setShowResetPasswordModal(false);

    try {
      const mfaResult = await resetUserMfa(target.id, target.email);
      if (!mfaResult.success) {
        setToast({
          message:
            "error" in mfaResult && mfaResult.error
              ? mfaResult.error
              : "Failed to reset 2FA",
          type: "error",
        });
        return;
      }
      // 2FA cleared — now send the password reset email.
      await handleSendResetEmail(target.email);
      await loadUsers(); // refresh MFA status in the table
    } catch {
      setToast({
        message: "An error occurred while resetting 2FA",
        type: "error",
      });
    } finally {
      setSelectedUser(null);
    }
  };

  const handleResetMfa = async (user: User) => {
    setSelectedUser(user);
    setShowMfaResetModal(true);
  };

  const confirmResetMfa = async () => {
    if (!selectedUser) return;

    setShowMfaResetModal(false);

    try {
      const result = await resetUserMfa(selectedUser.id, selectedUser.email);
      if (result.success) {
        // Check if it's a warning (couldn't actually delete) or success
        const toastType = result.warning ? "warning" : "success";
        setToast({
          message: result.message || "MFA has been reset successfully",
          type: toastType,
        });
        await loadUsers(); // Reload to update MFA status
      } else {
        setToast({
          message:
            "error" in result && result.error
              ? result.error
              : "Failed to reset MFA",
          type: "error",
        });
      }
    } catch {
      setToast({
        message: "An error occurred while resetting MFA",
        type: "error",
      });
    } finally {
      setSelectedUser(null);
    }
  };

  const handleResetPasskeys = (user: User) => {
    setSelectedUser(user);
    setShowPasskeyResetModal(true);
  };

  const confirmResetPasskeys = async () => {
    if (!selectedUser) return;

    setShowPasskeyResetModal(false);

    try {
      const result = await resetUserPasskeys(selectedUser.id);
      if (result.success) {
        setToast({
          message:
            ("message" in result && result.message) ||
            "Passkeys have been removed",
          type: "success",
        });
        await loadUsers(); // Reload to update the passkey count
      } else {
        setToast({
          message:
            "error" in result && result.error
              ? result.error
              : "Failed to remove passkeys",
          type: "error",
        });
      }
    } catch {
      setToast({
        message: "An error occurred while removing passkeys",
        type: "error",
      });
    } finally {
      setSelectedUser(null);
    }
  };

  const openEditModal = (user: User) => {
    setSelectedUser(user);
    setFormData({
      email: user.email,
      password: "",
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
    });
    setFormError("");
    setShowEditModal(true);
  };

  const openDeactivateModal = (user: User) => {
    setSelectedUser(user);
    setFormError("");
    setShowDeactivateModal(true);
  };

  const openReactivateModal = (user: User) => {
    setSelectedUser(user);
    setFormError("");
    setShowReactivateModal(true);
  };

  const openDeleteModal = (user: User) => {
    setSelectedUser(user);
    setFormError("");
    setShowDeleteModal(true);
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    setFormLoading(true);
    try {
      const result = await deleteUser(selectedUser.id);

      if (result.success) {
        setShowDeleteModal(false);
        setSelectedUser(null);
        await loadUsers();
        setToast({
          message: "User deleted successfully",
          type: "success",
        });
      } else {
        setFormError(
          "error" in result && result.error
            ? result.error
            : "Failed to delete user"
        );
      }
    } catch {
      setFormError("An error occurred while deleting the user");
    } finally {
      setFormLoading(false);
    }
  };

  const tabs = [
    ...(isAdmin
      ? [
          {
            id: "general",
            name: "General",
            icon: SettingsIcon,
          },
          {
            id: "user-management",
            name: "User Management",
            icon: Shield,
          },
          {
            id: "audit-log",
            name: "Audit Log",
            icon: FileText,
          },
        ]
      : []),
  ];

  return (
    <div>
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-semibold text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your application settings
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border mb-6">
        <nav className="-mb-px flex space-x-4 md:space-x-8 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.name}</span>
                <span className="sm:hidden">{tab.name.split(" ")[0]}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "general" && (
          <div className="grid gap-6">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>General Settings</CardTitle>
                <CardDescription>
                  Configure organization-wide settings
                </CardDescription>
              </CardHeader>

              <CardContent>
                {mfaRequirementLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* MFA Requirement Section */}
                    <div>
                      <h3 className="text-sm font-medium text-foreground mb-1">
                        Two-Factor Authentication Requirement
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Choose which users must have two-factor authentication
                        enabled. Users without MFA will be redirected to set it
                        up before they can access the application.
                      </p>

                      <div className="space-y-3">
                        <label className="flex items-start gap-3 p-3 rounded-lg border border-input cursor-pointer hover:bg-muted/50 transition-colors">
                          <input
                            type="radio"
                            name="mfaRequirement"
                            value="all_users"
                            checked={mfaRequirement === "all_users"}
                            onChange={() => setMfaRequirement("all_users")}
                            className="mt-0.5 text-primary focus:ring-primary"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                All Users
                              </span>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800">
                                Recommended
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Every user must set up two-factor authentication
                              before accessing the application
                            </p>
                          </div>
                        </label>

                        <label className="flex items-start gap-3 p-3 rounded-lg border border-input cursor-pointer hover:bg-muted/50 transition-colors">
                          <input
                            type="radio"
                            name="mfaRequirement"
                            value="admins_only"
                            checked={mfaRequirement === "admins_only"}
                            onChange={() => setMfaRequirement("admins_only")}
                            className="mt-0.5 text-primary focus:ring-primary"
                          />
                          <div>
                            <span className="text-sm font-medium text-foreground">
                              Admins Only
                            </span>
                            <p className="text-sm text-muted-foreground">
                              Only admin users must set up two-factor
                              authentication. Regular users can optionally
                              enable it from their profile.
                            </p>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={handleSaveMfaRequirement}
                        disabled={mfaRequirementSaving}
                      >
                        {mfaRequirementSaving ? "Saving..." : "Save Changes"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "user-management" && (
          <div className="grid gap-6">
            {/* Search and Create */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search users by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button
                onClick={() => {
                  setFormData({
                    email: "",
                    password: "",
                    firstName: "",
                    lastName: "",
                    role: "user",
                  });
                  setSendInvite(true);
                  setFormError("");
                  setShowCreateModal(true);
                }}
              >
                <UserPlus className="h-4 w-4" />
                Create User
              </Button>
            </div>

            {/* Show deactivated users toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-input bg-muted/50">
              <div>
                <span className="text-sm font-medium text-foreground">
                  Show deactivated users
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {showDeactivated
                    ? "Viewing deactivated users — reactivate to restore access."
                    : "Deactivated users can't sign in, but their data is kept."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showDeactivated}
                aria-label="Show deactivated users"
                onClick={() => {
                  setShowDeactivated((prev) => !prev);
                  setCurrentPage(1);
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  showDeactivated ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    showDeactivated ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Users Table */}
            <Card className="overflow-hidden py-0">
              {usersLoading ? (
                <div className="flex items-center justify-center min-h-[300px]">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px]">
                      <thead className="bg-muted border-b border-border">
                        <tr>
                          <th className="px-3 md:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            User
                          </th>
                          <th className="px-3 md:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Role
                          </th>
                          <th className="px-3 md:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-16">
                            MFA
                          </th>
                          <th className="px-3 md:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-16">
                            Passkey
                          </th>
                          <th className="hidden sm:table-cell px-3 md:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Created
                          </th>
                          <th className="px-3 md:px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider w-24">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {users.length === 0 && (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-3 md:px-6 py-12 text-center text-sm text-muted-foreground"
                            >
                              {showDeactivated
                                ? "No deactivated users."
                                : searchTerm
                                  ? "No users match your search."
                                  : "No active users."}
                            </td>
                          </tr>
                        )}
                        {users.map((user) => (
                          <tr key={user.id} className="hover:bg-muted/50">
                            <td className="px-3 md:px-6 py-4">
                              <div>
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium text-foreground truncate">
                                    {[user.first_name, user.last_name]
                                      .filter(Boolean)
                                      .join(" ") || "No name"}
                                  </div>
                                  {!user.is_active && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800">
                                      Deactivated
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs sm:text-sm text-muted-foreground truncate">
                                  {user.email}
                                </div>
                                {/* Mobile-only info */}
                                <div className="mt-1 sm:hidden flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>
                                    Created: {formatDate(user.created_at)}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 md:px-6 py-4">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                  user.role === "admin"
                                    ? "bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300"
                                    : "bg-muted text-foreground"
                                }`}
                              >
                                {user.role === "admin" ? (
                                  <Shield className="h-3 w-3" />
                                ) : (
                                  <UserIcon className="h-3 w-3" />
                                )}
                                <span className="hidden sm:inline">
                                  {user.role}
                                </span>
                                <span className="sm:hidden">
                                  {user.role === "admin" ? "A" : "U"}
                                </span>
                              </span>
                            </td>
                            <td className="px-3 md:px-6 py-4">
                              <div className="flex justify-center">
                                <Tooltip
                                  content={
                                    user.mfa_enabled
                                      ? "MFA Enabled"
                                      : "MFA Disabled"
                                  }
                                >
                                  <span
                                    className={`inline-flex items-center justify-center w-6 h-6 ${
                                      user.mfa_enabled
                                        ? "text-green-600 dark:text-green-400"
                                        : "text-muted-foreground"
                                    }`}
                                  >
                                    {user.mfa_enabled ? (
                                      <ShieldCheck className="h-4 w-4" />
                                    ) : (
                                      <ShieldOff className="h-4 w-4" />
                                    )}
                                  </span>
                                </Tooltip>
                              </div>
                            </td>
                            <td className="px-3 md:px-6 py-4">
                              <div className="flex justify-center">
                                <Tooltip
                                  content={
                                    user.passkey_count
                                      ? `${user.passkey_count} passkey${
                                          user.passkey_count === 1 ? "" : "s"
                                        } registered`
                                      : "No passkeys"
                                  }
                                >
                                  <span
                                    className={`inline-flex items-center justify-center gap-0.5 h-6 ${
                                      user.passkey_count
                                        ? "text-green-600 dark:text-green-400"
                                        : "text-muted-foreground"
                                    }`}
                                  >
                                    <Fingerprint className="h-4 w-4" />
                                    {(user.passkey_count ?? 0) > 1 && (
                                      <span className="text-xs font-medium">
                                        {user.passkey_count}
                                      </span>
                                    )}
                                  </span>
                                </Tooltip>
                              </div>
                            </td>
                            <td className="hidden sm:table-cell px-3 md:px-6 py-4 text-sm text-muted-foreground">
                              {formatDate(user.created_at)}
                            </td>
                            <td className="px-3 md:px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Tooltip content="Send password reset email">
                                  <button
                                    onClick={() => openResetPasswordFlow(user)}
                                    className="p-1.5 text-muted-foreground hover:text-primary"
                                  >
                                    <Mail className="h-3 w-3 sm:h-4 sm:w-4" />
                                  </button>
                                </Tooltip>
                                {user.mfa_enabled && (
                                  <Tooltip content="Reset MFA">
                                    <button
                                      onClick={() => handleResetMfa(user)}
                                      className="p-1.5 text-muted-foreground hover:text-orange-600 dark:hover:text-orange-400"
                                    >
                                      <ShieldOff className="h-3 w-3 sm:h-4 sm:w-4" />
                                    </button>
                                  </Tooltip>
                                )}
                                {(user.passkey_count ?? 0) > 0 && (
                                  <Tooltip content="Remove all passkeys">
                                    <button
                                      onClick={() => handleResetPasskeys(user)}
                                      className="p-1.5 text-muted-foreground hover:text-orange-600 dark:hover:text-orange-400"
                                    >
                                      <Fingerprint className="h-3 w-3 sm:h-4 sm:w-4" />
                                    </button>
                                  </Tooltip>
                                )}
                                <Tooltip content="Edit user details">
                                  <button
                                    onClick={() => openEditModal(user)}
                                    className="p-1.5 text-muted-foreground hover:text-primary"
                                  >
                                    <Edit2 className="h-3 w-3 sm:h-4 sm:w-4" />
                                  </button>
                                </Tooltip>
                                {user.is_active ? (
                                  user.id === currentUserId ? null : (
                                    <Tooltip content="Deactivate user">
                                      <button
                                        onClick={() =>
                                          openDeactivateModal(user)
                                        }
                                        className="p-1.5 text-muted-foreground hover:text-destructive"
                                      >
                                        <UserX className="h-3 w-3 sm:h-4 sm:w-4" />
                                      </button>
                                    </Tooltip>
                                  )
                                ) : (
                                  <>
                                    <Tooltip content="Reactivate user">
                                      <button
                                        onClick={() =>
                                          openReactivateModal(user)
                                        }
                                        className="p-1.5 text-muted-foreground hover:text-green-600 dark:hover:text-green-400"
                                      >
                                        <UserCheck className="h-3 w-3 sm:h-4 sm:w-4" />
                                      </button>
                                    </Tooltip>
                                    <Tooltip content="Delete user permanently">
                                      <button
                                        onClick={() => openDeleteModal(user)}
                                        className="p-1.5 text-muted-foreground hover:text-destructive"
                                      >
                                        <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                                      </button>
                                    </Tooltip>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="px-6 py-3 border-t border-border flex items-center justify-between">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((p) => Math.max(1, p - 1))
                        }
                        disabled={currentPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <span className="text-sm text-foreground">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((p) => Math.min(totalPages, p + 1))
                        }
                        disabled={currentPage === totalPages}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        )}

        {activeTab === "audit-log" && (
          <div className="grid gap-6">
            <Card className="overflow-hidden py-0 gap-0">
              <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-border">
                <h3 className="leading-none font-semibold">
                  Admin Activity Log
                </h3>
                <p className="text-muted-foreground text-sm mt-1.5">
                  Track all administrative changes and actions
                </p>
              </div>

              {auditLogsLoading ? (
                <div className="flex items-center justify-center min-h-[400px]">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No audit logs found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Admin actions will appear here
                  </p>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="px-4 sm:px-6 py-4 hover:bg-muted/50"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground">
                              {log.formatted_message}
                            </p>
                            {log.formatted_details && (
                              <div className="mt-1 text-sm text-muted-foreground">
                                {/* Parse and render formatted details with bold values */}
                                {(() => {
                                  // Split on quoted strings to identify values
                                  const parts =
                                    log.formatted_details.split(/(".*?")/g);
                                  return parts.map((part, index) => {
                                    // Check if this part is quoted (the changed values)
                                    if (
                                      part.startsWith('"') &&
                                      part.endsWith('"')
                                    ) {
                                      return (
                                        <span
                                          key={index}
                                          className="font-semibold text-foreground"
                                        >
                                          {part.slice(1, -1)}
                                        </span>
                                      );
                                    }
                                    return <span key={index}>{part}</span>;
                                  });
                                })()}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
                            <Clock className="h-3 w-3" />
                            <time dateTime={log.created_at}>
                              <span className="hidden sm:inline">
                                {new Date(log.created_at).toLocaleString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}
                              </span>
                              <span className="sm:hidden">
                                {new Date(log.created_at).toLocaleString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}
                              </span>
                            </time>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {auditTotalPages > 1 && (
                    <div className="px-6 py-4 border-t border-border flex items-center justify-between">
                      <p className="text-sm text-foreground">
                        Page {auditCurrentPage} of {auditTotalPages}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() =>
                            setAuditCurrentPage((p) => Math.max(1, p - 1))
                          }
                          disabled={auditCurrentPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() =>
                            setAuditCurrentPage((p) =>
                              Math.min(auditTotalPages, p + 1)
                            )
                          }
                          disabled={auditCurrentPage === auditTotalPages}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Create User Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              Add a new user account to the system.
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <div className="p-3 bg-red-600 rounded-md">
              <div className="text-sm text-white whitespace-pre-line">
                {formError}
              </div>
              {formErrorDetail && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowErrorDetail(!showErrorDetail)}
                    className="text-xs text-white underline hover:no-underline"
                  >
                    {showErrorDetail ? "Hide details" : "Learn more"}
                  </button>
                  {showErrorDetail && (
                    <p className="mt-1.5 text-xs text-white/80">
                      {formErrorDetail}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1">First Name</Label>
                <Input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) =>
                    setFormData({ ...formData, firstName: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <Label className="mb-1">Last Name</Label>
                <Input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) =>
                    setFormData({ ...formData, lastName: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            <div>
              <Label className="mb-1">Email Address</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                required
              />
            </div>

            {/* Send invite toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-input bg-muted/50">
              <div>
                <span className="text-sm font-medium text-foreground">
                  Send invite email
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  User sets their own password via email link
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={sendInvite}
                onClick={() => {
                  setSendInvite(!sendInvite);
                  if (!sendInvite) setFormData({ ...formData, password: "" });
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  sendInvite ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    sendInvite ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Password field - only shown when not sending invite */}
            {!sendInvite && (
              <div>
                <Label className="mb-1">Password</Label>
                <Input
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  required
                  minLength={12}
                />
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-1 w-1 rounded-full ${formData.password.length >= 12 ? "bg-green-500" : "bg-muted-foreground/30"}`}
                    />
                    <p
                      className={`text-xs ${formData.password.length >= 12 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                    >
                      At least 12 characters
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-1 w-1 rounded-full ${/[A-Z]/.test(formData.password) ? "bg-green-500" : "bg-muted-foreground/30"}`}
                    />
                    <p
                      className={`text-xs ${/[A-Z]/.test(formData.password) ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                    >
                      One uppercase letter
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-1 w-1 rounded-full ${/[a-z]/.test(formData.password) ? "bg-green-500" : "bg-muted-foreground/30"}`}
                    />
                    <p
                      className={`text-xs ${/[a-z]/.test(formData.password) ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                    >
                      One lowercase letter
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-1 w-1 rounded-full ${/[0-9]/.test(formData.password) ? "bg-green-500" : "bg-muted-foreground/30"}`}
                    />
                    <p
                      className={`text-xs ${/[0-9]/.test(formData.password) ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                    >
                      One number
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-1 w-1 rounded-full ${/[^A-Za-z0-9]/.test(formData.password) ? "bg-green-500" : "bg-muted-foreground/30"}`}
                    />
                    <p
                      className={`text-xs ${/[^A-Za-z0-9]/.test(formData.password) ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                    >
                      One special character (!@#$%^&*)
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <Label className="mb-1">Role</Label>
              <Select
                value={formData.role}
                onValueChange={(v) => setFormData({ ...formData, role: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={formLoading}>
                {formLoading
                  ? sendInvite
                    ? "Sending..."
                    : "Creating..."
                  : sendInvite
                    ? "Send Invite"
                    : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Modal */}
      <Dialog
        open={showEditModal && !!selectedUser}
        onOpenChange={setShowEditModal}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user account details.</DialogDescription>
          </DialogHeader>

          {formError && (
            <div className="p-3 bg-red-600 rounded-md">
              <div className="text-sm text-white whitespace-pre-line">
                {formError}
              </div>
            </div>
          )}

          <form onSubmit={handleUpdateUser} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1">First Name</Label>
                <Input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) =>
                    setFormData({ ...formData, firstName: e.target.value })
                  }
                />
              </div>
              <div>
                <Label className="mb-1">Last Name</Label>
                <Input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) =>
                    setFormData({ ...formData, lastName: e.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <Label className="mb-1">Email Address</Label>
              <Input
                type="email"
                value={formData.email}
                disabled
                className="bg-muted text-muted-foreground"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Email cannot be changed
              </p>
            </div>

            <div>
              <Label className="mb-1">Role</Label>
              <Select
                value={formData.role}
                onValueChange={(v) => setFormData({ ...formData, role: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              {selectedUser && selectedUser.role !== formData.role && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                  Changing the role will require the user to refresh their
                  browser for the new permissions to take effect.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowEditModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={formLoading}>
                {formLoading ? "Updating..." : "Update User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation Modal */}
      <Dialog
        open={showDeactivateModal && !!selectedUser}
        onOpenChange={setShowDeactivateModal}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                <UserX className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              Deactivate User?
            </DialogTitle>
            <DialogDescription>
              {selectedUser && (
                <>
                  Are you sure you want to deactivate{" "}
                  <strong className="text-foreground">
                    {[selectedUser.first_name, selectedUser.last_name]
                      .filter(Boolean)
                      .join(" ") || selectedUser.email}
                  </strong>
                  ?
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <div className="p-3 bg-red-600 rounded-md">
              <div className="text-sm text-white whitespace-pre-line">
                {formError}
              </div>
            </div>
          )}

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              The user will no longer be able to sign in and any active sessions
              will be ended. All of their data is kept intact, and you can
              reactivate them at any time.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeactivateModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeactivateUser}
              disabled={formLoading}
            >
              {formLoading ? "Deactivating..." : "Deactivate User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reactivate Confirmation Modal */}
      <Dialog
        open={showReactivateModal && !!selectedUser}
        onOpenChange={setShowReactivateModal}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <UserCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              Reactivate User?
            </DialogTitle>
            <DialogDescription>
              {selectedUser && (
                <>
                  Are you sure you want to reactivate{" "}
                  <strong className="text-foreground">
                    {[selectedUser.first_name, selectedUser.last_name]
                      .filter(Boolean)
                      .join(" ") || selectedUser.email}
                  </strong>
                  ?
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <div className="p-3 bg-red-600 rounded-md">
              <div className="text-sm text-white whitespace-pre-line">
                {formError}
              </div>
            </div>
          )}

          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-3">
            <p className="text-sm text-green-800 dark:text-green-300">
              The user will be able to sign in again with their existing
              credentials.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowReactivateModal(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleReactivateUser}
              disabled={formLoading}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {formLoading ? "Reactivating..." : "Reactivate User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal (deactivated users only) */}
      <Dialog
        open={showDeleteModal && !!selectedUser}
        onOpenChange={setShowDeleteModal}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              Delete User?
            </DialogTitle>
            <DialogDescription>
              {selectedUser && (
                <>
                  Permanently delete{" "}
                  <strong className="text-foreground">
                    {[selectedUser.first_name, selectedUser.last_name]
                      .filter(Boolean)
                      .join(" ") || selectedUser.email}
                  </strong>
                  ?
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <div className="p-3 bg-red-600 rounded-md">
              <div className="text-sm text-white whitespace-pre-line">
                {formError}
              </div>
            </div>
          )}

          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
            <p className="text-sm text-red-800 dark:text-red-300">
              This permanently removes the user&apos;s login account. Their
              records in other parts of the app are kept. This cannot be undone.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={formLoading}
            >
              {formLoading ? "Deleting..." : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password — 2FA prompt (only shown when the user has 2FA on) */}
      <Dialog
        open={showResetPasswordModal && !!selectedUser}
        onOpenChange={setShowResetPasswordModal}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              Reset two-factor authentication too?
            </DialogTitle>
            <DialogDescription>
              {selectedUser && (
                <>
                  <strong className="text-foreground">
                    {[selectedUser.first_name, selectedUser.last_name]
                      .filter(Boolean)
                      .join(" ") || selectedUser.email}
                  </strong>{" "}
                  has two-factor authentication enabled. Do you want to reset
                  that as well?
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              If you reset the password only, the user will still need their
              existing authenticator app (2FA) to sign in. Reset 2FA as well if
              they no longer have access to it.
            </p>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowResetPasswordModal(false);
                setSelectedUser(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="outline" onClick={confirmResetPasswordOnly}>
              Reset password only
            </Button>
            <Button
              onClick={confirmResetPasswordAndMfa}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Reset password &amp; 2FA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MFA Reset Confirmation Modal */}
      <Dialog
        open={showMfaResetModal && !!selectedUser}
        onOpenChange={setShowMfaResetModal}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              Reset Two-Factor Authentication?
            </DialogTitle>
            <DialogDescription>
              {selectedUser && (
                <>
                  Are you sure you want to reset MFA for{" "}
                  <strong className="text-foreground">
                    {[selectedUser.first_name, selectedUser.last_name]
                      .filter(Boolean)
                      .join(" ") || selectedUser.email}
                  </strong>
                  ?
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              <strong>Important:</strong> The user will need to set up
              two-factor authentication again if they want to continue using it.
              They will be able to sign in with just their password until they
              re-enable MFA.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowMfaResetModal(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmResetMfa}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Reset MFA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Passkey Reset Confirmation Modal */}
      <Dialog
        open={showPasskeyResetModal && !!selectedUser}
        onOpenChange={setShowPasskeyResetModal}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              Remove all passkeys?
            </DialogTitle>
            <DialogDescription>
              {selectedUser && (
                <>
                  This removes {selectedUser.passkey_count ?? 0} passkey
                  {(selectedUser.passkey_count ?? 0) === 1 ? "" : "s"} for{" "}
                  <strong className="text-foreground">
                    {[selectedUser.first_name, selectedUser.last_name]
                      .filter(Boolean)
                      .join(" ") || selectedUser.email}
                  </strong>
                  . Use this when a device is lost or stolen.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              <strong>Important:</strong> The user will no longer be able to
              sign in with a passkey. They can still sign in with their email
              and password (plus MFA, if enabled), then register a new passkey
              from their profile. They&apos;ll be emailed about this change.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPasskeyResetModal(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmResetPasskeys}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Remove passkeys
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] animate-in slide-in-from-right duration-300">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border max-w-md ${
              toast.type === "success"
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300"
                : toast.type === "warning"
                  ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300"
                  : "bg-red-600 border-red-600 text-white"
            }`}
          >
            <div
              className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                toast.type === "success"
                  ? "bg-green-500 text-white"
                  : toast.type === "warning"
                    ? "bg-yellow-500 text-white"
                    : "bg-red-500 text-white"
              }`}
            >
              {toast.type === "success"
                ? "\u2713"
                : toast.type === "warning"
                  ? "\u26A0"
                  : "!"}
            </div>
            <p className="text-sm font-medium flex-1">{toast.message}</p>
            <button
              onClick={() => setToast(null)}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
